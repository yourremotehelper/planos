// Herramienta de medir con imán.
// - Pincha dos puntos: aparece una cota con la distancia real.
// - Imán: el punto se engancha a la cara de la pared o a la esquina más cercana.
// - Si los dos puntos están en paredes paralelas, la cota sale perpendicular.

class Medicion {
  constructor(visor) {
    this.visor = visor;
    this.activo = false;
    this.iman = true;
    this.cotas = [];          // { a:{x,y}, b:{x,y}, d, perpendicular }
    this.primero = null;      // primer punto de la cota en curso
    this.cursor = null;       // posición enganchada bajo el ratón (vista previa)
    this.alCambiar = null;    // aviso a la pantalla (número de cotas, etc.)

    visor.alHacerClic = (p, e) => { if (this.activo) this.clic(p, e); };
    visor.alMoverCursor = (p, e) => { if (this.activo) this.mover(p, e); };
    visor.alDibujarEncima = (ctx) => this.dibujar(ctx);

    document.addEventListener('keydown', (e) => {
      if (!this.activo || e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') this.cancelar();
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.deshacer(); }
    });
  }

  // ---------- Acciones ----------

  activar(si) {
    this.activo = si;
    this.visor.bloquearDobleClic = si;
    this.visor.lienzo.classList.toggle('modoMedir', si);
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

  radioPx(e) { return e && e.pointerType === 'touch' ? 36 : 18; }

  mover(p, e) {
    this.cursor = p ? this.enganchar(p, this.radioPx(e)) : null;
    this.visor.redibujar();
  }

  clic(p, e) {
    const punto = this.enganchar(p, this.radioPx(e));
    if (!this.primero) {
      this.primero = punto;
    } else {
      let a = this.primero, b = punto, perpendicular = false;
      // Paredes paralelas → medir en perpendicular desde el primer punto
      if (a.tipo === 'pared' && b.tipo === 'pared' && anguloEntre(a.dir, b.dir) < 5) {
        const t = (a.x - b.lc[0]) * b.dir[0] + (a.y - b.lc[1]) * b.dir[1];
        b = { ...b, x: b.lc[0] + b.dir[0] * t, y: b.lc[1] + b.dir[1] * t };
        perpendicular = true;
      }
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d >= 0.01) this.cotas.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, d, perpendicular });
      this.primero = null;
    }
    this.cursor = punto;
    this.visor.redibujar();
    this.avisar();
  }

  // ---------- Imán ----------
  // Busca los puntos de pared cerca del cursor y ajusta una o dos rectas.
  //   1 recta  → "pared": el punto cae sobre la cara de la pared
  //   2 rectas que se cruzan → "esquina": el punto cae en el cruce
  enganchar(p, radioPx) {
    const m = this.visor.aMetros(p.x, p.y);
    const libre = { x: m.x, y: m.y, tipo: 'libre' };
    if (!this.iman || !this.visor.indice) return libre;

    const escala = this.visor.vista.escala;
    const r = Math.min(0.6, Math.max(0.03, radioPx / escala));
    let pts = this.visor.puntosCerca(m.x, m.y, r);
    if (pts.length < 8) return libre;
    if (pts.length > 500) {
      const paso = pts.length / 500;
      pts = Array.from({ length: 500 }, (_, i) => pts[Math.floor(i * paso)]);
    }
    const tol = Math.max(0.012, 1.5 / escala);

    let l1 = ajustarRecta(pts, tol);
    if (!l1 || l1.n < 8) return libre;
    let resto = pts.filter((q) => distRecta(q, l1) > tol * 1.5);

    // ¿Hay otra cara paralela (las dos caras de un tabique)? Nos quedamos con la más cercana al cursor
    if (resto.length >= 8) {
      const paralela = ajustarRecta(resto, tol);
      if (paralela && paralela.n >= Math.max(8, l1.n * 0.4) && anguloEntre(l1.d, paralela.d) < 5 &&
          distRecta([m.x, m.y], paralela) < distRecta([m.x, m.y], l1)) {
        l1 = paralela;
        resto = pts.filter((q) => distRecta(q, l1) > tol * 1.5);
      }
    }

    // ¿Esquina? Segunda recta con ángulo claro respecto a la primera
    if (resto.length >= Math.max(8, pts.length * 0.15)) {
      const l2 = ajustarRecta(resto, tol);
      if (l2 && l2.n >= 8 && anguloEntre(l1.d, l2.d) > 30) {
        const I = cruce(l1, l2);
        if (I && Math.hypot(I[0] - m.x, I[1] - m.y) < r * 1.5) {
          return { x: I[0], y: I[1], tipo: 'esquina', d1: l1.d, d2: l2.d };
        }
      }
    }

    // Pared: proyectar el cursor sobre la recta
    const t = (m.x - l1.c[0]) * l1.d[0] + (m.y - l1.c[1]) * l1.d[1];
    return { x: l1.c[0] + l1.d[0] * t, y: l1.c[1] + l1.d[1] * t, tipo: 'pared', dir: l1.d, lc: l1.c };
  }

  // ---------- Dibujo ----------

  dibujar(ctx) {
    const v = this.visor;
    for (const c of this.cotas) dibujarCota(ctx, v.aPantalla(c.a.x, c.a.y), v.aPantalla(c.b.x, c.b.y), c.d, false);

    if (!this.activo) return;

    if (this.primero) {
      const a = v.aPantalla(this.primero.x, this.primero.y);
      if (this.cursor) {
        const b = v.aPantalla(this.cursor.x, this.cursor.y);
        dibujarCota(ctx, a, b, Math.hypot(this.cursor.x - this.primero.x, this.cursor.y - this.primero.y), true);
      }
      dibujarMarca(ctx, a, this.primero.tipo);
    }
    if (this.cursor) {
      dibujarMarca(ctx, v.aPantalla(this.cursor.x, this.cursor.y), this.cursor.tipo, this.cursor);
    }
  }
}

