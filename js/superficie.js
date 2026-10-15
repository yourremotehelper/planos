// Superficie automática.
// Trabaja sobre una cuadrícula de 5 × 5 cm vista desde arriba:
//   1. Suelo: celdas donde el escáner vio suelo.
//   2. Paredes: celdas con puntos abajo (0,2–0,8 m) Y arriba (1,4–2,0 m) → algo vertical y alto.
//      Las mesas o sillas no cuentan como pared.
//   3. Huecos tapados por muebles: zonas sin suelo visto pero rodeadas de suelo/paredes → se suman.
//   4. Zonas: se "cierran" las puertas engordando las paredes 45 cm y se separa el suelo en zonas.
// Cada zona se puede excluir pulsando encima (p. ej. la acera que se ve por la puerta).

const RES = 0.05;          // tamaño de celda (m)
const HUECO_MAX = 6;       // m²: hueco máximo que se considera "suelo tapado por muebles"
const CIERRE_PUERTA = 9;   // celdas (45 cm): cierra huecos de hasta ~90 cm entre paredes
const ZONA_MIN = 1.0;      // m²: zonas más pequeñas se unen a la vecina

// ---------- Utilidades de cuadrícula ----------

function crearMalla(datos) {
  const W = Math.ceil(datos.ancho / RES) + 2, H = Math.ceil(datos.largo / RES) + 2;
  return { W, H, res: RES };
}

function marcar(datos, malla, desde, hasta) {
  const { W, H } = malla;
  const out = new Uint8Array(W * H);
  const { x, y, h } = datos;
  for (let i = 0; i < h.length; i++) {
    if (h[i] < desde || h[i] > hasta) continue;
    const cx = Math.floor(x[i] / RES), cy = Math.floor(y[i] / RES);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    out[cy * W + cx] = 1;
  }
  return out;
}

// Ensanchar (dilatar) n celdas — distancia "en cuadrado" (8 vecinos)
function ensanchar(src, W, H, n = 1) {
  let a = src;
  for (let k = 0; k < n; k++) {
    const b = new Uint8Array(W * H);
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cy * W + cx;
        if (a[i]) { b[i] = 1; continue; }
        const x0 = cx > 0 ? -1 : 0, x1 = cx < W - 1 ? 1 : 0, y0 = cy > 0 ? -1 : 0, y1 = cy < H - 1 ? 1 : 0;
        let v = 0;
        for (let dy = y0; dy <= y1 && !v; dy++) for (let dx = x0; dx <= x1; dx++) if (a[i + dy * W + dx]) { v = 1; break; }
        b[i] = v;
      }
    }
    a = b;
  }
  return a;
}
function encoger(src, W, H, n = 1) {
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i++) inv[i] = src[i] ? 0 : 1;
  const e = ensanchar(inv, W, H, n);
  for (let i = 0; i < e.length; i++) e[i] = e[i] ? 0 : 1;
  return e;
}

// Etiquetar regiones conectadas (4 vecinos) de las celdas con mask=1
function etiquetar(mask, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const cola = new Int32Array(W * H);
  const regiones = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = regiones.length;
    let ini = 0, fin = 0, n = 0, borde = false;
    cola[fin++] = s; lab[s] = id;
    while (ini < fin) {
      const i = cola[ini++]; n++;
      const cx = i % W, cy = (i / W) | 0;
      if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) borde = true;
      const vec = [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, cy > 0 ? i - W : -1, cy < H - 1 ? i + W : -1];
      for (const j of vec) if (j >= 0 && mask[j] && lab[j] < 0) { lab[j] = id; cola[fin++] = j; }
    }
    regiones.push({ id, n, borde });
  }
  return { lab, regiones };
}

// Superficie interior: celdas donde se ve suelo (±10 cm) o techo (por encima de 2,2 m).
// El techo se capta mucho mejor que el suelo (el escáner lo ve de frente desde cualquier sitio),
// y no se ve desde la calle: es la mejor pista de "esto es interior".
// También la usa el visor para pintar el fondo gris.
function mallaSuelo(datos) {
  const m = crearMalla(datos);
  const suelo = marcar(datos, m, -0.10, 0.10);
  const techo = marcar(datos, m, 2.2, 6.0);
  const u = new Uint8Array(m.W * m.H);
  for (let i = 0; i < u.length; i++) u[i] = suelo[i] || techo[i] ? 1 : 0;
  m.suelo = encoger(ensanchar(u, m.W, m.H, 3), m.W, m.H, 3); // tapa huecos de hasta ~30 cm
  return m;
}

