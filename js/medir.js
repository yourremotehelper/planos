// Herramienta de medir.
// - Pincha dos puntos: aparece una cota con la distancia real.
// - Usa el imán para enganchar a paredes y esquinas.
// - Si los dos puntos están en paredes paralelas, la cota sale perpendicular.

class Medicion {
  constructor(visor, iman) {
    this.visor = visor;
    this.iman = iman;
    this.cotas = [];          // { a:{x,y}, b:{x,y}, d, perpendicular }
    this.primero = null;      // primer punto de la cota en curso
    this.cursor = null;       // posición enganchada bajo el ratón (vista previa)
    this.activo = false;
    this.alCambiar = null;
    this.alAntesDeCambiar = null;
  }

  activar(si) {
    this.activo = si;
    if (!si) { this.primero = null; this.cursor = null; }
    this.visor.redibujar();
  }

  cancelar() { this.primero = null; this.visor.redibujar(); this.avisar(); }
  deshacer() {
    if (this.primero) this.primero = null; else this.cotas.pop();
    this.visor.redibujar(); this.avisar();
  }
  borrarTodo() { this.cotas = []; this.primero = null; this.visor.redibujar(); this.avisar(); }
  avisar() { if (this.alCambiar) this.alCambiar(this); }

  mover(p, e) {
    this.cursor = p ? this.iman.enganchar(p, Iman.radioPx(e)) : null;
    this.visor.redibujar();
  }

  clic(p, e) {
    const punto = this.iman.enganchar(p, Iman.radioPx(e));
    if (!this.primero) {
      this.primero = punto;
    } else {
      let a = this.primero, b = punto, perpendicular = false;
      if (a.tipo === 'pared' && b.tipo === 'pared' && anguloEntre(a.dir, b.dir) < 5) {
        const t = (a.x - b.lc[0]) * b.dir[0] + (a.y - b.lc[1]) * b.dir[1];
        b = { ...b, x: b.lc[0] + b.dir[0] * t, y: b.lc[1] + b.dir[1] * t };
        perpendicular = true;
      }
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d >= 0.01 && this.alAntesDeCambiar) this.alAntesDeCambiar();
      if (d >= 0.01) this.cotas.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, d, perpendicular });
      this.primero = null;
    }
    this.cursor = punto;
    this.visor.redibujar();
    this.avisar();
  }

  dibujar(ctx) {
    const v = this.visor;
    if (capas.visible('cotas')) for (const c of this.cotas) dibujarCota(ctx, v.aPantalla(c.a.x, c.a.y), v.aPantalla(c.b.x, c.b.y), c.d, false, { registro: v.etiquetas });
    if (!this.activo || v.imprimiendo) return;
    if (this.primero) {
      const a = v.aPantalla(this.primero.x, this.primero.y);
      if (this.cursor) {
        const b = v.aPantalla(this.cursor.x, this.cursor.y);
        dibujarCota(ctx, a, b, Math.hypot(this.cursor.x - this.primero.x, this.cursor.y - this.primero.y), true);
      }
      dibujarMarca(ctx, a, this.primero.tipo);
    }
    if (this.cursor) dibujarMarca(ctx, v.aPantalla(this.cursor.x, this.cursor.y), this.cursor.tipo, this.cursor);
  }
}

// ---------- Dibujo de cotas (también lo usan las estancias) ----------

const fmtM = (d, dec = 2) => d.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtCota = (d) => `${fmtM(d)} m`;

function dibujarCota(ctx, a, b, d, provisional, opciones = {}) {
  const color = opciones.color || (provisional ? 'rgba(217,72,15,.85)' : '#d9480f');
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = opciones.grosor || 2;
  if (provisional) ctx.setLineDash([6, 4]);
  if (!opciones.sinLinea) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  if (L > 1 && !opciones.sinRemates) {
    const nx = -(b.y - a.y) / L * 7, ny = (b.x - a.x) / L * 7;
    ctx.beginPath();
    ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(a.x + nx, a.y + ny);
    ctx.moveTo(b.x - nx, b.y - ny); ctx.lineTo(b.x + nx, b.y + ny);
    ctx.stroke();
  }

  // Texto en el centro, girado como la cota pero siempre legible
  const minimo = opciones.minimoTexto ?? 20;
  if (L > minimo || provisional) {
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    const texto = fmtCota(d);
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(ang);
    const desp = opciones.desplazamiento ?? -12;
    ctx.font = `600 ${opciones.tamTexto || 13}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const w = ctx.measureText(texto).width + 10;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (opciones.registro) {
      const ox = -Math.sin(ang) * desp, oy = Math.cos(ang) * desp;
      opciones.registro.ocupar(Colocador.caja((a.x + b.x) / 2 + ox, (a.y + b.y) / 2 + oy, w, 18, ang));
    }
    ctx.beginPath();
    ctx.roundRect(-w / 2, desp - 9, w, 18, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, 0, desp);
  }
  ctx.restore();
}
