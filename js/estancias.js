// Estancias: se dibujan pinchando en sus esquinas (con imán).
// Cada estancia calcula m² de suelo, perímetro, altura de techo y m² de paredes.

const COLOR_ESTANCIA = '#1864ab';

class Estancias {
  constructor(visor, iman) {
    this.visor = visor;
    this.iman = iman;
    this.lista = [];        // { id, nombre, puntos:[{x,y}], area, perimetro, altura, alturaAuto }
    this.puntos = [];       // estancia que se está dibujando
    this.cursor = null;
    this.activo = false;
    this.seleccion = null;  // id
    this.siguienteId = 1;
    this.alCambiar = null;
  }

  avisar() { if (this.alCambiar) this.alCambiar(this); }

  activar(si) {
    this.activo = si;
    if (!si) { this.puntos = []; this.cursor = null; }
    this.visor.redibujar();
  }

  // ---------- Dibujar ----------

  // ¿El cursor está encima del primer punto? (para cerrar)
  cercaDelPrimero(p, e) {
    if (this.puntos.length < 3) return false;
    const a = this.visor.aPantalla(this.puntos[0].x, this.puntos[0].y);
    return Math.hypot(a.x - p.x, a.y - p.y) <= (e && e.pointerType === 'touch' ? 24 : 12);
  }

  mover(p, e) {
    if (!p) { this.cursor = null; this.visor.redibujar(); return; }
    if (this.cercaDelPrimero(p, e)) {
      this.cursor = { ...this.puntos[0], tipo: 'cerrar' };
    } else {
      this.cursor = this.iman.enganchar(p, Iman.radioPx(e));
    }
    this.visor.redibujar();
  }

  clic(p, e) {
    if (this.cercaDelPrimero(p, e)) { this.cerrar(); return; }
    const q = this.iman.enganchar(p, Iman.radioPx(e));
    const ultimo = this.puntos[this.puntos.length - 1];
    if (ultimo && Math.hypot(q.x - ultimo.x, q.y - ultimo.y) < 0.01) {
      // doble clic en el mismo sitio = cerrar
      if (this.puntos.length >= 3) this.cerrar();
      return;
    }
    this.puntos.push({ x: q.x, y: q.y, tipo: q.tipo });
    this.cursor = q;
    this.visor.redibujar();
    this.avisar();
  }

  deshacerPunto() { this.puntos.pop(); this.visor.redibujar(); this.avisar(); }
  cancelar() { this.puntos = []; this.visor.redibujar(); this.avisar(); }

  cerrar() {
    if (this.puntos.length < 3) return;
    const puntos = this.puntos.map(({ x, y }) => ({ x, y }));
    this.puntos = [];
    const e = this.crear(puntos);
    this.seleccion = e.id;
    this.visor.redibujar();
    this.avisar();
  }

  crear(puntos, nombre, altura) {
    const id = this.siguienteId++;
    const e = { id, nombre: nombre || `Estancia ${id}`, puntos };
    e.alturaAuto = this.alturaTecho(puntos);
    e.altura = altura || e.alturaAuto || this.visor.datos.techo || 2.5;
    this.recalcular(e);
    this.lista.push(e);
    return e;
  }

  recalcular(e) {
    e.area = areaPoligono(e.puntos);
    e.perimetro = perimetroPoligono(e.puntos);
    e.m2Paredes = e.perimetro * e.altura;
  }

