// Imán: engancha un punto a la cara de la pared o a la esquina más cercana.
// Lo usan las herramientas de medir y de dibujar estancias.

class Iman {
  constructor(visor) {
    this.visor = visor;
    this.activo = true;
  }

  static radioPx(e) { return e && e.pointerType === 'touch' ? 36 : 18; }

  // Busca los puntos de pared cerca del cursor y ajusta una o dos rectas.
  //   1 recta  → "pared": el punto cae sobre la cara de la pared
  //   2 rectas que se cruzan → "esquina": el punto cae en el cruce
  // p: posición en pantalla (px CSS). Devuelve metros + tipo.
  // Paredes (rectas) que el escaneo muestra alrededor del punto p (px de pantalla)
  rectasCerca(p, radioPx) {
    const m = this.visor.aMetros(p.x, p.y);
    if (!this.visor.indice) return { m, r: 0, R: 0, rectas: [] };
    const escala = this.visor.vista.escala;
    const r = Math.min(0.25, Math.max(0.03, radioPx / escala));
    const R = Math.min(1.2, Math.max(4 * r, 0.9));
    let pts = this.visor.puntosCerca(m.x, m.y, R);
    if (pts.length < 8) return { m, r, R, rectas: [] };
    if (pts.length > 800) {
      const paso = pts.length / 800;
      pts = Array.from({ length: 800 }, (_, i) => pts[Math.floor(i * paso)]);
    }
    const tol = Math.min(0.02, Math.max(0.012, 1.5 / escala));
    const rectas = [];
    let resto = pts;
    for (let k = 0; k < 4 && resto.length >= 8; k++) {
      const l = ajustarRecta(resto, tol, R);
      if (!l || l.n < Math.max(8, pts.length * 0.04)) break;
      rectas.push(l);
      resto = resto.filter((q) => distRecta(q, l) > tol * 1.5);
    }
    return { m, r, R, rectas };
  }

  // Final de pared (jamba) cerca de p a lo largo de la dirección u: devuelve el punto
  // de la línea (base, u) donde acaba la pared, o null.
  jambaCerca(p, radioPx, base, u) {
    if (!this.activo) return null;
    const { m, r, rectas } = this.rectasCerca(p, radioPx);
    const tCursor = (m.x - base.x) * u.x + (m.y - base.y) * u.y;
    let mejor = null;
    for (const l of rectas) {
      const ang = anguloEntre(l.d, [u.x, u.y]);
      const cand = [];
      if (ang < 10) {
        // pared en la misma dirección: los finales de cada trozo
        for (const [ta, tb] of l.tramos) for (const t of [ta, tb]) cand.push({ x: l.c[0] + l.d[0] * t, y: l.c[1] + l.d[1] * t });
      } else if (ang > 60) {
        // canto de la jamba (perpendicular): dónde corta a la línea
        cand.push({ x: l.c[0], y: l.c[1] });
      }
      for (const q of cand) {
        const t = (q.x - base.x) * u.x + (q.y - base.y) * u.y;
        const d = Math.abs(t - tCursor);
        if (d <= Math.max(r, 0.12) && (!mejor || d < mejor.d)) mejor = { d, t };
      }
    }
    return mejor ? { x: base.x + u.x * mejor.t, y: base.y + u.y * mejor.t, t: mejor.t } : null;
  }

  enganchar(p, radioPx) {
    const m = this.visor.aMetros(p.x, p.y);
    const libre = { x: m.x, y: m.y, tipo: 'libre' };
    if (!this.activo || !this.visor.indice) return libre;

    const escala = this.visor.vista.escala;
    // r: distancia a la que "engancha" (unos 18 px en pantalla)
    // R: zona que se mira para reconocer las paredes. Es mayor que r porque en los rincones
    //    suele haber pocos puntos (muebles, marcos): se reconoce cada pared un poco más allá
    //    y se calcula dónde se cruzan.
    const r = Math.min(0.25, Math.max(0.03, radioPx / escala));
    const R = Math.min(1.2, Math.max(4 * r, 0.9));
    let pts = this.visor.puntosCerca(m.x, m.y, R);
    if (pts.length < 8) return libre;
    if (pts.length > 800) {
      const paso = pts.length / 800;
      pts = Array.from({ length: 800 }, (_, i) => pts[Math.floor(i * paso)]);
    }
    // tolerancia: ~1,5 px, pero entre 1,2 y 2 cm (el grosor del ruido del escáner)
    const tol = Math.min(0.02, Math.max(0.012, 1.5 / escala));

    // Hasta 4 rectas (paredes, caras de tabique, pilares…), de la más clara a la menos
    const rectas = [];
    let resto = pts;
    for (let k = 0; k < 4 && resto.length >= 8; k++) {
      const l = ajustarRecta(resto, tol, R);
      if (!l || l.n < Math.max(8, pts.length * 0.04)) break;
      rectas.push(l);
      resto = resto.filter((q) => distRecta(q, l) > tol * 1.5);
    }
    if (!rectas.length) return libre;

    const cursor = [m.x, m.y];
    // ¿El punto cae a la altura del tramo de pared que se ha visto? (con un margen)
    const dentroDelTramo = (l, q, margen = r) => {
      const t = (q[0] - l.c[0]) * l.d[0] + (q[1] - l.c[1]) * l.d[1];
      return t >= l.t0 - margen && t <= l.t1 + margen;
    };

    // 1) Esquina: cruce de dos rectas no paralelas cerca del cursor
    let esquina = null;
    for (let i = 0; i < rectas.length; i++) {
      for (let j = i + 1; j < rectas.length; j++) {
        const a = rectas[i], b = rectas[j];
        if (anguloEntre(a.d, b.d) < 30) continue;
        const I = cruce(a, b);
        // Se permite prolongar las paredes (rincón tapado por un mueble): basta con que
        // el cruce esté cerca del cursor y a una distancia razonable de lo que se ve de cada pared
        if (!I || !dentroDelTramo(a, I, R) || !dentroDelTramo(b, I, R)) continue;
        const d = Math.hypot(I[0] - m.x, I[1] - m.y);
        if (d <= r && (!esquina || d < esquina.d)) esquina = { d, I, a, b };
      }
    }
    if (esquina) return { x: esquina.I[0], y: esquina.I[1], tipo: 'esquina', d1: esquina.a.d, d2: esquina.b.d };

    // 2) Pared: la recta más cercana al cursor (entre las caras de un tabique, la del lado del cursor)
    let mejor = null;
    for (const l of rectas) {
      const d = distRecta(cursor, l);
      if (d <= r && dentroDelTramo(l, cursor) && (!mejor || d < mejor.d)) mejor = { d, l };
    }
    if (!mejor) return libre;
    const l = mejor.l;
    const t = (m.x - l.c[0]) * l.d[0] + (m.y - l.c[1]) * l.d[1];
    return { x: l.c[0] + l.d[0] * t, y: l.c[1] + l.d[1] * t, tipo: 'pared', dir: l.d, lc: l.c };
  }
}

