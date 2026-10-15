// Capas: cada tipo de elemento va en una capa que se puede ocultar (no se ve ni se exporta)
// o bloquear (se ve, pero no se puede elegir ni mover).

const CAPAS = [
  { id: 'escaneo', nombre: 'Escaneo (nube de puntos)', icono: '☁️' },
  { id: 'zonas', nombre: 'Zonas automáticas', icono: '🟩' },
  { id: 'estancias', nombre: 'Estancias', icono: '⬠' },
  { id: 'nombres', nombre: 'Nombres de estancias', icono: '🏷️' },
  { id: 'cotasEstancias', nombre: 'Cotas de estancias', icono: '↔️' },
  { id: 'cotas', nombre: 'Cotas medidas', icono: '📏' },
  { id: 'muros', nombre: 'Muros', icono: '▬' },
  { id: 'huecos', nombre: 'Puertas y ventanas', icono: '🚪' },
  { id: 'sanitarios', nombre: 'Sanitarios', icono: '🚽' },
  { id: 'cocina', nombre: 'Cocina', icono: '🍳' },
  { id: 'mobiliario', nombre: 'Mobiliario', icono: '🛋️' },
];

// Capas que no tienen nada que elegir (no se pueden bloquear)
const CAPAS_SIN_BLOQUEO = new Set(['escaneo', 'zonas']);

class Capas {
  constructor() {
    this.estado = {};
    for (const c of CAPAS) this.estado[c.id] = { visible: c.id !== 'zonas', bloqueada: false };
    this.alCambiar = null;
  }
  visible(id) { return !this.estado[id] || this.estado[id].visible; }
  bloqueada(id) { return !!(this.estado[id] && this.estado[id].bloqueada); }
  // se puede elegir/editar: visible y sin bloquear
  editable(id) { return this.visible(id) && !this.bloqueada(id); }

  poner(id, campo, valor) {
    if (!this.estado[id]) return;
    this.estado[id][campo] = valor;
    if (this.alCambiar) this.alCambiar(id);
  }
  // Para dibujar en una capa hace falta que esté visible y sin bloquear
  activar(id) {
    const e = this.estado[id];
    if (!e) return false;
    const cambio = !e.visible || e.bloqueada;
    e.visible = true; e.bloqueada = false;
    if (cambio && this.alCambiar) this.alCambiar(id);
    return cambio;
  }
  mostrarTodo() {
    for (const c of CAPAS) { this.estado[c.id].visible = c.id !== 'zonas' || this.estado.zonas.visible; this.estado[c.id].bloqueada = false; }
    if (this.alCambiar) this.alCambiar(null);
  }

  serializar() { return JSON.parse(JSON.stringify(this.estado)); }
  cargarDatos(d) {
    if (!d) return;
    for (const c of CAPAS) if (d[c.id]) this.estado[c.id] = { visible: !!d[c.id].visible, bloqueada: !!d[c.id].bloqueada };
    if (this.alCambiar) this.alCambiar(null);
  }
}

// Capa de un elemento del plano
function capaDe(tipo, el) {
  if (tipo === 'muro') return 'muros';
  if (tipo === 'hueco') return 'huecos';
  if (tipo === 'simbolo') return capaDeSimbolo(el.clave);
  if (tipo === 'estancia') return 'estancias';
  if (tipo === 'cota') return 'cotas';
  return null;
}
function capaDeSimbolo(clave) {
  const def = SIMBOLOS[clave];
  if (!def) return 'mobiliario';
  if (def.grupo === 'Baño') return 'sanitarios';
  if (def.grupo === 'Cocina') return 'cocina';
  return 'mobiliario';
}

const capas = new Capas();
