// Visor de la planta: dibuja el corte de la nube visto desde arriba,
// con zoom (rueda o pellizco) y desplazamiento (arrastrar).

// Registro de lo que ya ocupa sitio en pantalla (etiquetas y obstáculos como muebles o puertas),
// para que las etiquetas nuevas busquen un hueco libre en vez de taparse.
class Colocador {
  constructor() { this.etiquetas = []; this.obstaculos = []; }
  static caja(cx, cy, w, h, ang = 0, margen = 2) {
    const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
    const W = w * c + h * s, H = w * s + h * c;
    return { x0: cx - W / 2 - margen, y0: cy - H / 2 - margen, x1: cx + W / 2 + margen, y1: cy + H / 2 + margen };
  }
  static desdePuntos(pts, margen = 0) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs) - margen, y0: Math.min(...ys) - margen, x1: Math.max(...xs) + margen, y1: Math.max(...ys) + margen };
  }
  static choca(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
  dentro(caja) { const l = this.limites; return !l || (caja.x0 >= l.x0 && caja.y0 >= l.y0 && caja.x1 <= l.x1 && caja.y1 <= l.y1); }
  libre(caja, tambienObstaculos = true) {
    if (!this.dentro(caja)) return false;
    if (this.etiquetas.some((c) => Colocador.choca(c, caja))) return false;
    if (tambienObstaculos && this.obstaculos.some((c) => Colocador.choca(c, caja))) return false;
    return true;
  }
  // Cuánto taparía una caja (para elegir el mal menor cuando no hay sitio libre)
  coste(caja) {
    const solape = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    let c = 0;
    for (const e of this.etiquetas) c += 100 * solape(e, caja);
    for (const o of this.obstaculos) c += 10 * solape(o, caja);
    if (!this.dentro(caja)) c += 1e7;
    return c;
  }
  ocupar(caja) { this.etiquetas.push(caja); }
  obstaculo(caja) { this.obstaculos.push(caja); }
}

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
    this.capasEncima = [];      // herramientas que dibujan encima (zonas, estancias, cotas)
    this.verEscaneo = true;     // ocultarlo deja solo el plano dibujado
    this.imprimiendo = false;

    this.prepararEventos();
    new ResizeObserver(() => this.redibujar()).observe(lienzo);
  }

  // ---------- Datos ----------

  cargar(datos) {
    this.datos = datos;
    this.malla = mallaSuelo(datos);   // superficie interior (suelo o techo visto), ver superficie.js
    this.capaSuelo = this.crearSuelo();
    this.cambiarCorte(this.corte.altura);
    this.encajar();
  }

  // Fondo gris claro = superficie interior detectada.
  // Se guarda como una imagen pequeña (1 píxel = 5 cm) que luego se escala.
  crearSuelo() {
    const { W, H, res, suelo } = this.malla;
    const lienzo = document.createElement('canvas');
    lienzo.width = W; lienzo.height = H;
    const ctx = lienzo.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        if (!suelo[cy * W + cx]) continue;
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
    this.indexarCorte();
    this.redibujar();
  }

  // Índice por celdas de 10 cm para encontrar rápido los puntos cercanos a un clic
  indexarCorte() {
    const res = 0.1;
    const { x, y } = this.capaCorte;
    const W = Math.ceil(this.datos.ancho / res) + 3, H = Math.ceil(this.datos.largo / res) + 3;
    const celda = (i) => {
      const cx = Math.min(W - 1, Math.max(0, Math.floor(x[i] / res) + 1));
      const cy = Math.min(H - 1, Math.max(0, Math.floor(y[i] / res) + 1));
      return cy * W + cx;
    };
    const inicio = new Int32Array(W * H + 1);
    for (let i = 0; i < x.length; i++) inicio[celda(i) + 1]++;
    for (let c = 0; c < W * H; c++) inicio[c + 1] += inicio[c];
    const orden = new Int32Array(x.length);
    const pos = inicio.slice(0, W * H);
    for (let i = 0; i < x.length; i++) orden[pos[celda(i)]++] = i;
    this.indice = { res, W, H, inicio, orden };
  }

  // Puntos del corte a menos de "radio" metros de (px, py) — coordenadas en metros
  puntosCerca(px, py, radio) {
    const { res, W, H, inicio, orden } = this.indice;
    const { x, y } = this.capaCorte;
    const out = [];
    const c0x = Math.max(0, Math.floor((px - radio) / res) + 1), c1x = Math.min(W - 1, Math.floor((px + radio) / res) + 1);
    const c0y = Math.max(0, Math.floor((py - radio) / res) + 1), c1y = Math.min(H - 1, Math.floor((py + radio) / res) + 1);
    const r2 = radio * radio;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = cy * W + cx;
        for (let k = inicio[c]; k < inicio[c + 1]; k++) {
          const i = orden[k];
          const dx = x[i] - px, dy = y[i] - py;
          if (dx * dx + dy * dy <= r2) out.push([x[i], y[i]]);
        }
      }
    }
    return out;
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

  // Pantalla (px CSS) ↔ metros
  aMetros(px, py) {
    return { x: (px - this.vista.ox) / this.vista.escala, y: (this.vista.oy - py) / this.vista.escala };
  }
  aPantalla(x, y) {
    return { x: this.vista.ox + x * this.vista.escala, y: this.vista.oy - y * this.vista.escala };
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
    this.renderizar(this.ctx, W, H, dpr);
    if (this.alCambiarVista) this.alCambiarVista(this.vista);
  }

  // Dibuja todo en un contexto cualquiera (pantalla o imagen para el informe).
  // W, H en píxeles reales; dpr = píxeles reales por píxel CSS.
  renderizar(ctx, W, H, dpr, opciones = {}) {
    const s = this.vista.escala * dpr, ox = this.vista.ox * dpr, oy = this.vista.oy * dpr;
    const escaneo = opciones.escaneo ?? capas.visible('escaneo');
    const tenue = opciones.tenue ?? false;

    // Capa 1: fondo blanco + superficie escaneada en gris muy claro
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    if (escaneo) this.pintarEscaneo(ctx, W, H, s, ox, oy, tenue);

    // Capa 3: lo que dibujen otras herramientas (plano, estancias, cotas…), en px CSS
    this.etiquetas = new Colocador();
    this.etiquetas.limites = { x0: 0, y0: 0, x1: W / dpr, y1: H / dpr };
    if (this.capasEncima.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const capa of this.capasEncima) capa.dibujar(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  pintarEscaneo(ctx, W, H, s, ox, oy, tenue) {
    const su = this.capaSuelo;
    ctx.save();
    if (tenue) ctx.globalAlpha = 0.5;
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
    if (tenue) ctx.globalAlpha = 0.3;
    ctx.drawImage(this.capaParedes, 0, 0);
    ctx.restore();
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

    // Un "clic" es pulsar y soltar sin apenas moverse; si se mueve, es arrastrar.
    let inicioToque = null;

    // Arrastre de un elemento (lo decide alPulsar): mientras dura no se mueve la planta
    let externo = null;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0) return; // solo botón principal
      el.setPointerCapture(e.pointerId);
      this.punteros.set(e.pointerId, pos(e));
      inicioToque = this.punteros.size === 1 ? { ...pos(e), movido: false } : null;
      if (this.punteros.size === 1 && this.alPulsar && this.alPulsar(pos(e), e)) {
        externo = { id: e.pointerId, inicio: pos(e), movido: false };
      } else if (externo) {
        // segundo dedo: se cancela el arrastre del elemento
        if (this.alSoltarArrastre) this.alSoltarArrastre(null, e);
        externo = null;
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (externo && e.pointerId === externo.id) {
        const p = pos(e);
        if (!externo.movido && Math.hypot(p.x - externo.inicio.x, p.y - externo.inicio.y) < 4) return;
        externo.movido = true;
        if (this.alArrastrar) this.alArrastrar(p, e);
        return;
      }
      if (!this.punteros.has(e.pointerId)) {
        // ratón moviéndose sin pulsar: avisar (para la vista previa del imán)
        if (this.alMoverCursor) this.alMoverCursor(pos(e), e);
        return;
      }
      if (inicioToque) {
        const p = pos(e);
        if (Math.hypot(p.x - inicioToque.x, p.y - inicioToque.y) > 6) {
          inicioToque.movido = true;
          el.classList.add('arrastrando');
        }
        if (!inicioToque.movido) return;
      }
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

    const soltar = (e, cancelado) => {
      if (!this.punteros.has(e.pointerId)) return;
      if (externo && e.pointerId === externo.id) {
        this.punteros.delete(e.pointerId);
        externo = null; inicioToque = null;
        if (this.alSoltarArrastre) this.alSoltarArrastre(pos(e), e);
        return;
      }
      this.punteros.delete(e.pointerId);
      if (this.punteros.size > 0) { inicioToque = null; return; }
      el.classList.remove('arrastrando');
      if (!cancelado && inicioToque && !inicioToque.movido && this.alHacerClic) {
        this.alHacerClic(pos(e), e);
      }
      inicioToque = null;
    };
    el.addEventListener('pointerup', (e) => soltar(e, false));
    el.addEventListener('pointercancel', (e) => soltar(e, true));
    el.addEventListener('pointerleave', (e) => { if (this.alMoverCursor && !this.punteros.size) this.alMoverCursor(null, e); });
    el.addEventListener('dblclick', (e) => {
      if (this.bloquearDobleClic) return;
      const p = pos(e); this.zoom(2, p.x, p.y);
    });
  }
}