// ---------- Geometría de rectas ----------

function distRecta(q, l) {
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
// Una pared es larga y continua: se premia que los puntos de la recta ocupen buena parte del
// círculo de búsqueda. Así una "recta" diagonal que cruza el amasijo de una esquina o un marco
// de puerta (muchos puntos, pero todos juntos) pierde frente a la pared de verdad.
function ajustarRecta(pts, tol, radio) {
  if (pts.length < 2) return null;
  let semilla = 7;
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
  let mejor = null;
  for (let it = 0; it < 120; it++) {
    const p = pts[Math.floor(azar() * pts.length)];
    const q = pts[Math.floor(azar() * pts.length)];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < tol * 2) continue;
    const l = { c: p, d: [(q[0] - p[0]) / L, (q[1] - p[1]) / L] };
    let n = 0, t0 = Infinity, t1 = -Infinity;
    for (const s of pts) {
      if (distRecta(s, l) > tol) continue;
      n++;
      const t = (s[0] - p[0]) * l.d[0] + (s[1] - p[1]) * l.d[1];
      if (t < t0) t0 = t; if (t > t1) t1 = t;
    }
    const puntuacion = radio ? n * Math.min(1, (t1 - t0) / radio) : n;
    if (!mejor || puntuacion > mejor.puntuacion) mejor = { ...l, n, puntuacion };
  }
  if (!mejor) return null;

  // Afinar con todos los puntos cercanos (componente principal). Se repite 3 veces con la
  // tolerancia cada vez más justa, para quedarse con una sola cara si hay dos muy juntas.
  let l = { c: mejor.c, d: mejor.d };
  let dentro = [], cx = 0, cy = 0, d = mejor.d;
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const t = vuelta === 0 ? tol : tol * 0.75;
    const nuevos = pts.filter((s) => distRecta(s, l) <= t);
    if (nuevos.length < 2) break;
    dentro = nuevos;
    cx = 0; cy = 0;
    for (const s of dentro) { cx += s[0]; cy += s[1]; }
    cx /= dentro.length; cy /= dentro.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const s of dentro) {
      const a = s[0] - cx, b = s[1] - cy;
      sxx += a * a; sxy += a * b; syy += b * b;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    d = [Math.cos(ang), Math.sin(ang)];
    l = { c: [cx, cy], d };
  }
  if (!dentro.length) return null;
  // tramo ocupado por los puntos a lo largo de la recta, partido donde hay huecos
  // (dos trozos de pared alineados a cada lado de una puerta son la misma recta)
  const ts = dentro.map((s) => (s[0] - cx) * d[0] + (s[1] - cy) * d[1]).sort((a, b) => a - b);
  const tramos = [];
  let ini = ts[0];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] > Math.max(0.15, 4 * tol)) { tramos.push([ini, ts[i - 1]]); ini = ts[i]; }
  }
  tramos.push([ini, ts[ts.length - 1]]);
  return { c: [cx, cy], d, n: dentro.length, t0: ts[0], t1: ts[ts.length - 1], tramos };
}

// Indicador de enganche: cuadrado = pared, círculo = esquina, cruz = punto libre
function dibujarMarca(ctx, p, tipo, info, color = '#d9480f') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 2;
  if (tipo === 'esquina') {
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (tipo === 'pared') {
    if (info && info.dir) {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x - info.dir[0] * 22, p.y + info.dir[1] * 22);
      ctx.lineTo(p.x + info.dir[0] * 22, p.y - info.dir[1] * 22);
      ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 2;
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
