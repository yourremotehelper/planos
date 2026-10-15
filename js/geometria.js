// Cálculos geométricos sobre la nube de puntos.
// Se usa dentro del worker (importScripts), así que todo va en funciones globales.

// Generador aleatorio con semilla: mismo archivo → mismo resultado siempre
function crearAleatorio(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 1. Detectar el suelo ----------
// Divide la planta en celdas de 50 cm, toma el punto "más bajo" de cada celda
// (percentil 2 %, para ignorar puntos sueltos) y busca el plano que pasa por más
// de esos puntos bajos. Ese plano es el suelo.
function detectarSuelo(xyz, min, max) {
  const n = xyz.length / 3;
  const celda = 0.5;
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / celda));
  const ny = Math.max(1, Math.ceil((max[1] - min[1]) / celda));
  const nc = nx * ny;
  const paso = n > 1500000 ? 2 : 1; // con la mitad de puntos sobra

  const idCelda = (i) => {
    const cx = Math.min(nx - 1, Math.floor((xyz[i * 3] - min[0]) / celda));
    const cy = Math.min(ny - 1, Math.floor((xyz[i * 3 + 1] - min[1]) / celda));
    return cy * nx + cx;
  };

  // Agrupar las alturas por celda (conteo + desplazamientos, sin objetos)
  const cuenta = new Int32Array(nc + 1);
  for (let i = 0; i < n; i += paso) cuenta[idCelda(i) + 1]++;
  for (let c = 0; c < nc; c++) cuenta[c + 1] += cuenta[c];
  const zs = new Float32Array(cuenta[nc]);
  const pos = cuenta.slice(0, nc);
  const sx = new Float64Array(nc), sy = new Float64Array(nc);
  for (let i = 0; i < n; i += paso) {
    const c = idCelda(i);
    zs[pos[c]++] = xyz[i * 3 + 2];
    sx[c] += xyz[i * 3]; sy[c] += xyz[i * 3 + 1];
  }

  const bajos = [];
  for (let c = 0; c < nc; c++) {
    const ini = cuenta[c], fin = cuenta[c + 1], k = fin - ini;
    if (k < 100) continue;
    const trozo = zs.subarray(ini, fin).slice().sort();
    bajos.push([sx[c] / k, sy[c] / k, trozo[Math.floor(k * 0.02)]]);
  }
  if (bajos.length < 10) throw new Error('No se ha podido detectar el suelo: el escaneo tiene muy pocos puntos.');

  // RANSAC: probar planos con 3 puntos al azar y quedarse con el que tiene más apoyos
  const azar = crearAleatorio(12345);
  let mejor = null;
  for (let it = 0; it < 3000; it++) {
    const a = bajos[Math.floor(azar() * bajos.length)];
    const b = bajos[Math.floor(azar() * bajos.length)];
    const c = bajos[Math.floor(azar() * bajos.length)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(nn[0], nn[1], nn[2]);
    if (L < 1e-9) continue;
    nn = nn.map((q) => q / L);
    if (nn[2] < 0) nn = nn.map((q) => -q);
    if (nn[2] < 0.95) continue; // el suelo no puede estar inclinado más de ~18°
    const d = -(nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]);
    let apoyos = 0;
    for (const p of bajos) if (Math.abs(nn[0] * p[0] + nn[1] * p[1] + nn[2] * p[2] + d) < 0.05) apoyos++;
    // a igualdad de apoyos, preferimos el plano más bajo (el suelo, no una mesa)
    if (!mejor || apoyos > mejor.apoyos || (apoyos === mejor.apoyos && -d / nn[2] < mejor.z0)) {
      mejor = { apoyos, z0: -d / nn[2] };
      mejor.n = nn; mejor.d = d;
    }
  }
  if (!mejor) throw new Error('No se ha encontrado un suelo horizontal en el escaneo.');

  // Afinar con mínimos cuadrados sobre los apoyos: z = a·x + b·y + c
  const ap = bajos.filter((p) => Math.abs(mejor.n[0] * p[0] + mejor.n[1] * p[1] + mejor.n[2] * p[2] + mejor.d) < 0.05);
  const s = { xx: 0, xy: 0, yy: 0, x: 0, y: 0, xz: 0, yz: 0, z: 0 };
  const mx = ap.reduce((t, p) => t + p[0], 0) / ap.length;
  const my = ap.reduce((t, p) => t + p[1], 0) / ap.length;
  for (const [x0, y0, z] of ap) {
    const x = x0 - mx, y = y0 - my;
    s.xx += x * x; s.xy += x * y; s.yy += y * y; s.xz += x * z; s.yz += y * z; s.z += z;
  }
  const det = s.xx * s.yy - s.xy * s.xy;
  const A = (s.xz * s.yy - s.yz * s.xy) / det;
  const B = (s.yz * s.xx - s.xz * s.xy) / det;
  const C = s.z / ap.length - A * mx - B * my;
  const L = Math.hypot(A, B, 1);
  const normal = [-A / L, -B / L, 1 / L];
  return {
    normal,
    d: -C / L, // altura sobre el suelo = normal·p + d
    inclinacion: Math.acos(normal[2]) * 180 / Math.PI,
    cobertura: ap.length / bajos.length,
  };
}