// ---------- Geometría de rectas ----------

function distRecta(q, l) {
  // distancia de q a la recta (c, d): componente perpendicular
  return Math.abs((q[0] - l.c[0]) * -l.d[1] + (q[1] - l.c[1]) * l.d[0]);
}

function anguloEntre(d1, d2) {
  const c = Math.abs(d1[0] * d2[0] + d1[1] * d2[1]);
  return Math.acos(Math.min(1, c)) * 180 / Math.PI;
}

function cruce(l1, l2) {
  const det = l1.d[0] * -l2.d[1] - l1.d[1] * -l2.d[0];
  if (Math.abs(det) < 1e-9) return null;
  const bx = l2.c[0] - l1.c[0], by = l2.c[1] - l1.c[1];
  const t = (bx * -l2.d[1] - by * -l2.d[0]) / det;
  return [l1.c[0] + l1.d[0] * t, l1.c[1] + l1.d[1] * t];
}

// RANSAC: prueba rectas entre pares de puntos y se queda con la que tiene más puntos cerca;
// después la afina con todos esos puntos (componente principal).
function ajustarRecta(pts, tol) {
  if (pts.length < 2) return null;
  let semilla = 7;
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
  let mejor = null;
  for (let it = 0; it < 80; it++) {
    const p = pts[Math.floor(azar() * pts.length)];
    const q = pts[Math.floor(azar() * pts.length)];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < tol * 2) continue;
    const l = { c: p, d: [(q[0] - p[0]) / L, (q[1] - p[1]) / L] };
    let n = 0;
    for (const s of pts) if (distRecta(s, l) <= tol) n++;
    if (!mejor || n > mejor.n) mejor = { ...l, n };
  }
  if (!mejor) return null;

  const dentro = pts.filter((s) => distRecta(s, mejor) <= tol);
  let cx = 0, cy = 0;
  for (const s of dentro) { cx += s[0]; cy += s[1]; }
  cx /= dentro.length; cy /= dentro.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const s of dentro) {
    const a = s[0] - cx, b = s[1] - cy;
    sxx += a * a; sxy += a * b; syy += b * b;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c: [cx, cy], d: [Math.cos(ang), Math.sin(ang)], n: dentro.length };
}

// ---------- Dibujo de cotas ----------

const fmtCota = (d) => `${d.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;

function dibujarCota(ctx, a, b, d, provisional) {
  const color = provisional ? 'rgba(217,72,15,.85)' : '#d9480f';
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (provisional) ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);

  // Remates perpendiculares en los extremos
  if (L > 1) {
    const nx = -(b.y - a.y) / L * 7, ny = (b.x - a.x) / L * 7;
    ctx.beginPath();
    ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(a.x + nx, a.y + ny);
    ctx.moveTo(b.x - nx, b.y - ny); ctx.lineTo(b.x + nx, b.y + ny);
    ctx.stroke();
  }

  // Texto en el centro, girado como la cota pero siempre legible
  if (L > 20 || provisional) {
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    const texto = fmtCota(d);
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(ang);
    ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = ctx.measureText(texto).width + 10;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -21, w, 18, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, 0, -12);
  }
  ctx.restore();
}

// Indicador de enganche: cuadrado = pared, círculo = esquina, cruz = punto libre
function dibujarMarca(ctx, p, tipo, info) {
  ctx.save();
  ctx.strokeStyle = '#d9480f';
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 2;
  if (tipo === 'esquina') {
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (tipo === 'pared') {
    if (info && info.dir) {
      // tramo de la pared detectada
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(217,72,15,.45)';
      ctx.beginPath();
      ctx.moveTo(p.x - info.dir[0] * 22, p.y + info.dir[1] * 22);
      ctx.lineTo(p.x + info.dir[0] * 22, p.y - info.dir[1] * 22);
      ctx.stroke();
      ctx.strokeStyle = '#d9480f'; ctx.lineWidth = 2;
    }
    ctx.beginPath(); ctx.rect(p.x - 5, p.y - 5, 10, 10); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y);
    ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7);
    ctx.stroke();
  }
  ctx.restore();
}