// ---------- Cálculo principal ----------

function calcularSuperficie(datos, malla) {
  const { W, H } = malla;
  const N = W * H;
  const celdaM2 = RES * RES;
  const vecinos4 = (i) => {
    const cx = i % W, cy = (i / W) | 0;
    return [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, cy > 0 ? i - W : -1, cy < H - 1 ? i + W : -1];
  };

  // Paredes y pilares: algo abajo (0,2–0,8 m) y algo arriba (1,4–2,0 m) en el mismo sitio (±5 cm)
  const bajo = marcar(datos, malla, 0.2, 0.8);
  const alto = marcar(datos, malla, 1.4, 2.0);
  const bajoE = ensanchar(bajo, W, H, 1), altoE = ensanchar(alto, W, H, 1);
  const pared = new Uint8Array(N);
  for (let i = 0; i < N; i++) pared[i] = (bajo[i] || alto[i]) && bajoE[i] && altoE[i] ? 1 : 0;

  const suelo = malla.suelo.slice();
  for (let i = 0; i < N; i++) if (pared[i]) suelo[i] = 0;

  // Huecos interiores (ni superficie ni pared) que no tocan el borde:
  // pequeños → se suman; grandes → estancia sin escanear (zona desactivada por defecto)
  const libre = new Uint8Array(N);
  for (let i = 0; i < N; i++) libre[i] = !suelo[i] && !pared[i] ? 1 : 0;
  const huecos = etiquetar(libre, W, H);
  let m2Huecos = 0;
  const grandes = new Map();
  for (let i = 0; i < N; i++) {
    const l = huecos.lab[i];
    if (l < 0) continue;
    const r = huecos.regiones[l];
    if (r.borde) continue;
    if (r.n * celdaM2 <= HUECO_MAX) { suelo[i] = 1; m2Huecos += celdaM2; }
    else if (r.n * celdaM2 >= 2) grandes.set(l, null);
  }

  // Zonas: con las paredes engordadas 45 cm (puertas "cerradas") el interior se separa en zonas
  const barrera = ensanchar(pared, W, H, CIERRE_PUERTA);
  const nucleo = new Uint8Array(N);
  for (let i = 0; i < N; i++) nucleo[i] = suelo[i] && !barrera[i] ? 1 : 0;
  const nuc = etiquetar(nucleo, W, H);

  // Semillas = núcleos grandes; el resto de la superficie se reparte creciendo desde ellas
  const zona = new Int32Array(N).fill(-1);
  const cola = new Int32Array(N);
  let ini = 0, fin = 0;
  const semillas = [];
  let nz = 0;
  for (const r of nuc.regiones) if (r.n * celdaM2 >= ZONA_MIN) semillas[r.id] = nz++;
  for (let i = 0; i < N; i++) {
    const l = nuc.lab[i];
    if (l >= 0 && semillas[l] !== undefined) { zona[i] = semillas[l]; cola[fin++] = i; }
  }
  while (ini < fin) {
    const i = cola[ini++];
    for (const j of vecinos4(i)) if (j >= 0 && suelo[j] && zona[j] < 0) { zona[j] = zona[i]; cola[fin++] = j; }
  }

  const sinEscanear = new Set();
  for (const l of grandes.keys()) { grandes.set(l, nz); sinEscanear.add(nz); nz++; }
  for (let i = 0; i < N; i++) {
    const l = huecos.lab[i];
    if (l >= 0 && grandes.has(l)) zona[i] = grandes.get(l);
  }

  // Datos de cada zona
  const zonas = Array.from({ length: nz }, (_, id) => ({
    id, celdas: 0, sx: 0, sy: 0, sinEscanear: sinEscanear.has(id), incluida: !sinEscanear.has(id),
  }));
  for (let i = 0; i < N; i++) {
    const z = zona[i];
    if (z < 0) continue;
    zonas[z].celdas++;
    zonas[z].sx += i % W; zonas[z].sy += (i / W) | 0;
  }
  for (const z of zonas) {
    z.area = z.celdas * celdaM2;
    // punto para la etiqueta: el centro, o la celda de la zona más cercana al centro
    let cx = Math.round(z.sx / z.celdas), cy = Math.round(z.sy / z.celdas);
    if (zona[cy * W + cx] !== z.id) {
      let mejor = Infinity, ex = cx, ey = cy;
      for (let i = 0; i < N; i++) {
        if (zona[i] !== z.id) continue;
        const d = (i % W - cx) ** 2 + (((i / W) | 0) - cy) ** 2;
        if (d < mejor) { mejor = d; ex = i % W; ey = (i / W) | 0; }
      }
      cx = ex; cy = ey;
    }
    z.etiqueta = { x: (cx + 0.5) * RES, y: (cy + 0.5) * RES };
  }
  // renumerar por tamaño (zona 0 = la más grande)
  zonas.sort((a, b) => b.area - a.area);
  const mapa = new Int32Array(nz);
  zonas.forEach((z, k) => { mapa[z.id] = k; z.id = k; });
  for (let i = 0; i < N; i++) if (zona[i] >= 0) zona[i] = mapa[zona[i]];

  return { W, H, res: RES, zona, zonas, pared, m2Huecos };
}

