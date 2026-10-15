// Visor de la planta: dibuja el corte de la nube visto desde arriba,
// con zoom (rueda o pellizco) y desplazamiento (arrastrar).

class Visor {
  constructor(lienzo) {
    this.lienzo = lienzo;
    this.ctx = lienzo.getContext('2d');
    this.datos = null;
    this.corte = { altura: 1.1, grosor: 0.2 };
    this.capaCorte = null;   // puntos del corte actual {x, y}
    this.capaSuelo = null;   // puntos del suelo (fondo gris claro)
    this.vista = { escala: 50, ox: 0, oy: 0 }; // escala = píxeles por metro
    this.punteros = new Map();
    this.pendiente = false;
    this.alCambiarVista = null; // aviso para la escala gráfica

    this.prepararEventos();
    new ResizeObserver(() => this.redibujar()).observe(lienzo);
  }

  // ---------- Datos ----------

  cargar(datos) {
    this.datos = datos;
    this.capaSuelo = this.crearSuelo();
    this.cambiarCorte(this.corte.altura);
    this.encajar();
  }

  // Suelo como cuadrícula de 5 cm: celda con puntos de suelo = escaneada.
  // Se guarda como una imagen pequeña (1 píxel = 5 cm) que luego se escala.
  crearSuelo() {
    const res = 0.05;
    const { x, y, h, ancho, largo } = this.datos;
    const W = Math.ceil(ancho / res) + 2, H = Math.ceil(largo / res) + 2;
    let celdas = new Uint8Array(W * H);
    for (let i = 0; i < h.length; i++) {
      if (h[i] < -0.05 || h[i] > 0.08) continue;
      const cx = Math.floor(x[i] / res), cy = Math.floor(y[i] / res);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      celdas[cy * W + cx] = 1;
    }
    // Cerrar huecos pequeños: ensanchar 10 cm y volver a encoger 10 cm.
    // Los huecos de hasta ~20 cm se tapan; el contorno queda en su sitio.
    const vecinos = (src, cond) => {
      const out = new Uint8Array(W * H);
      for (let cy = 0; cy < H; cy++) {
        for (let cx = 0; cx < W; cx++) {
          let n = 0, total = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = cy + dy;
            if (yy < 0 || yy >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = cx + dx;
              if (xx < 0 || xx >= W) continue;
              total++; n += src[yy * W + xx];
            }
          }
          out[cy * W + cx] = cond(n, total) ? 1 : 0;
        }
      }
      return out;
    };
    const ensanchar = (src) => vecinos(src, (n) => n > 0);
    const encoger = (src) => vecinos(src, (n, total) => n === total);
    celdas = encoger(encoger(ensanchar(ensanchar(celdas))));

    const lienzo = document.createElement('canvas');
    lienzo.width = W; lienzo.height = H;
    const ctx = lienzo.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        if (!celdas[cy * W + cx]) continue;
        const q = ((H - 1 - cy) * W + cx) * 4; // la imagen va de arriba abajo
        img.data[q] = 236; img.data[q + 1] = 236; img.data[q + 2] = 232; img.data[q + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { lienzo, res, W, H };
  }

  // Se queda con los puntos entre dos alturas (máximo "limite" puntos)
  filtrar(desde, hasta, limite) {
    const { x, y, h } = this.datos;
    let n = 0;
    for (let i = 0; i < h.length; i++) if (h[i] >= desde && h[i] <= hasta) n++;
    const paso = Math.max(1, Math.ceil(n / limite));
    const fx = new Float32Array(Math.ceil(n / paso));
    const fy = new Float32Array(fx.length);
    let k = 0, j = 0;
    for (let i = 0; i < h.length; i++) {
      if (h[i] >= desde && h[i] <= hasta) {
        if (j % paso === 0) { fx[k] = x[i]; fy[k] = y[i]; k++; }
        j++;
      }
    }
    return { x: fx.subarray(0, k), y: fy.subarray(0, k) };
  }

  cambiarCorte(altura) {
    this.corte.altura = altura;
    const g = this.corte.grosor / 2;
    this.capaCorte = this.filtrar(altura - g, altura + g, 600000);
    this.redibujar();
  }

  // ---------- Vista ----------

  encajar() {
    if (!this.datos) return;
    const W = this.lienzo.clientWidth, H = this.lienzo.clientHeight, m = 30;
    const s = Math.min((W - 2 * m) / this.datos.ancho, (H - 2 * m) / this.datos.largo);
    this.vista.escala = s;
    this.vista.ox = (W - this.datos.ancho * s) / 2;
    this.vista.oy = (H + this.datos.largo * s) / 2;
    this.redibujar();
  }

  // Zoom manteniendo fijo el punto de pantalla (px, py)
  zoom(factor, px, py) {
    const v = this.vista;
    const nueva = Math.min(2000, Math.max(2, v.escala * factor));
    const f = nueva / v.escala;
    v.ox = px - (px - v.ox) * f;
    v.oy = py - (py - v.oy) * f;
    v.escala = nueva;
    this.redibujar();
  }

  mover(dx, dy) {
    this.vista.ox += dx;
    this.vista.oy += dy;
    this.redibujar();
  }

