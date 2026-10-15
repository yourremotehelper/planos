// Presupuesto: partidas con precio unitario; la medición sale sola del plano.
// Las partidas y precios se guardan en este dispositivo (y dentro de cada trabajo guardado).

const UNIDADES = {
  m2_suelo:   { nombre: 'm² de suelo',            corto: 'm²', porEstancia: true },
  m2_techo:   { nombre: 'm² de techo',            corto: 'm²', porEstancia: true },
  m2_pared:   { nombre: 'm² de paredes (sin huecos)', corto: 'm²', porEstancia: true },
  ml_rodapie: { nombre: 'ml de rodapié (sin puertas)', corto: 'ml', porEstancia: true },
  ml_perim:   { nombre: 'ml de perímetro',        corto: 'ml', porEstancia: true },
  m2_derribo: { nombre: 'm² de muro a derribar',  corto: 'm²' },
  m2_tabique: { nombre: 'm² de muro nuevo',       corto: 'm²' },
  ml_tabique: { nombre: 'ml de muro nuevo',       corto: 'ml' },
  ud_puertas: { nombre: 'puertas nuevas',         corto: 'ud' },
  ud_ventanas:{ nombre: 'ventanas nuevas',        corto: 'ud' },
  ud_simbolo: { nombre: 'unidades de un elemento nuevo', corto: 'ud', conSimbolo: true },
  ud:         { nombre: 'unidades (a mano)',      corto: 'ud', manual: true },
  pa:         { nombre: 'partida alzada',         corto: 'PA', manual: true },
};

// Partidas de ejemplo: SIN precios. Cada empresa pone los suyos.
const PARTIDAS_EJEMPLO = [
  { nombre: 'Demolición de tabiques', unidad: 'm2_derribo' },
  { nombre: 'Tabiquería nueva', unidad: 'm2_tabique' },
  { nombre: 'Solado', unidad: 'm2_suelo' },
  { nombre: 'Rodapié', unidad: 'ml_rodapie' },
  { nombre: 'Pintura de paredes', unidad: 'm2_pared' },
  { nombre: 'Pintura de techos', unidad: 'm2_techo' },
  { nombre: 'Alicatado', unidad: 'm2_pared', estancias: [] },
  { nombre: 'Puertas de paso', unidad: 'ud_puertas' },
  { nombre: 'Ventanas', unidad: 'ud_ventanas' },
  { nombre: 'Sanitarios', unidad: 'ud_simbolo', simbolo: 'inodoro' },
  { nombre: 'Instalación de fontanería', unidad: 'pa' },
  { nombre: 'Gestión de residuos', unidad: 'pa' },
];

const CLAVE_GUARDADO = 'escaner-planos:presupuesto';

class Presupuesto {
  constructor({ plano, estancias }) {
    this.plano = plano;
    this.estancias = estancias;
    this.partidas = [];
    this.iva = 21;
    this.obra = '';
    this.siguienteId = 1;
    this.alCambiar = null;
    if (!this.cargarDelDispositivo()) this.restaurarEjemplo();
  }

  nueva(p) {
    return {
      id: this.siguienteId++, activa: true, nombre: p.nombre || 'Nueva partida', unidad: p.unidad || 'm2_suelo',
      precio: p.precio ?? 0, cantidad: p.cantidad ?? (p.unidad === 'pa' ? 1 : 0),
      estancias: p.estancias === undefined ? null : p.estancias, // null = todas
      simbolo: p.simbolo || 'inodoro',
    };
  }

  restaurarEjemplo() {
    this.siguienteId = 1;
    this.partidas = PARTIDAS_EJEMPLO.map((p) => this.nueva(p));
    this.guardarEnDispositivo();
  }

  añadir() { this.partidas.push(this.nueva({})); this.cambio(); }
  borrar(id) { this.partidas = this.partidas.filter((p) => p.id !== id); this.cambio(); }
  cambio() { this.guardarEnDispositivo(); if (this.alCambiar) this.alCambiar(); }

  // ---------- Mediciones ----------