// ---------- Capa en pantalla ----------

const COLORES_ZONA = [
  [76, 110, 245], [18, 184, 134], [250, 176, 5], [190, 75, 219], [21, 170, 191],
  [130, 201, 30], [253, 126, 20], [230, 73, 128], [121, 80, 242], [64, 192, 87],
];

class CapaSuperficie {
  constructor(visor) {
    this.visor = visor;
    this.datos = null;
    this.visible = false;
    this.alCambiar = null;
  }

  calcular(datos, malla) {
    const t0 = performance.now();
    this.datos = calcularSuperficie(datos, malla);
    this.datos.ms = performance.now() - t0;
    this.crearImagen();
    return this.datos;
  }

  total() {
    if (!this.datos) return 0;
    return this.datos.zonas.reduce((s, z) => s + (z.incluida ? z.area : 0), 0);
  }

  crearImagen() {
    const { W, H, zona, zonas } = this.datos;
    const lienzo = document.createElement('canvas');
    lienzo.width = W; lienzo.height = H;
    const ctx = lienzo.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const z = zona[i];
      if (z < 0) continue;
      const cx = i % W, cy = (i / W) | 0;
      const q = ((H - 1 - cy) * W + cx) * 4;
      if (zonas[z].incluida) {
        const c = COLORES_ZONA[z % COLORES_ZONA.length];
        img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 60;
      } else {
        // excluida: rayado gris
        const raya = (cx + cy) % 8 < 2;
        img.data[q] = 120; img.data[q + 1] = 120; img.data[q + 2] = 120; img.data[q + 3] = raya ? 110 : 25;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.imagen = lienzo;
  }

  // Zona bajo un punto de pantalla (o null)
  zonaEn(p) {
    if (!this.datos) return null;
    const m = this.visor.aMetros(p.x, p.y);
    const cx = Math.floor(m.x / RES), cy = Math.floor(m.y / RES);
    const { W, H, zona, zonas } = this.datos;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
    const z = zona[cy * W + cx];
    return z >= 0 ? zonas[z] : null;
  }

  alternar(z) {
    z.incluida = !z.incluida;
    this.crearImagen();
    this.visor.redibujar();
    if (this.alCambiar) this.alCambiar();
  }

  dibujar(ctx) {
    if (!this.visible || !this.datos) return;
    const v = this.visor.vista;
    const { W, H } = this.datos;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.imagen, v.ox, v.oy - H * RES * v.escala, W * RES * v.escala, H * RES * v.escala);
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const z of this.datos.zonas) {
      if (z.area < 2) continue;
      const p = this.visor.aPantalla(z.etiqueta.x, z.etiqueta.y);
      const texto = z.incluida ? `${fmtM(z.area, 1)} m²` : 'excluida';
      const w = ctx.measureText(texto).width + 12;
      ctx.fillStyle = z.incluida ? 'rgba(255,255,255,.92)' : 'rgba(240,240,240,.92)';
      ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y - 10, w, 20, 10); ctx.fill();
      const c = COLORES_ZONA[z.id % COLORES_ZONA.length];
      ctx.fillStyle = z.incluida ? `rgb(${c[0] * 0.6},${c[1] * 0.6},${c[2] * 0.6})` : '#777';
      ctx.fillText(texto, p.x, p.y);
    }
    ctx.restore();
  }
}
