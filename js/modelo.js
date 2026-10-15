// Modelo del plano: muros, huecos (puertas y ventanas) y símbolos.
// Cada elemento tiene un estado: 'existente', 'derribo' o 'nuevo'.
// Vistas: 'actual' (lo que hay hoy), 'reforma' (derribos en amarillo, nuevo en rojo), 'final' (cómo queda).

const ESTADOS = {
  existente: { nombre: 'Existente', color: '#343a40', relleno: '#495057' },
  derribo: { nombre: 'A derribar', color: '#e8590c', relleno: 'rgba(252,196,25,.45)' },
  nuevo: { nombre: 'Nuevo', color: '#c92a2a', relleno: '#e03131' },
};

const VISTAS = {
  actual: { nombre: 'Actual', ver: { existente: true, derribo: true, nuevo: false }, colores: false },
  reforma: { nombre: 'Reforma', ver: { existente: true, derribo: true, nuevo: true }, colores: true },
  final: { nombre: 'Final', ver: { existente: true, derribo: false, nuevo: true }, colores: false },
};

// ---------- Geometría ----------

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const sumar = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const por = (a, k) => ({ x: a.x * k, y: a.y * k });
const largo = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (a, b) => { const L = largo(a, b) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
const normalIzq = (u) => ({ x: -u.y, y: u.x });

// Desplazamientos del cuerpo respecto a la línea dibujada a→b según "lado"
//   lado 0: centrado · lado 1: hacia la izquierda de a→b · lado -1: hacia la derecha
function caras(grosor, lado) {
  if (lado === 1) return [0, grosor];
  if (lado === -1) return [-grosor, 0];
  return [-grosor / 2, grosor / 2];
}

// Polígono (4 esquinas) del cuerpo de un muro o hueco; ext = alargar extremos [ea, eb]
function cuerpo(el, ext = [0, 0]) {
  const u = unit(el.a, el.b), n = normalIzq(u);
  const [o1, o2] = caras(el.grosor, el.lado);
  const a = sub(el.a, por(u, ext[0])), b = sumar(el.b, por(u, ext[1]));
  return [sumar(a, por(n, o1)), sumar(b, por(n, o1)), sumar(b, por(n, o2)), sumar(a, por(n, o2))];
}

// Distancia de p al segmento a-b, y parámetro t (0..1)
function distSegmento(p, a, b) {
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1e-12;
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return { d: largo(p, q), t, q };
}

function dentroDe(p, poli) {
  let d = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    if ((poli[i].y > p.y) !== (poli[j].y > p.y) && p.x < ((poli[j].x - poli[i].x) * (p.y - poli[i].y)) / (poli[j].y - poli[i].y) + poli[i].x) d = !d;
  }
  return d;
}

// Esquinas del rectángulo girado de un símbolo
function esquinasSimbolo(s) {
  const c = Math.cos(s.rot), si = Math.sin(s.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([kx, ky]) => {
    const lx = (kx * s.ancho) / 2, ly = (ky * s.fondo) / 2;
    return { x: s.x + lx * c - ly * si, y: s.y + lx * si + ly * c };
  });
}

// ---------- Plano ----------

class Plano {
  constructor(visor) {
    this.visor = visor;
    this.muros = [];
    this.huecos = [];
    this.simbolos = [];
    this.vista = 'actual';
    this.siguienteId = 1;
    this.alturaPorDefecto = 2.5;
    this.historial = [];
    this.rehacer = [];
    this.capturar = null;   // función que devuelve el estado completo (la pone app.js)
    this.restaurar = null;
    this.alCambiar = null;
    this.seleccion = null;  // { tipo, id }
  }

  id() { return this.siguienteId++; }
  limpiar() {
    this.muros = []; this.huecos = []; this.simbolos = [];
    this.historial = []; this.rehacer = []; this.seleccion = null; this.siguienteId = 1;
  }
  avisar() { if (this.alCambiar) this.alCambiar(); this.visor.redibujar(); }

  estadoNuevo() { return this.vista === 'actual' ? 'existente' : 'nuevo'; }
  static tipoDe(el) { return el.clave ? 'simbolo' : (el.tipo === 'puerta' || el.tipo === 'ventana') ? 'hueco' : 'muro'; }
  capaDe(el) { return capaDe(Plano.tipoDe(el), el); }
  visible(el) { return VISTAS[this.vista].ver[el.estado] && capas.visible(this.capaDe(el)); }
  editable(el) { return this.visible(el) && !capas.bloqueada(this.capaDe(el)); }

  // ---------- Deshacer / rehacer ----------
  // Se guarda una "foto" del estado ANTES de cada cambio.
  guardar() {
    if (!this.capturar) return;
    this.historial.push(this.capturar());
    if (this.historial.length > 100) this.historial.shift();
    this.rehacer = [];
  }
  deshacer() {
    if (!this.historial.length) return false;
    this.rehacer.push(this.capturar());
    this.restaurar(this.historial.pop());
    this.avisar();
    return true;
  }
  rehacerCambio() {
    if (!this.rehacer.length) return false;
    this.historial.push(this.capturar());
    this.restaurar(this.rehacer.pop());
    this.avisar();
    return true;
  }

