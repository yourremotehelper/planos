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
    this.obtenerHuecos = () => [];   // lo conecta app.js con el plano
    this.alAntesDeCambiar = null;    // para el historial de deshacer
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
    if (this.alAntesDeCambiar) this.alAntesDeCambiar();
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
    e.m2Paredes = e.perimetro * e.altura;            // bruto
    // Puertas y ventanas en los lados de la estancia (las que quedan en la reforma: no las de derribo)
    e.m2Huecos = 0; e.mlPuertas = 0; e.nPuertas = 0; e.nVentanas = 0;
    for (const h of this.obtenerHuecos()) {
      if (h.estado === 'derribo' || !huecoEnEstancia(h, e.puntos)) continue;
      const ancho = Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y);
      e.m2Huecos += ancho * Math.min(h.alto, Math.max(0, e.altura - (h.antepecho || 0)));
      if (h.tipo === 'puerta') { e.mlPuertas += ancho; e.nPuertas++; } else e.nVentanas++;
    }
    e.m2ParedesNetas = Math.max(0, e.m2Paredes - e.m2Huecos);
    e.mlRodapie = Math.max(0, e.perimetro - e.mlPuertas);
  }

  recalcularTodas() { for (const e of this.lista) this.recalcular(e); }

  // Para deshacer/rehacer y guardar
  serializar() {
    return {
      siguienteId: this.siguienteId,
      lista: this.lista.map((e) => ({ id: e.id, nombre: e.nombre, puntos: e.puntos.map((q) => ({ x: q.x, y: q.y })), altura: e.altura, alturaAuto: e.alturaAuto })),
    };
  }
  restaurar(d) {
    this.lista = d.lista.map((e) => { const n = { ...e, puntos: e.puntos.map((q) => ({ ...q })) }; this.recalcular(n); return n; });
    this.siguienteId = d.siguienteId;
    if (this.seleccion && !this.lista.some((e) => e.id === this.seleccion)) this.seleccion = null;
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
    if (e && this.alAntesDeCambiar) this.alAntesDeCambiar();
    if (e) { e.nombre = nombre.trim() || e.nombre; this.visor.redibujar(); this.avisar(); }
  }
  cambiarAltura(id, altura) {
    const e = this.lista.find((q) => q.id === id);
    if (e && altura > 0.5 && altura < 10 && this.alAntesDeCambiar) this.alAntesDeCambiar();
    if (e && altura > 0.5 && altura < 10) { e.altura = altura; this.recalcular(e); this.visor.redibujar(); this.avisar(); }
  }
  borrar(id) {
    if (this.alAntesDeCambiar && !this.borrandoDesdeEditor) this.alAntesDeCambiar();
    this.lista = this.lista.filter((q) => q.id !== id);
    if (this.seleccion === id) this.seleccion = null;
    this.visor.redibujar(); this.avisar();
  }
  borrarTodo() { this.lista = []; this.puntos = []; this.seleccion = null; this.siguienteId = 1; this.visor.redibujar(); this.avisar(); }

  estanciaEn(p) {
    if (!capas.editable('estancias')) return null;
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

  // Capa de fondo (relleno y contorno): va debajo de muros y muebles
  dibujar(ctx) {
    const v = this.visor;
    if (capas.visible('estancias')) for (const e of this.lista) this.dibujarFondo(ctx, e, !v.imprimiendo && e.id === this.seleccion);

    if (!this.activo || v.imprimiendo) return;
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

  dibujarFondo(ctx, e, seleccionada) {
    const v = this.visor;
    const pts = e.puntos.map((q) => v.aPantalla(q.x, q.y));
    ctx.save();
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = seleccionada ? 'rgba(24,100,171,.20)' : (v.imprimiendo ? 'rgba(24,100,171,.06)' : 'rgba(24,100,171,.10)');
    ctx.fill();
    ctx.strokeStyle = seleccionada ? '#d9480f' : COLOR_ESTANCIA;
    ctx.lineWidth = seleccionada ? 3 : (v.imprimiendo ? 1 : 2);
    ctx.stroke();
    ctx.restore();
  }

  // Capa de etiquetas (nombre, m² y cotas de los lados): va encima de todo.
  // Cada etiqueta busca un sitio libre: no tapa otras etiquetas ni muebles ni puertas.
  // Orden de prioridad: nombres (estancias grandes primero) y después cotas (lados largos primero).
  dibujarEtiquetas(ctx) {
    const v = this.visor;
    const reg = v.etiquetas || new Colocador();
    const orden = [...this.lista].sort((a, b) => b.area - a.area);
    this.llamadasNombre = [];   // estancias rotuladas con letra (solo al imprimir)
    if (capas.visible('nombres')) for (const e of orden) this.dibujarNombre(ctx, e, reg, !v.imprimiendo && e.id === this.seleccion);
    if (!capas.visible('cotasEstancias')) return;
    const lados = [];
    for (const e of orden) {
      const p = e.puntos;
      const sentido = areaConSigno(p) >= 0 ? 1 : -1; // 1: antihorario → el interior queda a la izquierda
      for (let i = 0; i < p.length; i++) {
        const A = p[i], B = p[(i + 1) % p.length];
        lados.push({ A, B, L: Math.hypot(B.x - A.x, B.y - A.y), sentido, estancia: e.nombre });
      }
    }
    lados.sort((x, y) => y.L - x.L);
    this.llamadas = [];   // cotas numeradas (solo al imprimir) para la leyenda del informe
    // Una pared compartida por dos estancias tiene la misma medida: se acota una sola vez
    const hechos = [];
    const mismoLado = (l, k) => Math.abs(l.L - k.L) < 0.03 &&
      Math.hypot((l.A.x + l.B.x) / 2 - (k.A.x + k.B.x) / 2, (l.A.y + l.B.y) / 2 - (k.A.y + k.B.y) / 2) < 0.3;
    for (const l of lados) {
      if (hechos.some((k) => mismoLado(l, k))) continue;
      hechos.push(l);
      this.dibujarCotaLado(ctx, l, reg);
    }
  }

  dibujarNombre(ctx, e, reg, seleccionada) {
    const v = this.visor;
    // Dos formatos: normal (2 líneas) y compacto (1 línea, más pequeño) para estancias estrechas
    const formatos = [
      { lineas: [e.nombre, `${fmtM(e.area)} m²`], fuentes: ['700 13px', '600 12px'], alto: 38, salto: 17 },
      { lineas: [`${e.nombre} · ${fmtM(e.area, 1)} m²`], fuentes: ['700 11px'], alto: 18, salto: 0 },
      { lineas: [e.nombre, `${fmtM(e.area, 1)} m²`], fuentes: ['700 10px', '600 10px'], alto: 28, salto: 12 },
    ];
    const familia = ' system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.save();
    for (const f of formatos) {
      f.ancho = Math.max(...f.lineas.map((t, i) => { ctx.font = f.fuentes[i] + familia; return ctx.measureText(t).width; })) + 12;
    }

    // candidatos: el centro y después puntos interiores cada vez más lejos de él
    const c = centroPoligono(e.puntos);
    const cand = [c];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of e.puntos) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const paso = Math.max((x1 - x0) / 12, (y1 - y0) / 12, 10 / v.vista.escala);
    for (let x = x0 + paso / 2; x < x1; x += paso) for (let y = y0 + paso / 2; y < y1; y += paso) if (dentroPoligono(x, y, e.puntos)) cand.push({ x, y });
    cand.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    const candidatos = cand.slice(0, 200).map((q) => v.aPantalla(q.x, q.y));
    const cabeDentro = (caja) => [[caja.x0, caja.y0], [caja.x1, caja.y0], [caja.x1, caja.y1], [caja.x0, caja.y1]]
      .every(([px, py]) => { const m = v.aMetros(px, py); return dentroPoligono(m.x, m.y, e.puntos); });

    let elegido = null;
    // 1) dentro de la estancia y sin tapar nada · 2) dentro sin tapar etiquetas · 3) donde no tape etiquetas
    // (si no cabe dentro, se prueba primero el formato más pequeño, sin tapar dibujos)
    const pasadas = [
      { prueba: (caja) => cabeDentro(caja) && reg.libre(caja), orden: formatos },
      { prueba: (caja) => cabeDentro(caja) && reg.libre(caja, false), orden: formatos },
      { prueba: (caja) => reg.libre(caja), orden: [formatos[1], formatos[2]] },
      { prueba: (caja) => reg.libre(caja, false), orden: [formatos[1], formatos[2]] },
    ];
    // Al imprimir, si no cabe dentro de su estancia: letra en círculo y el nombre en la leyenda
    const pasadasUsadas = v.imprimiendo ? pasadas.slice(0, 2) : pasadas;
    buscar: for (const { prueba, orden } of pasadasUsadas) {
      for (const f of orden) {
        for (const s of candidatos) {
          const caja = Colocador.caja(s.x, s.y, f.ancho, f.alto, 0, 3);
          if (prueba(caja)) { elegido = { s, caja, f }; break buscar; }
        }
      }
    }
    if (!elegido && v.imprimiendo) {
      const letra = String.fromCharCode(65 + this.llamadasNombre.length);
      const r = 9;
      let mejor = null;
      for (const s of candidatos.slice(0, 80)) {
        const caja = Colocador.caja(s.x, s.y, 2 * r, 2 * r, 0, 1);
        const coste = reg.coste(caja);
        if (!mejor || coste < mejor.coste) mejor = { s, caja, coste };
        if (coste === 0) break;
      }
      reg.ocupar(mejor.caja);
      this.llamadasNombre.push({ letra, nombre: e.nombre, area: e.area });
      ctx.fillStyle = COLOR_ESTANCIA;
      ctx.beginPath(); ctx.arc(mejor.s.x, mejor.s.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(letra, mejor.s.x, mejor.s.y + 0.5);
      ctx.restore();
      return;
    }
    if (!elegido) {
      // sin sitio libre: la posición (con el formato pequeño) que menos tape
      let mejor = Infinity;
      for (const f of [formatos[1], formatos[2]]) for (const s of candidatos) {
        const caja = Colocador.caja(s.x, s.y, f.ancho, f.alto, 0, 3);
        const coste = reg.coste(caja);
        if (coste < mejor) { mejor = coste; elegido = { s, caja, f }; }
      }
    }
    reg.ocupar(elegido.caja);
    const { s: pc, f } = elegido;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.strokeStyle = seleccionada ? '#d9480f' : COLOR_ESTANCIA;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(pc.x - f.ancho / 2, pc.y - f.alto / 2, f.ancho, f.alto, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COLOR_ESTANCIA;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const y0t = pc.y - (f.salto * (f.lineas.length - 1)) / 2;
    f.lineas.forEach((t, i) => { ctx.font = f.fuentes[i] + familia; ctx.fillText(t, pc.x, y0t + i * f.salto); });
    ctx.restore();
  }

  // Cota de un lado. Nunca se omite:
  //  1) junto al lado (por dentro de la estancia o por fuera) sin tapar nada
  //  2) un poco más lejos, unida a su lado con una línea de referencia corta
  //  3) en el informe: un número en círculo junto al lado (① …) y la medida en la leyenda
  //     en pantalla: la posición más cercana que menos tape (con zoom se despeja)
  dibujarCotaLado(ctx, l, reg) {
    const v = this.visor;
    const A = v.aPantalla(l.A.x, l.A.y), B = v.aPantalla(l.B.x, l.B.y);
    const Lp = Math.hypot(B.x - A.x, B.y - A.y);
    if (Lp < 1) return;
    const texto = fmtCota(l.L);
    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = ctx.measureText(texto).width, h = 13;

    // normal hacia el interior, en pantalla (el eje y de pantalla va al revés)
    const ux = (B.x - A.x) / Lp, uy = (B.y - A.y) / Lp;
    const nx = l.sentido > 0 ? uy : -uy, ny = l.sentido > 0 ? -ux : ux;
    let ang = Math.atan2(B.y - A.y, B.x - A.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;

    const cabe = Lp >= w + 14;
    const pos = (c) => {
      const cx = A.x + (B.x - A.x) * c.t + nx * c.off, cy = A.y + (B.y - A.y) * c.t + ny * c.off;
      const a = c.guia && !cabe ? 0 : ang;
      return { ...c, cx, cy, a, caja: Colocador.caja(cx, cy, w + 4, h, a, 1) };
    };
    const cerca = [];
    if (cabe) for (const off of [10, 22, -10, -22]) for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const margen = (w / 2 + 4) / Lp;
      if (t >= margen && t <= 1 - margen) cerca.push({ off, t, guia: false });
    }
    const conGuia = [];
    for (const off of [34, -34, 46, -46]) for (const t of [0.5, 0.3, 0.7]) conGuia.push({ off, t, guia: true });

    let elegido = null;
    for (const c of [...cerca, ...conGuia]) { const k = pos(c); if (reg.libre(k.caja)) { elegido = k; break; } }

    if (!elegido && v.imprimiendo) {
      // 3) cota numerada
      const n = this.llamadas.length + 1;
      const r = 8;
      let mejor = null;
      for (const off of [9, -9, 0, 18, -18, 27, -27]) for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const cx = A.x + (B.x - A.x) * t + nx * off, cy = A.y + (B.y - A.y) * t + ny * off;
        const caja = Colocador.caja(cx, cy, 2 * r, 2 * r, 0, 1);
        const coste = reg.coste(caja) + Math.abs(off);
        if (!mejor || coste < mejor.coste) mejor = { cx, cy, caja, coste };
      }
      reg.ocupar(mejor.caja);
      this.llamadas.push({ n, texto, estancia: l.estancia });
      ctx.fillStyle = '#fff'; ctx.strokeStyle = COLOR_ESTANCIA; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(mejor.cx, mejor.cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = COLOR_ESTANCIA; ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), mejor.cx, mejor.cy + 0.5);
      ctx.restore();
      return;
    }
    if (!elegido) {
      // en pantalla: la posición cercana que menos tape
      let mejor = Infinity;
      for (const c of [...cerca, { off: 10, t: 0.5, guia: false }, { off: -10, t: 0.5, guia: false }]) {
        const k = pos(c);
        const coste = reg.coste(k.caja) + Math.abs(c.off);
        if (coste < mejor) { mejor = coste; elegido = k; }
      }
    }
    reg.ocupar(elegido.caja);

    if (elegido.guia) {
      const px = A.x + (B.x - A.x) * elegido.t, py = A.y + (B.y - A.y) * elegido.t;
      const sgn = Math.sign(elegido.off);
      ctx.strokeStyle = COLOR_ESTANCIA; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(elegido.cx - nx * sgn * (h / 2 + 2), elegido.cy - ny * sgn * (h / 2 + 2)); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fillStyle = COLOR_ESTANCIA; ctx.fill();
      ctx.globalAlpha = 1;
      reg.obstaculo(Colocador.desdePuntos([{ x: px, y: py }, { x: elegido.cx, y: elegido.cy }], 1));
    }
    ctx.translate(elegido.cx, elegido.cy);
    ctx.rotate(elegido.a);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 4;
    ctx.strokeText(texto, 0, 0);
    ctx.fillStyle = COLOR_ESTANCIA;
    ctx.fillText(texto, 0, 0);
    ctx.restore();
  }
}

// ---------- Geometría de polígonos ----------

function areaConSigno(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    s += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return s / 2;
}

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

// ¿El hueco está en uno de los lados de la estancia? (paralelo y pegado a un lado)
function huecoEnEstancia(h, puntos) {
  const mx = (h.a.x + h.b.x) / 2, my = (h.a.y + h.b.y) / 2;
  const L = Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y) || 1;
  const ux = (h.b.x - h.a.x) / L, uy = (h.b.y - h.a.y) / L;
  for (let i = 0; i < puntos.length; i++) {
    const A = puntos[i], B = puntos[(i + 1) % puntos.length];
    const Ll = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const vx = (B.x - A.x) / Ll, vy = (B.y - A.y) / Ll;
    if (Math.abs(ux * vx + uy * vy) < Math.cos((10 * Math.PI) / 180)) continue; // no paralelo
    const t = (mx - A.x) * vx + (my - A.y) * vy;
    if (t < 0 || t > Ll) continue;
    const d = Math.abs((mx - A.x) * -vy + (my - A.y) * vx);
    if (d <= h.grosor + 0.15) return true;
  }
  return false;
}