  // Altura de techo dentro de la estancia: la altura con más puntos por encima de 1,8 m
  alturaTecho(puntos) {
    const { x, y, h } = this.visor.datos;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of puntos) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const desde = 1.8, res = 0.02, nb = Math.ceil((6 - desde) / res);
    const hist = new Int32Array(nb);
    for (let i = 0; i < h.length; i++) {
      if (h[i] < desde || h[i] >= 6) continue;
      const px = x[i], py = y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      if (!dentroPoligono(px, py, puntos)) continue;
      hist[Math.floor((h[i] - desde) / res)]++;
    }
    let m = 0;
    for (let k = 1; k < nb; k++) if (hist[k] > hist[m]) m = k;
    if (hist[m] <= 50) return null;
    // media ponderada del pico y sus vecinas (más fino que el centro de la caja)
    let s = 0, w = 0;
    for (let k = Math.max(0, m - 2); k <= Math.min(nb - 1, m + 2); k++) { s += hist[k] * (desde + (k + 0.5) * res); w += hist[k]; }
    return Math.round((s / w) * 100) / 100;
  }

  // ---------- Editar ----------

  renombrar(id, nombre) {
    const e = this.lista.find((q) => q.id === id);
    if (e) { e.nombre = nombre.trim() || e.nombre; this.visor.redibujar(); this.avisar(); }
  }
  cambiarAltura(id, altura) {
    const e = this.lista.find((q) => q.id === id);
    if (e && altura > 0.5 && altura < 10) { e.altura = altura; this.recalcular(e); this.visor.redibujar(); this.avisar(); }
  }
  borrar(id) {
    this.lista = this.lista.filter((q) => q.id !== id);
    if (this.seleccion === id) this.seleccion = null;
    this.visor.redibujar(); this.avisar();
  }
  borrarTodo() { this.lista = []; this.puntos = []; this.seleccion = null; this.siguienteId = 1; this.visor.redibujar(); this.avisar(); }

  estanciaEn(p) {
    const m = this.visor.aMetros(p.x, p.y);
    for (let k = this.lista.length - 1; k >= 0; k--) {
      if (dentroPoligono(m.x, m.y, this.lista[k].puntos)) return this.lista[k];
    }
    return null;
  }
  seleccionar(id) { this.seleccion = id; this.visor.redibujar(); this.avisar(); }

  totales() {
    return this.lista.reduce((t, e) => ({
      area: t.area + e.area, perimetro: t.perimetro + e.perimetro, m2Paredes: t.m2Paredes + e.m2Paredes,
    }), { area: 0, perimetro: 0, m2Paredes: 0 });
  }

  // ---------- Pantalla ----------

  dibujar(ctx) {
    const v = this.visor;
    for (const e of this.lista) this.dibujarEstancia(ctx, e, e.id === this.seleccion);

    if (!this.activo) return;
    const pts = this.puntos.map((q) => v.aPantalla(q.x, q.y));
    if (pts.length) {
      const cur = this.cursor ? v.aPantalla(this.cursor.x, this.cursor.y) : null;
      // relleno provisional
      if (cur && pts.length >= 2) {
        ctx.save();
        ctx.fillStyle = 'rgba(24,100,171,.10)';
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.lineTo(cur.x, cur.y);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // lados ya puestos
      for (let i = 1; i < pts.length; i++) {
        const a = this.puntos[i - 1], b = this.puntos[i];
        dibujarCota(ctx, pts[i - 1], pts[i], Math.hypot(b.x - a.x, b.y - a.y), false,
          { color: COLOR_ESTANCIA, sinRemates: true, desplazamiento: 0, minimoTexto: 45, tamTexto: 12 });
      }
      // lado provisional hasta el cursor
      if (cur) {
        const a = this.puntos[this.puntos.length - 1];
        dibujarCota(ctx, pts[pts.length - 1], cur, Math.hypot(this.cursor.x - a.x, this.cursor.y - a.y), true,
          { color: 'rgba(24,100,171,.85)', sinRemates: true, desplazamiento: 0, tamTexto: 12 });
      }
      for (const q of pts) {
        ctx.save(); ctx.fillStyle = COLOR_ESTANCIA;
        ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      // primer punto resaltado (para cerrar)
      if (pts.length >= 3) {
        ctx.save(); ctx.strokeStyle = COLOR_ESTANCIA; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 9, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    }
    if (this.cursor) {
      const c = v.aPantalla(this.cursor.x, this.cursor.y);
      if (this.cursor.tipo === 'cerrar') {
        ctx.save(); ctx.fillStyle = COLOR_ESTANCIA;
        ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✓', c.x, c.y + 1);
        ctx.restore();
      } else {
        dibujarMarca(ctx, c, this.cursor.tipo, this.cursor, COLOR_ESTANCIA);
      }
    }
  }

  dibujarEstancia(ctx, e, seleccionada) {
    const v = this.visor;
    const pts = e.puntos.map((q) => v.aPantalla(q.x, q.y));
    ctx.save();
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = seleccionada ? 'rgba(24,100,171,.22)' : 'rgba(24,100,171,.12)';
    ctx.fill();
    ctx.strokeStyle = seleccionada ? '#d9480f' : COLOR_ESTANCIA;
    ctx.lineWidth = seleccionada ? 3 : 2;
    ctx.stroke();
    ctx.restore();

    // cota de cada lado
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const a = e.puntos[i], b = e.puntos[j];
      dibujarCota(ctx, pts[i], pts[j], Math.hypot(b.x - a.x, b.y - a.y), false,
        { color: COLOR_ESTANCIA, sinLinea: true, sinRemates: true, desplazamiento: 0, minimoTexto: 60, tamTexto: 11 });
    }

    // nombre y m² en el centro
    const c = centroPoligono(e.puntos);
    const pc = v.aPantalla(c.x, c.y);
    const linea1 = e.nombre, linea2 = `${fmtM(e.area)} m²`;
    ctx.save();
    ctx.font = '700 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w1 = ctx.measureText(linea1).width;
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = Math.max(w1, ctx.measureText(linea2).width) + 14;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.strokeStyle = seleccionada ? '#d9480f' : COLOR_ESTANCIA;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(pc.x - w / 2, pc.y - 19, w, 38, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COLOR_ESTANCIA;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(linea1, pc.x, pc.y - 8);
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(linea2, pc.x, pc.y + 9);
    ctx.restore();
  }
}

// ---------- Geometría de polígonos ----------

function areaPoligono(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    s += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(s) / 2;
}

function perimetroPoligono(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    s += Math.hypot(p[j].x - p[i].x, p[j].y - p[i].y);
  }
  return s;
}

function centroPoligono(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const f = p[i].x * p[j].y - p[j].x * p[i].y;
    a += f; cx += (p[i].x + p[j].x) * f; cy += (p[i].y + p[j].y) * f;
  }
  if (Math.abs(a) < 1e-9) return { x: p[0].x, y: p[0].y };
  const c = { x: cx / (3 * a), y: cy / (3 * a) };
  if (dentroPoligono(c.x, c.y, p)) return c;
  // forma en L/U: usar el punto medio interior de una línea horizontal por el centro
  const xs = [];
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const A = p[i], B = p[j];
    if ((A.y > c.y) !== (B.y > c.y)) xs.push(A.x + ((c.y - A.y) / (B.y - A.y)) * (B.x - A.x));
  }
  xs.sort((m, n) => m - n);
  let mejor = null;
  for (let k = 0; k + 1 < xs.length; k += 2) if (!mejor || xs[k + 1] - xs[k] > mejor[1] - mejor[0]) mejor = [xs[k], xs[k + 1]];
  return mejor ? { x: (mejor[0] + mejor[1]) / 2, y: c.y } : c;
}

function dentroPoligono(x, y, p) {
  let dentro = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) dentro = !dentro;
  }
  return dentro;
}