// ---------- 2. Orientación de las paredes ----------
// Gira el corte de paredes y busca el ángulo en el que los puntos se "apilan" más
// en líneas horizontales y verticales: ese es el ángulo de las paredes.
function puntuarAngulo(u, v, ang, cx, cy, radio) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const res = 0.02;
  const nb = Math.ceil((2 * radio) / res) + 1;
  const hx = new Int32Array(nb), hy = new Int32Array(nb);
  for (let i = 0; i < u.length; i++) {
    const a = u[i] - cx, b = v[i] - cy;
    hx[Math.floor((a * c - b * s + radio) / res)]++;
    hy[Math.floor((a * s + b * c + radio) / res)]++;
  }
  let p = 0;
  for (let i = 0; i < nb; i++) p += hx[i] * hx[i] + hy[i] * hy[i];
  return p;
}

function buscarOrientacion(u, v) {
  let cx = 0, cy = 0;
  for (let i = 0; i < u.length; i++) { cx += u[i]; cy += v[i]; }
  cx /= u.length; cy /= u.length;
  let radio = 0;
  for (let i = 0; i < u.length; i++) radio = Math.max(radio, Math.hypot(u[i] - cx, v[i] - cy));
  radio += 0.1;

  let mejor = 0, mejorP = -1;
  for (let g = 0; g < 90; g += 0.5) {
    const p = puntuarAngulo(u, v, g * Math.PI / 180, cx, cy, radio);
    if (p > mejorP) { mejorP = p; mejor = g; }
  }
  const base = mejor;
  for (let g = base - 0.5; g <= base + 0.5; g += 0.05) {
    const p = puntuarAngulo(u, v, g * Math.PI / 180, cx, cy, radio);
    if (p > mejorP) { mejorP = p; mejor = g; }
  }
  return ((mejor % 90) + 90) % 90;
}

// ---------- 3. Altura del techo ----------
// La altura con más puntos por encima de 1,8 m suele ser el techo.
function detectarTecho(h) {
  const res = 0.05, desde = 1.8, hasta = 6;
  const nb = Math.ceil((hasta - desde) / res);
  const hist = new Int32Array(nb);
  for (let i = 0; i < h.length; i++) {
    if (h[i] >= desde && h[i] < hasta) hist[Math.floor((h[i] - desde) / res)]++;
  }
  let m = 0;
  for (let i = 1; i < nb; i++) if (hist[i] > hist[m]) m = i;
  if (!hist[m]) return null;
  // afinar: media de las alturas dentro del pico (±5 cm)
  const c = desde + (m + 0.5) * res;
  let s = 0, k = 0;
  for (let i = 0; i < h.length; i++) if (Math.abs(h[i] - c) <= 0.05) { s += h[i]; k++; }
  return s / k;
}

function percentil(arr, q, muestras = 200000) {
  const paso = Math.max(1, Math.floor(arr.length / muestras));
  const m = [];
  for (let i = 0; i < arr.length; i += paso) m.push(arr[i]);
  m.sort((a, b) => a - b);
  return m[Math.min(m.length - 1, Math.floor(q * m.length))];
}

// ---------- Proceso completo ----------
// Devuelve las coordenadas ya niveladas y enderezadas:
//   x, y = planta (metros), h = altura sobre el suelo (metros)
function nivelarYEnderezar(xyz, min, max, avisar) {
  const n = xyz.length / 3;

  avisar('Detectando el suelo…');
  const suelo = detectarSuelo(xyz, min, max);
  const [nx, ny, nz] = suelo.normal;

  // Dos ejes horizontales perpendiculares al suelo
  let e1 = [1 - nx * nx, -nx * ny, -nx * nz];
  const L1 = Math.hypot(...e1);
  e1 = e1.map((q) => q / L1);
  const e2 = [ny * e1[2] - nz * e1[1], nz * e1[0] - nx * e1[2], nx * e1[1] - ny * e1[0]];

  const u = new Float32Array(n), v = new Float32Array(n), h = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    u[i] = x * e1[0] + y * e1[1] + z * e1[2];
    v[i] = x * e2[0] + y * e2[1] + z * e2[2];
    h[i] = x * nx + y * ny + z * nz + suelo.d;
  }

  avisar('Enderezando las paredes…');
  // Corte a 1,0–1,2 m: a esa altura hay sobre todo paredes
  let k = 0;
  for (let i = 0; i < n; i++) if (h[i] > 1.0 && h[i] < 1.2) k++;
  const paso = Math.max(1, Math.floor(k / 300000));
  const cu = [], cv = [];
  for (let i = 0, j = 0; i < n; i++) {
    if (h[i] > 1.0 && h[i] < 1.2) { if (j % paso === 0) { cu.push(u[i]); cv.push(v[i]); } j++; }
  }
  const angulo = cu.length > 100 ? buscarOrientacion(cu, cv) : 0;

  const a = angulo * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < n; i++) {
    const uu = u[i], vv = v[i];
    u[i] = uu * c - vv * s;
    v[i] = uu * s + vv * c;
  }

  // Dejar la esquina inferior izquierda de la planta en (0,0), ignorando puntos sueltos
  const x0 = percentil(u, 0.002), y0 = percentil(v, 0.002);
  for (let i = 0; i < n; i++) { u[i] -= x0; v[i] -= y0; }
  const ancho = percentil(u, 0.998), largo = percentil(v, 0.998);

  avisar('Midiendo la altura del techo…');
  const techo = detectarTecho(h);

  return {
    x: u, y: v, h,
    inclinacion: suelo.inclinacion,
    coberturaSuelo: suelo.cobertura,
    angulo,
    techo,
    ancho, largo,
  };
}