  estanciasDe(p) {
    const todas = this.estancias.lista;
    return p.estancias === null ? todas : todas.filter((e) => p.estancias.includes(e.id));
  }

  medicion(p) {
    const u = UNIDADES[p.unidad];
    if (!u) return 0;
    if (u.manual) return p.unidad === 'pa' ? (p.cantidad || 1) : (p.cantidad || 0);
    const sum = (lista, f) => lista.reduce((t, x) => t + f(x), 0);
    const est = this.estanciasDe(p);
    const muros = this.plano.muros, huecos = this.plano.huecos;
    switch (p.unidad) {
      case 'm2_suelo': case 'm2_techo': return sum(est, (e) => e.area);
      case 'm2_pared': return sum(est, (e) => e.m2ParedesNetas ?? e.m2Paredes);
      case 'ml_rodapie': return sum(est, (e) => e.mlRodapie ?? e.perimetro);
      case 'ml_perim': return sum(est, (e) => e.perimetro);
      case 'm2_derribo': return sum(muros.filter((w) => w.estado === 'derribo'), (w) => largo(w.a, w.b) * w.altura);
      case 'm2_tabique': {
        const nuevos = muros.filter((w) => w.estado === 'nuevo');
        const bruto = sum(nuevos, (w) => largo(w.a, w.b) * w.altura);
        // descontar los huecos nuevos que caen dentro de muros nuevos
        const desc = sum(huecos.filter((h) => h.estado === 'nuevo' && nuevos.some((w) => dentroDe(por(sumar(h.a, h.b), 0.5), cuerpo(w, [0.02, 0.02])))),
          (h) => largo(h.a, h.b) * h.alto);
        return Math.max(0, bruto - desc);
      }
      case 'ml_tabique': return sum(muros.filter((w) => w.estado === 'nuevo'), (w) => largo(w.a, w.b));
      case 'ud_puertas': return huecos.filter((h) => h.tipo === 'puerta' && h.estado === 'nuevo').length;
      case 'ud_ventanas': return huecos.filter((h) => h.tipo === 'ventana' && h.estado === 'nuevo').length;
      case 'ud_simbolo': return this.plano.simbolos.filter((s) => s.clave === p.simbolo && s.estado === 'nuevo').length;
      default: return 0;
    }
  }

  lineas() {
    return this.partidas.filter((p) => p.activa).map((p) => {
      const cant = this.medicion(p);
      return { p, cant, importe: cant * (p.precio || 0) };
    });
  }

  totales() {
    const base = this.lineas().reduce((t, l) => t + l.importe, 0);
    const iva = (base * (this.iva || 0)) / 100;
    return { base, iva, total: base + iva };
  }

  // ---------- Guardar ----------

  serializar() {
    return { partidas: this.partidas.map((p) => ({ ...p })), iva: this.iva, obra: this.obra, siguienteId: this.siguienteId };
  }
  cargarDatos(d) {
    if (!d || !Array.isArray(d.partidas)) return false;
    this.partidas = d.partidas.map((p) => ({ ...p }));
    this.iva = d.iva ?? 21;
    this.obra = d.obra || '';
    this.siguienteId = Math.max(d.siguienteId || 1, ...this.partidas.map((p) => p.id + 1));
    return true;
  }
  guardarEnDispositivo() {
    try { localStorage.setItem(CLAVE_GUARDADO, JSON.stringify({ ...this.serializar(), obra: '' })); } catch { /* sin almacenamiento: no pasa nada */ }
  }
  cargarDelDispositivo() {
    try {
      const t = localStorage.getItem(CLAVE_GUARDADO);
      if (!t) return false;
      const d = JSON.parse(t);
      const ok = this.cargarDatos(d);
      this.obra = '';
      return ok;
    } catch { return false; }
  }

  // Las estancias borradas dejan de estar en las listas de las partidas
  limpiarEstancias() {
    const ids = new Set(this.estancias.lista.map((e) => e.id));
    for (const p of this.partidas) if (p.estancias) p.estancias = p.estancias.filter((id) => ids.has(id));
  }
}

const fmtEur = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
