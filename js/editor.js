// Editor: herramientas de dibujo (muro, puerta, ventana, símbolo) y selección/edición.
// Las herramientas de medir y estancia viven en medir.js y estancias.js; aquí se coordinan.

class Editor {
  constructor({ visor, plano, iman, estancias, medicion, superficie }) {
    Object.assign(this, { visor, plano, iman, estancias, medicion, superficie });
    this.herramienta = null;        // null (seleccionar) | medir | estancia | muro | puerta | ventana | simbolo
    this.grosorMuro = 0.10;
    this.simbolo = 'inodoro';
    this.muroA = null;              // primer punto del muro en curso
    this.huecoInicio = null;        // { linea, punto }
    this.cursor = null;             // vista previa
    this.fantasma = null;           // símbolo siguiendo al cursor
    this.ultimoGiro = 0;
    this.sel = null;                // { tipo: muro|hueco|simbolo|estancia|cota, id }
    this.arrastre = null;
    this.alCambiar = null;          // refrescar paneles
  }

  avisar() { this.plano.seleccion = this.sel; if (this.alCambiar) this.alCambiar(); this.visor.redibujar(); }

  elegir(h) {
    // para dibujar en una capa, tiene que estar visible y sin bloquear
    const capa = { medir: 'cotas', estancia: 'estancias', muro: 'muros', puerta: 'huecos', ventana: 'huecos', simbolo: capaDeSimbolo(this.simbolo) }[h];
    if (capa) this.capaActivada = capas.activar(capa) ? capa : null;
    this.herramienta = h;
    this.muroA = null; this.huecoInicio = null; this.cursor = null; this.fantasma = null;
    this.medicion.activar(h === 'medir');
    this.estancias.activar(h === 'estancia');
    if (h) this.seleccionar(null);
    this.visor.bloquearDobleClic = !!h;
    this.visor.lienzo.classList.toggle('modoMedir', !!h);
    this.avisar();
  }

  // ---------- Enganches ----------

  radio(e) { return Iman.radioPx(e) / this.visor.vista.escala; }

  // Punto para dibujar muros: extremos de muros > imán (paredes del escaneo) > libre
  engancharPunto(p, e, excluir) {
    const m = this.visor.aMetros(p.x, p.y);
    const ext = this.plano.extremoCerca(m, Math.min(0.3, this.radio(e)), excluir);
    if (ext) return { ...ext, tipo: 'extremo' };
    return this.iman.enganchar(p, Iman.radioPx(e));
  }