  serializar() {
    return JSON.parse(JSON.stringify({ muros: this.muros, huecos: this.huecos, simbolos: this.simbolos, siguienteId: this.siguienteId }));
  }
  cargarDatos(d) {
    this.muros = (d.muros || []).map((m) => ({ ...m }));
    this.huecos = (d.huecos || []).map((h) => ({ ...h }));
    this.simbolos = (d.simbolos || []).map((s) => ({ ...s }));
    const maxId = Math.max(0, ...this.muros.map((m) => m.id), ...this.huecos.map((h) => h.id), ...this.simbolos.map((s) => s.id));
    this.siguienteId = Math.max(d.siguienteId || 1, maxId + 1);
    if (this.seleccion && !this.buscar(this.seleccion)) this.seleccion = null;
  }

  // ---------- Elementos ----------

  buscar(sel) {
    if (!sel) return null;
    const lista = { muro: this.muros, hueco: this.huecos, simbolo: this.simbolos }[sel.tipo];
    return lista ? lista.find((e) => e.id === sel.id) : null;
  }

  añadirMuro(a, b, opciones = {}) {
    const m = {
      id: this.id(), a: { ...a }, b: { ...b },
      grosor: opciones.grosor ?? 0.10, lado: opciones.lado ?? 0,
      altura: opciones.altura ?? this.alturaPorDefecto, estado: opciones.estado ?? this.estadoNuevo(),
    };
    this.muros.push(m);
    return m;
  }

  añadirHueco(tipo, a, b, opciones = {}) {
    const h = {
      id: this.id(), tipo, a: { ...a }, b: { ...b },
      grosor: opciones.grosor ?? 0.10, lado: opciones.lado ?? 0,
      alto: opciones.alto ?? (tipo === 'puerta' ? 2.10 : 1.20),
      antepecho: tipo === 'ventana' ? (opciones.antepecho ?? 0.90) : 0,
      estado: opciones.estado ?? this.estadoNuevo(),
      abreLado: 1,          // puerta: hacia qué lado del muro abre (1 izquierda de a→b, -1 derecha)
      bisagra: 'a',         // puerta: en qué extremo está la bisagra
    };
    this.huecos.push(h);
    return h;
  }

  añadirSimbolo(clave, x, y, rot, opciones = {}) {
    const def = SIMBOLOS[clave];
    const s = {
      id: this.id(), clave, x, y, rot,
      ancho: opciones.ancho ?? def.ancho, fondo: opciones.fondo ?? def.fondo,
      estado: opciones.estado ?? this.estadoNuevo(),
    };
    this.simbolos.push(s);
    return s;
  }

  borrar(sel) {
    if (!sel) return;
    if (sel.tipo === 'muro') this.muros = this.muros.filter((e) => e.id !== sel.id);
    if (sel.tipo === 'hueco') this.huecos = this.huecos.filter((e) => e.id !== sel.id);
    if (sel.tipo === 'simbolo') this.simbolos = this.simbolos.filter((e) => e.id !== sel.id);
    if (this.seleccion && this.seleccion.tipo === sel.tipo && this.seleccion.id === sel.id) this.seleccion = null;
  }

  // ---------- Búsqueda bajo el cursor (m = metros) ----------

  elementoEn(m, tolerancia) {
    for (let k = this.huecos.length - 1; k >= 0; k--) {
      const h = this.huecos[k];
      if (!this.editable(h)) continue;
      if (dentroDe(m, cuerpo(h)) || distSegmento(m, h.a, h.b).d <= tolerancia + h.grosor / 2) return { tipo: 'hueco', id: h.id };
    }
    for (let k = this.simbolos.length - 1; k >= 0; k--) {
      const s = this.simbolos[k];
      if (this.editable(s) && dentroDe(m, esquinasSimbolo(s))) return { tipo: 'simbolo', id: s.id };
    }
    for (let k = this.muros.length - 1; k >= 0; k--) {
      const w = this.muros[k];
      if (!this.editable(w)) continue;
      if (dentroDe(m, cuerpo(w)) || distSegmento(m, w.a, w.b).d <= tolerancia) return { tipo: 'muro', id: w.id };
    }
    return null;
  }

  // Extremos de muros (para enganchar al dibujar)
  extremoCerca(m, radio, excluir) {
    let mejor = null;
    for (const w of this.muros) {
      if (w.id === excluir || !this.visible(w)) continue;
      for (const p of [w.a, w.b]) {
        const d = largo(m, p);
        if (d <= radio && (!mejor || d < mejor.d)) mejor = { d, p };
      }
    }
    return mejor ? { ...mejor.p } : null;
  }