  // Pantalla → metros (lo usaremos al medir)
  aMetros(px, py) {
    return { x: (px - this.vista.ox) / this.vista.escala, y: (this.vista.oy - py) / this.vista.escala };
  }

  // ---------- Dibujo ----------

  redibujar() {
    if (this.pendiente) return;
    this.pendiente = true;
    requestAnimationFrame(() => { this.pendiente = false; this.dibujar(); });
  }

  dibujar() {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(this.lienzo.clientWidth * dpr);
    const H = Math.round(this.lienzo.clientHeight * dpr);
    if (W === 0 || H === 0) return;
    if (this.lienzo.width !== W || this.lienzo.height !== H) { this.lienzo.width = W; this.lienzo.height = H; }
    if (!this.datos) { this.ctx.clearRect(0, 0, W, H); return; }

    const s = this.vista.escala * dpr, ox = this.vista.ox * dpr, oy = this.vista.oy * dpr;
    const ctx = this.ctx;

    // Capa 1: fondo blanco + suelo escaneado en gris muy claro
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    const su = this.capaSuelo;
    ctx.imageSmoothingEnabled = s * su.res < 4; // a poco zoom suavizado; a mucho, bordes nítidos
    ctx.drawImage(su.lienzo, ox, oy - su.H * su.res * s, su.W * su.res * s, su.H * su.res * s);

    // Capa 2: corte de paredes en oscuro; más puntos en un píxel → más oscuro.
    // Cada punto ocupa ~1 cm real, así que a más zoom, punto más grande.
    const tam = Math.min(10, Math.max(1, Math.round(s * 0.012)));
    const cuenta = this.contar(this.capaCorte, W, H, s, ox, oy);
    let suma = 0, nz = 0;
    for (let k = 0; k < cuenta.length; k++) if (cuenta[k]) { suma += cuenta[k]; nz++; }
    const ref = nz ? Math.max(1, (suma / nz) * 0.6) : 1;

    if (!this.capaParedes || this.capaParedes.width !== W || this.capaParedes.height !== H) {
      this.capaParedes = document.createElement('canvas');
      this.capaParedes.width = W; this.capaParedes.height = H;
    }
    const cp = this.capaParedes.getContext('2d');
    const img = cp.createImageData(W, H);
    const px = img.data;
    const off = Math.floor(tam / 2);
    for (let k = 0; k < cuenta.length; k++) {
      const c = cuenta[k];
      if (!c) continue;
      const t = 1 - Math.exp(-c / ref);
      const alfa = Math.round(70 + 185 * t);
      const xk = (k % W) - off, yk = ((k / W) | 0) - off;
      for (let dy = 0; dy < tam; dy++) {
        const yy = yk + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = 0; dx < tam; dx++) {
          const xx = xk + dx;
          if (xx < 0 || xx >= W) continue;
          const q = (yy * W + xx) * 4;
          if (px[q + 3] < alfa) { px[q] = 20; px[q + 1] = 22; px[q + 2] = 24; px[q + 3] = alfa; }
        }
      }
    }
    cp.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.capaParedes, 0, 0);

    if (this.alCambiarVista) this.alCambiarVista(this.vista);
  }

  contar(capa, W, H, s, ox, oy) {
    const cuenta = new Uint16Array(W * H);
    const { x, y } = capa;
    for (let i = 0; i < x.length; i++) {
      const cx = Math.floor(ox + x[i] * s), cy = Math.floor(oy - y[i] * s);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const k = cy * W + cx;
      if (cuenta[k] < 65535) cuenta[k]++;
    }
    return cuenta;
  }

  // ---------- Ratón y pantalla táctil ----------

  prepararEventos() {
    const el = this.lienzo;
    const pos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.punteros.set(e.pointerId, pos(e));
      el.classList.add('arrastrando');
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.punteros.has(e.pointerId)) return;
      const antes = [...this.punteros.values()];
      this.punteros.set(e.pointerId, pos(e));
      const ahora = [...this.punteros.values()];
      if (ahora.length === 1) {
        this.mover(ahora[0].x - antes[0].x, ahora[0].y - antes[0].y);
      } else if (ahora.length === 2) {
        // pellizco: zoom según la distancia entre dedos + desplazamiento del centro
        const d0 = Math.hypot(antes[0].x - antes[1].x, antes[0].y - antes[1].y);
        const d1 = Math.hypot(ahora[0].x - ahora[1].x, ahora[0].y - ahora[1].y);
        const c0 = { x: (antes[0].x + antes[1].x) / 2, y: (antes[0].y + antes[1].y) / 2 };
        const c1 = { x: (ahora[0].x + ahora[1].x) / 2, y: (ahora[0].y + ahora[1].y) / 2 };
        this.vista.ox += c1.x - c0.x;
        this.vista.oy += c1.y - c0.y;
        if (d0 > 0) this.zoom(d1 / d0, c1.x, c1.y); else this.redibujar();
      }
    });

    const soltar = (e) => {
      this.punteros.delete(e.pointerId);
      if (this.punteros.size === 0) el.classList.remove('arrastrando');
    };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
    el.addEventListener('dblclick', (e) => { const p = pos(e); this.zoom(2, p.x, p.y); });
  }
}