  // Ortogonal: si el tramo va casi recto (±4°), se endereza
  ortogonal(a, q) {
    const ang = Math.atan2(q.y - a.y, q.x - a.x);
    const recto = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - recto) > (4 * Math.PI) / 180 || q.tipo === 'esquina' || q.tipo === 'extremo') return q;
    const L = Math.hypot(q.x - a.x, q.y - a.y);
    return { ...q, x: a.x + Math.cos(recto) * L, y: a.y + Math.sin(recto) * L, orto: true };
  }

  // Hacia qué lado va el grosor de un muro dibujado sobre la cara de una pared escaneada:
  // hacia el lado que NO es interior (el interior es donde el escáner vio suelo/techo).
  // Si los dos lados son interior (tabique visto por las dos caras), centrado.
  ladoAuto(a, b) {
    const sd = this.superficie.datos;
    if (!sd) return 0;
    const { W, H, res, zona } = sd;
    const u = unit(a, b), n = normalIzq(u), L = largo(a, b);
    const interior = (signo) => {
      let si = 0, total = 0;
      for (let k = 1; k <= 9; k++) {
        const t = (k / 10) * L;
        for (const o of [0.15, 0.25, 0.35]) {
          const q = sumar(sumar(a, por(u, t)), por(n, signo * o));
          const cx = Math.floor(q.x / res), cy = Math.floor(q.y / res);
          total++;
          if (cx >= 0 && cy >= 0 && cx < W && cy < H && zona[cy * W + cx] >= 0) si++;
        }
      }
      return si / total;
    };
    const izq = interior(1), der = interior(-1);
    if (izq > 0.5 && der < 0.25) return -1;  // interior a la izquierda → grosor a la derecha
    if (der > 0.5 && izq < 0.25) return 1;
    return 0;
  }

  // Línea sobre la que colocar un hueco o pegar un símbolo
  //  1) muros del plano · 2) lados de estancias · 3) paredes del escaneo (imán)
  lineaEn(p, e, radioExtra = 0) {
    const m = this.visor.aMetros(p.x, p.y);
    const r = this.radio(e) + radioExtra;
    const delModelo = this.plano.lineasCerca(m, r);
    if (delModelo.length) {
      const l = delModelo[0];
      return { tipo: 'muro', muro: l.muro, u: l.u, q: l.q, eje: !!l.eje, cara: l.cara };
    }
    let mejor = null;
    for (const est of this.estancias.lista) {
      const pts = est.puntos;
      for (let i = 0; i < pts.length; i++) {
        const A = pts[i], B = pts[(i + 1) % pts.length];
        const d = distSegmento(m, A, B);
        if (d.d <= r && (!mejor || d.d < mejor.d)) mejor = { d: d.d, q: d.q, u: unit(A, B), est };
      }
    }
    if (mejor) return { tipo: 'estancia', ...mejor };
    const k = this.iman.enganchar(p, Iman.radioPx(e) + radioExtra * this.visor.vista.escala);
    if (k.tipo === 'pared') return { tipo: 'escaneo', q: { x: k.x, y: k.y }, u: { x: k.dir[0], y: k.dir[1] } };
    return null;
  }

  // ---------- Clic / movimiento según herramienta ----------

  clic(p, e) {
    const h = this.herramienta;
    if (h === 'medir') return this.medicion.clic(p, e);
    if (h === 'estancia') return this.estancias.clic(p, e);
    if (h === 'muro') return this.clicMuro(p, e);
    if (h === 'puerta' || h === 'ventana') return this.clicHueco(p, e);
    if (h === 'simbolo') return this.clicSimbolo(p, e);
    // seleccionar: la selección se hace al pulsar; un clic en vacío con zonas visibles las alterna
    if (!this.sel && capas.visible('zonas')) {
      const z = this.superficie.zonaEn(p);
      if (z) this.superficie.alternar(z);
    }
  }

  mover(p, e) {
    const h = this.herramienta;
    if (h === 'medir') return this.medicion.mover(p, e);
    if (h === 'estancia') return this.estancias.mover(p, e);
    if (!p) { this.cursor = null; this.fantasma = null; this.visor.redibujar(); return; }
    if (h === 'muro') {
      let q = this.engancharPunto(p, e);
      if (this.muroA) q = this.ortogonal(this.muroA, q);
      this.cursor = q;
    } else if (h === 'puerta' || h === 'ventana') {
      const linea = this.huecoInicio ? this.huecoInicio.linea : this.lineaEn(p, e);
      const base = this.huecoInicio ? this.huecoInicio.punto : linea && linea.q;
      const jamba = linea ? this.iman.jambaCerca(p, Iman.radioPx(e), base, linea.u) : null;
      this.cursor = { linea: this.huecoInicio ? null : linea, m: jamba ? { x: jamba.x, y: jamba.y } : this.visor.aMetros(p.x, p.y), jamba: !!jamba };
    } else if (h === 'simbolo') {
      this.fantasma = this.colocacion(p, e, this.simbolo);
    }
    this.visor.redibujar();
  }

  // ---------- Muros ----------

  clicMuro(p, e) {
    let q = this.engancharPunto(p, e);
    if (!this.muroA) { this.muroA = q; this.avisar(); return; }
    q = this.ortogonal(this.muroA, q);
    if (largo(this.muroA, q) < 0.02) { this.muroA = null; this.avisar(); return; } // doble clic = terminar
    this.plano.guardar();
    const estado = this.plano.estadoNuevo();
    const lado = estado === 'existente' ? this.ladoAuto(this.muroA, q) : 0;
    this.plano.añadirMuro(this.muroA, q, { grosor: this.grosorMuro, lado });
    this.muroA = { x: q.x, y: q.y };   // seguir encadenando
    this.plano.avisar();
    this.avisar();
  }

  // ---------- Puertas y ventanas ----------
  // Clic 1 en una jamba, clic 2 en la otra (ancho exacto). Clic 2 en el mismo sitio = ancho estándar.

  clicHueco(p, e) {
    const tipo = this.herramienta;
    if (!this.huecoInicio) {
      const linea = this.lineaEn(p, e);
      if (!linea) return;
      const jamba = this.iman.jambaCerca(p, Iman.radioPx(e), linea.q, linea.u);
      this.huecoInicio = { linea, punto: jamba ? { x: jamba.x, y: jamba.y } : linea.q, jamba: !!jamba };
      this.avisar();
      return;
    }
    const { linea, punto } = this.huecoInicio;
    const m = this.visor.aMetros(p.x, p.y);
    const u = linea.u;
    let t = (m.x - punto.x) * u.x + (m.y - punto.y) * u.y;
    // ¿el segundo clic está junto a la otra jamba? engancharlo al final de la pared
    const jamba = this.iman.jambaCerca(p, Iman.radioPx(e), punto, u);
    if (jamba) t = jamba.t;
    let a, b;
    if (Math.abs(t) < 0.05) {
      const ancho = tipo === 'puerta' ? 0.80 : 1.20;
      a = sumar(punto, por(u, -ancho / 2)); b = sumar(punto, por(u, ancho / 2));
    } else {
      a = punto; b = sumar(punto, por(u, t));
      if (t < 0) [a, b] = [b, a];
    }
    // Línea de referencia y grosor según dónde se colocó
    let grosor = 0.10, lado = 0;
    if (linea.tipo === 'muro') {
      const w = linea.muro;
      grosor = w.grosor; lado = w.lado;
      // llevar a y b a la línea de referencia del muro (w.a→w.b) conservando la dirección del muro
      const uw = unit(w.a, w.b);
      const proy = (q) => { const tt = (q.x - w.a.x) * uw.x + (q.y - w.a.y) * uw.y; return sumar(w.a, por(uw, tt)); };
      a = proy(a); b = proy(b);
      if ((b.x - a.x) * uw.x + (b.y - a.y) * uw.y < 0) [a, b] = [b, a];
    } else if (linea.tipo === 'estancia') {
      // el muro está por fuera de la estancia: el cuerpo va hacia el lado que no es la estancia
      const n = normalIzq(unit(a, b));
      const prueba = sumar(por(sumar(a, b), 0.5), por(n, 0.05));
      lado = dentroDe(prueba, linea.est.puntos) ? -1 : 1;
    } else {
      lado = this.ladoAuto(a, b) || 0;
    }
    this.plano.guardar();
    const h = this.plano.añadirHueco(tipo, a, b, { grosor, lado });
    this.huecoInicio = null;
    this.sel = { tipo: 'hueco', id: h.id };
    this.plano.avisar();
    this.avisar();
  }

  // ---------- Símbolos ----------

  // Dónde y con qué giro queda un símbolo: si hay pared cerca, de espaldas a ella
  colocacion(p, e, clave, tam) {
    const def = SIMBOLOS[clave];
    const ancho = tam ? tam.ancho : def.ancho, fondo = tam ? tam.fondo : def.fondo;
    const m = this.visor.aMetros(p.x, p.y);
    const linea = this.lineaEn(p, e, fondo / 2 + 0.15);
    if (linea) {
      const u = linea.u, n = normalIzq(u);
      // hacia qué lado está el cursor
      const lado = (m.x - linea.q.x) * n.x + (m.y - linea.q.y) * n.y >= 0 ? 1 : -1;
      const dentro = por(n, lado);
      // cara de la pared por el lado del cursor
      let base = linea.q;
      if (linea.tipo === 'muro' && linea.eje) {
        const [o1, o2] = caras(linea.muro.grosor, linea.muro.lado);
        base = sumar(linea.q, por(n, lado > 0 ? o2 : o1));
      }
      const rot = Math.atan2(dentro.x, -dentro.y);
      const c = sumar(base, por(dentro, fondo / 2 + 0.005));
      return { x: c.x, y: c.y, rot, pegado: true };
    }
    return { x: m.x, y: m.y, rot: this.ultimoGiro, pegado: false };
  }

  clicSimbolo(p, e) {
    const c = this.colocacion(p, e, this.simbolo);
    this.plano.guardar();
    const s = this.plano.añadirSimbolo(this.simbolo, c.x, c.y, c.rot);
    this.ultimoGiro = c.rot;
    this.sel = { tipo: 'simbolo', id: s.id };
    this.plano.avisar();
    this.avisar();
  }

  girarSeleccion(grados) {
    const s = this.sel && this.sel.tipo === 'simbolo' ? this.plano.buscar(this.sel) : null;
    if (s) {
      this.plano.guardar();
      s.rot += (grados * Math.PI) / 180;
      this.ultimoGiro = s.rot;
      this.plano.avisar(); this.avisar();
    } else if (this.herramienta === 'simbolo') {
      this.ultimoGiro += (grados * Math.PI) / 180;
      this.visor.redibujar();
    }
  }

  // ---------- Selección y arrastre ----------

  seleccionar(sel) {
    this.sel = sel;
    this.estancias.seleccion = sel && sel.tipo === 'estancia' ? sel.id : null;
    this.avisar();
  }

  elementoSel() {
    if (!this.sel) return null;
    if (this.sel.tipo === 'estancia') return this.estancias.lista.find((q) => q.id === this.sel.id) || null;
    if (this.sel.tipo === 'cota') return this.medicion.cotas[this.sel.id] || null;
    return this.plano.buscar(this.sel);
  }

  // Al pulsar sin herramienta: ¿empieza un arrastre? (devuelve true si lo gestiona el editor)
  pulsar(p, e) {
    if (this.herramienta) return false;
    const v = this.visor, m = v.aMetros(p.x, p.y);
    const tolPx = e && e.pointerType === 'touch' ? 16 : 9;
    const tol = tolPx / v.vista.escala;
    const cerca = (q) => { const s = v.aPantalla(q.x, q.y); return Math.hypot(s.x - p.x, s.y - p.y) <= tolPx; };
    const el = this.elementoSel();

    // 1) tiradores del elemento seleccionado
    if (el && (this.sel.tipo === 'muro' || this.sel.tipo === 'hueco')) {
      for (const k of ['a', 'b']) if (cerca(el[k])) return this.empezar({ modo: 'extremo', el, k });
    }
    if (el && this.sel.tipo === 'estancia' && capas.editable('estancias')) {
      const i = el.puntos.findIndex(cerca);
      if (i >= 0) return this.empezar({ modo: 'vertice', el, i });
    }

    // 2) elementos del plano
    const hit = this.plano.elementoEn(m, tol);
    if (hit) {
      this.seleccionar(hit);
      const obj = this.plano.buscar(hit);
      return this.empezar({ modo: 'mover', el: obj, tipo: hit.tipo, desde: m, original: JSON.parse(JSON.stringify(obj)) });
    }

    // 3) cotas
    const ic = capas.editable('cotas') ? this.medicion.cotas.findIndex((c) => distSegmento(m, c.a, c.b).d <= tol) : -1;
    if (ic >= 0) { this.seleccionar({ tipo: 'cota', id: ic }); return true; }

    // 4) estancias
    const est = this.estancias.estanciaEn(p);
    if (est) { this.seleccionar({ tipo: 'estancia', id: est.id }); return false; } // se puede arrastrar el plano

    if (this.sel) this.seleccionar(null);
    return false;
  }

  empezar(arr) {
    this.plano.guardar();
    this.arrastre = { ...arr, movido: false };
    return true;
  }

  arrastrar(p, e) {
    const a = this.arrastre;
    if (!a) return;
    a.movido = true;
    const m = this.visor.aMetros(p.x, p.y);
    if (a.modo === 'extremo') {
      if (this.sel.tipo === 'muro') {
        const otro = a.k === 'a' ? a.el.b : a.el.a;
        a.el[a.k] = this.ortogonal(otro, this.engancharPunto(p, e, a.el.id));
        a.el[a.k] = { x: a.el[a.k].x, y: a.el[a.k].y };
      } else {
        // hueco: el extremo se mueve sobre su propia línea (cambia el ancho)
        const u = unit(a.el.a, a.el.b), base = a.k === 'a' ? a.el.b : a.el.a;
        let t = (m.x - base.x) * u.x + (m.y - base.y) * u.y;
        const jamba = this.iman.jambaCerca(p, Iman.radioPx(e), base, u);
        if (jamba) t = jamba.t;
        if (a.k === 'a') t = Math.min(t, -0.3); else t = Math.max(t, 0.3);
        a.el[a.k] = sumar(base, por(u, t));
      }
    } else if (a.modo === 'vertice') {
      const q = this.iman.enganchar(p, Iman.radioPx(e));
      a.el.puntos[a.i] = { x: q.x, y: q.y };
      this.estancias.recalcular(a.el);
    } else if (a.modo === 'mover') {
      const dx = m.x - a.desde.x, dy = m.y - a.desde.y;
      const o = a.original;
      if (a.tipo === 'simbolo') {
        const c = this.colocacion(p, e, a.el.clave, a.el);
        if (c.pegado) { a.el.x = c.x; a.el.y = c.y; a.el.rot = c.rot; } else { a.el.x = o.x + dx; a.el.y = o.y + dy; }
      } else if (a.tipo === 'hueco') {
        // un hueco se desliza a lo largo de su pared
        const u = unit(o.a, o.b);
        const t = dx * u.x + dy * u.y;
        a.el.a = sumar(o.a, por(u, t)); a.el.b = sumar(o.b, por(u, t));
      } else {
        a.el.a = { x: o.a.x + dx, y: o.a.y + dy }; a.el.b = { x: o.b.x + dx, y: o.b.y + dy };
      }
    }
    this.plano.avisar();
  }

  soltar() {
    const a = this.arrastre;
    this.arrastre = null;
    if (a && !a.movido) this.plano.historial.pop(); // fue solo un clic: no guardar en el historial
    this.estancias.avisar();
    this.avisar();
  }

  borrarSeleccion() {
    if (!this.sel) return;
    this.plano.guardar();
    if (this.sel.tipo === 'estancia') { this.estancias.borrandoDesdeEditor = true; this.estancias.borrar(this.sel.id); this.estancias.borrandoDesdeEditor = false; }
    else if (this.sel.tipo === 'cota') { this.medicion.cotas.splice(this.sel.id, 1); this.medicion.avisar(); }
    else this.plano.borrar(this.sel);
    this.sel = null;
    this.estancias.seleccion = null;
    this.plano.avisar();
    this.avisar();
  }

  // Cambiar una propiedad del elemento seleccionado (con deshacer)
  cambiar(fn) {
    const el = this.elementoSel();
    if (!el) return;
    this.plano.guardar();
    fn(el);
    if (this.sel.tipo === 'estancia') this.estancias.recalcular(el);
    this.plano.avisar();
    this.estancias.avisar();
    this.avisar();
  }

  // Cancelar lo que esté a medias (Esc)
  cancelar() {
    if (this.herramienta === 'medir' && this.medicion.primero) return this.medicion.cancelar();
    if (this.herramienta === 'estancia' && this.estancias.puntos.length) return this.estancias.cancelar();
    if (this.muroA) { this.muroA = null; return this.avisar(); }
    if (this.huecoInicio) { this.huecoInicio = null; return this.avisar(); }
    if (this.herramienta) return this.elegir(null);
    if (this.sel) this.seleccionar(null);
  }

  // ---------- Dibujo de vistas previas y selección ----------

  dibujar(ctx) {
    const v = this.visor;
    if (v.imprimiendo) return;
    const P = (q) => v.aPantalla(q.x, q.y);
    const s = v.vista.escala;
    ctx.save();

    // Muro en curso
    if (this.herramienta === 'muro' && this.cursor) {
      if (this.muroA) {
        const tmp = { a: this.muroA, b: this.cursor, grosor: this.grosorMuro, lado: 0 };
        const pts = cuerpo(tmp);
        ctx.beginPath(); pts.forEach((q, i) => { const pp = P(q); i ? ctx.lineTo(pp.x, pp.y) : ctx.moveTo(pp.x, pp.y); }); ctx.closePath();
        const est = ESTADOS[this.plano.estadoNuevo()];
        ctx.fillStyle = est.relleno; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
        dibujarCota(ctx, P(this.muroA), P(this.cursor), largo(this.muroA, this.cursor), true);
        dibujarMarca(ctx, P(this.muroA), 'esquina');
      }
      dibujarMarca(ctx, P(this.cursor), this.cursor.tipo === 'extremo' ? 'esquina' : this.cursor.tipo, this.cursor);
    }

    // Hueco en curso
    if ((this.herramienta === 'puerta' || this.herramienta === 'ventana') && this.cursor) {
      const l = this.huecoInicio ? this.huecoInicio.linea : this.cursor.linea;
      if (l) {
        const q0 = this.huecoInicio ? this.huecoInicio.punto : (this.cursor.jamba ? this.cursor.m : l.q);
        const A = P(sumar(q0, por(l.u, -3))), B = P(sumar(q0, por(l.u, 3)));
        ctx.strokeStyle = 'rgba(217,72,15,.35)'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        if (this.huecoInicio) {
          const m = this.cursor.m;
          const t = (m.x - q0.x) * l.u.x + (m.y - q0.y) * l.u.y;
          const fin = sumar(q0, por(l.u, t));
          dibujarCota(ctx, P(q0), P(fin), Math.abs(t), true);
        }
        dibujarMarca(ctx, P(q0), this.huecoInicio && this.huecoInicio.jamba ? 'esquina' : 'pared', { dir: [l.u.x, l.u.y] });
        if (this.huecoInicio && this.cursor.jamba) dibujarMarca(ctx, P(this.cursor.m), 'esquina');
      }
    }

    // Símbolo fantasma
    if (this.herramienta === 'simbolo' && this.fantasma) {
      const def = SIMBOLOS[this.simbolo];
      const f = this.fantasma, pp = P(f);
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.translate(pp.x, pp.y); ctx.rotate(-f.rot); ctx.scale(s, -s);
      ctx.strokeStyle = '#d9480f'; ctx.lineWidth = 1.3 / s;
      pintarSimbolo(ctx, def, def.ancho, def.fondo, 1 / s, '#d9480f');
      ctx.restore();
    }

    // Selección
    const el = this.elementoSel();
    if (el && this.sel.tipo !== 'estancia') {
      ctx.strokeStyle = '#1c7ed6'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      let contorno = null;
      if (this.sel.tipo === 'muro' || this.sel.tipo === 'hueco') contorno = cuerpo(el);
      if (this.sel.tipo === 'simbolo') contorno = esquinasSimbolo(el);
      if (contorno) {
        ctx.beginPath(); contorno.forEach((q, i) => { const pp = P(q); i ? ctx.lineTo(pp.x, pp.y) : ctx.moveTo(pp.x, pp.y); }); ctx.closePath(); ctx.stroke();
      }
      if (this.sel.tipo === 'cota') {
        const A = P(el.a), B = P(el.b);
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(28,126,214,.35)'; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      if (this.sel.tipo === 'muro' || this.sel.tipo === 'hueco') {
        for (const k of ['a', 'b']) tirador(ctx, P(el[k]));
        if (this.sel.tipo === 'muro') dibujarCota(ctx, P(el.a), P(el.b), largo(el.a, el.b), false, { color: '#1c7ed6', sinLinea: true, sinRemates: true, desplazamiento: 0 });
        else dibujarCota(ctx, P(el.a), P(el.b), largo(el.a, el.b), false, { color: '#1c7ed6', sinLinea: true, sinRemates: true, desplazamiento: -16 });
      }
    }
    if (el && this.sel.tipo === 'estancia') for (const q of el.puntos) tirador(ctx, P(q), true);
    ctx.restore();
  }
}

function tirador(ctx, p, cuadrado) {
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1c7ed6'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (cuadrado) ctx.rect(p.x - 5, p.y - 5, 10, 10); else ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