  // Líneas de referencia del modelo (caras de muros) cercanas a m, para colocar huecos y símbolos
  lineasCerca(m, radio) {
    const out = [];
    for (const w of this.muros) {
      if (!this.visible(w)) continue;
      const [o1, o2] = caras(w.grosor, w.lado);
      const u = unit(w.a, w.b), n = normalIzq(u);
      for (const o of [o1, o2]) {
        const a = sumar(w.a, por(n, o)), b = sumar(w.b, por(n, o));
        const r = distSegmento(m, a, b);
        if (r.d <= radio) out.push({ d: r.d, q: r.q, u, muro: w, cara: o });
      }
      // la línea central (para huecos)
      const r = distSegmento(m, w.a, w.b);
      if (r.d <= radio) out.push({ d: r.d, q: r.q, u, muro: w, eje: true });
    }
    return out.sort((x, y) => x.d - y.d);
  }

  // Muros con extremos que coinciden con este punto (para cerrar esquinas al dibujar)
  conectado(p, excluirId) {
    return this.muros.some((w) => w.id !== excluirId && this.visible(w) && (largo(w.a, p) < 0.03 || largo(w.b, p) < 0.03));
  }

  // ---------- Dibujo ----------

  dibujar(ctx) {
    const v = this.visor;
    const vista = VISTAS[this.vista];
    const s = v.vista.escala;
    const P = (q) => v.aPantalla(q.x, q.y);
    const colorDe = (estado) => (vista.colores ? ESTADOS[estado] : ESTADOS.existente);
    const poli = (pts) => { ctx.beginPath(); pts.forEach((q, i) => { const p = P(q); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); };

    ctx.save();
    // 1) Muros: rellenos sin borde (así las uniones quedan limpias)
    for (const orden of ['existente', 'nuevo', 'derribo']) {
      for (const w of this.muros) {
        if (w.estado !== orden || !this.visible(w)) continue;
        const ext = [this.conectado(w.a, w.id) ? w.grosor / 2 : 0, this.conectado(w.b, w.id) ? w.grosor / 2 : 0];
        poli(cuerpo(w, ext));
        const c = colorDe(w.estado);
        ctx.fillStyle = c.relleno;
        ctx.fill();
        if (vista.colores && w.estado === 'derribo') {
          ctx.setLineDash([6, 4]); ctx.strokeStyle = c.color; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }

    // 2) Huecos
    for (const h of this.huecos) {
      if (!this.visible(h)) continue;
      const c = colorDe(h.estado);
      const pts = cuerpo(h);
      poli(pts);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = c.color; ctx.lineWidth = 1.2;
      if (vista.colores && h.estado === 'derribo') ctx.setLineDash([5, 3]);
      const u = unit(h.a, h.b), n = normalIzq(u);
      const [o1, o2] = caras(h.grosor, h.lado);
      const L = largo(h.a, h.b);
      // jambas (líneas de canto en los dos extremos del hueco)
      ctx.beginPath();
      { const p0 = P(pts[0]), p3 = P(pts[3]); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p3.x, p3.y); }
      { const p1 = P(pts[1]), p2 = P(pts[2]); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
      ctx.stroke();
      if (h.tipo === 'ventana') {
        // tres líneas: dos caras y el vidrio en medio
        const om = (o1 + o2) / 2;
        for (const o of [o1, o2, om]) {
          const A = P(sumar(h.a, por(n, o))), B = P(sumar(h.b, por(n, o)));
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        }
        v.etiquetas && v.etiquetas.obstaculo(Colocador.desdePuntos(pts.map(P)));
      } else {
        // puerta: hoja abierta 90° + arco de apertura
        const caraO = h.abreLado === 1 ? o2 : o1;
        const bis = h.bisagra === 'a' ? h.a : h.b;
        const otro = h.bisagra === 'a' ? h.b : h.a;
        const pB = sumar(bis, por(n, caraO));
        const pO = sumar(otro, por(n, caraO));
        const pHoja = sumar(pB, por(n, h.abreLado * L));
        const sB = P(pB), sO = P(pO), sH = P(pHoja);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(sB.x, sB.y); ctx.lineTo(sH.x, sH.y); ctx.stroke();
        ctx.lineWidth = 1;
        const a0 = Math.atan2(sH.y - sB.y, sH.x - sB.x), a1 = Math.atan2(sO.y - sB.y, sO.x - sB.x);
        let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        ctx.beginPath(); ctx.arc(sB.x, sB.y, L * s, a0, a0 + d, d < 0); ctx.stroke();
        v.etiquetas && v.etiquetas.obstaculo(Colocador.desdePuntos([sB, sO, sH, P(pts[0]), P(pts[1]), P(pts[2]), P(pts[3])]));
      }
      ctx.setLineDash([]);
    }

    // 3) Símbolos
    const px = 1 / s;
    for (const sim of this.simbolos) {
      if (!this.visible(sim)) continue;
      const def = SIMBOLOS[sim.clave];
      if (!def) continue;
      const c = colorDe(sim.estado);
      const p = P(sim);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-sim.rot);
      ctx.scale(s, -s);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.2 * px;
      if (vista.colores && sim.estado === 'derribo') ctx.setLineDash([5 * px, 3 * px]);
      pintarSimbolo(ctx, def, sim.ancho, sim.fondo, px, c.color);
      ctx.restore();
      v.etiquetas && v.etiquetas.obstaculo(Colocador.desdePuntos(esquinasSimbolo(sim).map(P)));
    }
    ctx.restore();
  }
}
