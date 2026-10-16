// Informe imprimible (o "Guardar como PDF" desde el diálogo de imprimir del navegador):
// planos (actual / reforma / final), tabla de estancias y presupuesto.

function limitesDelPlano(plano, estancias, medicion, datos) {
  const pts = [];
  // solo lo que está en capas visibles
  const ver = (el) => capas.visible(plano.capaDe(el));
  for (const w of plano.muros) if (ver(w)) pts.push(...cuerpo(w));
  for (const h of plano.huecos) if (ver(h)) pts.push(...cuerpo(h));
  for (const s of plano.simbolos) if (ver(s)) pts.push(...esquinasSimbolo(s));
  if (capas.visible('estancias') || capas.visible('nombres') || capas.visible('cotasEstancias')) for (const e of estancias.lista) pts.push(...e.puntos);
  if (capas.visible('cotas')) for (const c of medicion.cotas) pts.push(c.a, c.b);
  if (!pts.length) return { x0: 0, y0: 0, x1: datos.ancho, y1: datos.largo };
  return {
    x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)),
  };
}

// Dibuja la planta en una imagen (PNG) con la vista indicada
function imagenDelPlano(ctxApp, vistaPlano, opciones) {
  const { visor, plano, estancias, medicion } = ctxApp;
  const lim = limitesDelPlano(plano, estancias, medicion, visor.datos);
  const margen = 0.6; // m
  const anchoM = lim.x1 - lim.x0 + 2 * margen, altoM = lim.y1 - lim.y0 + 2 * margen;
  // Imagen de 1800 px de ancho dibujada "a doble densidad": textos y líneas al doble de tamaño,
  // para que se lean bien en un A4
  const W = 1800, DPR = 2.2;
  const H = Math.round(Math.min(2400, Math.max(600, (W * altoM) / anchoM)));
  const FRANJA = 70;                  // px reservados abajo para la escala gráfica
  const Hplano = H;
  const Wc = W / DPR, Hc = Hplano / DPR;
  const escala = Math.min(Wc / anchoM, Hc / altoM);

  const guardada = { vista: { ...visor.vista }, vistaPlano: plano.vista, sel: plano.seleccion };
  visor.vista = {
    escala,
    ox: (Wc - (lim.x1 - lim.x0) * escala) / 2 - lim.x0 * escala,
    oy: (Hc + (lim.y1 - lim.y0) * escala) / 2 + lim.y0 * escala,
  };
  plano.vista = vistaPlano;
  visor.imprimiendo = true;
  const lienzo = document.createElement('canvas');
  lienzo.width = W; lienzo.height = H + FRANJA;
  const ctx = lienzo.getContext('2d');
  try {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H + FRANJA);
    visor.renderizar(ctx, W, H, DPR, { escaneo: opciones.escaneo, tenue: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // escala gráfica
    const objetivo = 150 / (escala * DPR);
    const pot = Math.pow(10, Math.floor(Math.log10(objetivo)));
    const L = [1, 2, 5, 10].map((k) => k * pot).find((l) => l >= objetivo) || 10 * pot;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    const Lp = L * escala * DPR;
    const yb = H + FRANJA - 28;
    ctx.beginPath(); ctx.moveTo(30, yb - 10); ctx.lineTo(30, yb); ctx.lineTo(30 + Lp, yb); ctx.lineTo(30 + Lp, yb - 10); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText(`${fmtM(L, L < 1 ? 1 : 0)} m`, 42 + Lp, yb + 4);
  } finally {
    visor.vista = guardada.vista;
    plano.vista = guardada.vistaPlano;
    visor.imprimiendo = false;
    visor.redibujar();
  }
  return { src: lienzo.toDataURL('image/png'), llamadas: (ctxApp.estancias.llamadas || []).slice(), nombres: (ctxApp.estancias.llamadasNombre || []).slice() };
}

function hayReforma(plano) {
  return plano.muros.some((w) => w.estado !== 'existente') ||
    plano.huecos.some((h) => h.estado !== 'existente') || plano.simbolos.some((s) => s.estado !== 'existente');
}

// opciones: { planos: ['actual','reforma','final'], secciones: ['estancias','lados','presupuesto'] }
function generarInforme(ctxApp, opciones) {
  const { plano, estancias, presupuesto, escaneo } = ctxApp;
  const conReforma = hayReforma(plano);
  const escaneoVisible = capas.visible('escaneo');
  const quiero = (s) => opciones.secciones.includes(s);

  const TITULOS = {
    actual: conReforma ? 'Estado actual' : 'Plano',
    reforma: 'Reforma (amarillo: derribo · rojo: nuevo)',
    final: 'Estado final',
  };
  const planos = opciones.planos.map((v) => ({ titulo: TITULOS[v], vista: v }));

  const e = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = (n) => fmtM(n, 2);
  const lista = estancias.lista;
  const tot = lista.reduce((t, x) => ({
    area: t.area + x.area, per: t.per + x.perimetro, net: t.net + (x.m2ParedesNetas ?? x.m2Paredes), rod: t.rod + (x.mlRodapie ?? x.perimetro),
  }), { area: 0, per: 0, net: 0, rod: 0 });

  const lineas = presupuesto.lineas().filter((l) => l.importe > 0); // las partidas sin precio o sin medición no salen
  // estancias con paquete (y su coste)
  const conPaquete = lista.map((x) => ({ est: x, paq: presupuesto.paquete(x.paquete) })).filter((z) => z.paq)
    .map((z) => ({ ...z, coste: presupuesto.costePaquete(z.paq, z.est) }));
  const hayPresupuesto = lineas.length > 0 || conPaquete.some((z) => z.coste.total > 0);
  const dec = (u) => (u.corto === 'ud' || u.corto === 'PA' ? 0 : 2);
  const t = presupuesto.totales();
  const fecha = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `
    <header class="infCabecera">
      <div>
        <h1>${opciones.planos.length || quiero('estancias') || quiero('lados') ? 'Medición' : ''}${hayPresupuesto && quiero('presupuesto') ? (opciones.planos.length || quiero('estancias') ? ' y presupuesto' : 'Presupuesto') : ''}</h1>
        ${presupuesto.obra ? `<p class="infObra">${e(presupuesto.obra)}</p>` : ''}
      </div>
      <div class="infFecha">${fecha}<br><span>Escaneo: ${e(escaneo.nombre)}</span></div>
    </header>

    ${planos.map((p) => {
      const img = imagenDelPlano(ctxApp, p.vista, { escaneo: escaneoVisible });
      return `
      <section class="infPlano">
        <h2>${p.titulo}</h2>
        <img src="${img.src}" alt="${p.titulo}">
        ${img.nombres.length ? `<p class="infLlamadas"><strong>Estancias rotuladas con letra:</strong> ${img.nombres
          .map((c) => `<span>${c.letra}. ${e(c.nombre)} (${fmtM(c.area, 2)} m²)</span>`).join(' · ')}</p>` : ''}
        ${img.llamadas.length ? `<p class="infLlamadas"><strong>Cotas numeradas:</strong> ${img.llamadas
          .map((c) => `<span>${c.n}. ${e(c.estancia)}: ${c.texto}</span>`).join(' · ')}</p>` : ''}
      </section>`;
    }).join('')}

    ${lista.length && quiero('estancias') ? `
    <section class="infTabla">
      <h2>Estancias</h2>
      <table>
        <thead><tr><th>Estancia</th><th>Suelo</th><th>Perímetro</th><th>Altura</th><th>Paredes*</th><th>Rodapié*</th></tr></thead>
        <tbody>${lista.map((x) => `<tr><td>${e(x.nombre)}</td><td>${f2(x.area)} m²</td><td>${f2(x.perimetro)} m</td><td>${f2(x.altura)} m</td>
          <td>${f2(x.m2ParedesNetas ?? x.m2Paredes)} m²</td><td>${f2(x.mlRodapie ?? x.perimetro)} m</td></tr>`).join('')}</tbody>
        ${lista.length > 1 ? `<tfoot><tr><td>Total</td><td>${f2(tot.area)} m²</td><td>${f2(tot.per)} m</td><td></td><td>${f2(tot.net)} m²</td><td>${f2(tot.rod)} m</td></tr></tfoot>` : ''}
      </table>
      <p class="infNota">* Paredes sin puertas ni ventanas; rodapié sin el ancho de las puertas.</p>
    </section>` : ''}

    ${lista.length && quiero('lados') ? `
    <section class="infTabla">
      <h2>Medidas de los lados</h2>
      <table class="infLados"><tbody>${lista.map((x) => `<tr><td>${e(x.nombre)}</td><td>${x.puntos.map((q, i) => {
        const r = x.puntos[(i + 1) % x.puntos.length];
        return fmtM(Math.hypot(r.x - q.x, r.y - q.y), 2);
      }).join(' · ')} m</td></tr>`).join('')}</tbody></table>
      <p class="infNota">Lados en el orden en que se dibujó cada estancia.</p>
    </section>` : ''}

    ${hayPresupuesto && quiero('presupuesto') ? `
    <section class="infTabla">
      <h2>Presupuesto</h2>
      ${conPaquete.filter((z) => z.coste.total > 0).map((z) => `
        <p class="infEstPaq"><strong>${e(z.est.nombre)} — ${e(z.paq.nombre)}</strong>
          <span>· ${fmtM(z.est.area, 2)} m² suelo · ${fmtM(z.est.m2ParedesNetas ?? z.est.m2Paredes, 2)} m² paredes</span></p>
        <table>
          <thead><tr><th>Concepto</th><th>Medición</th><th>Precio</th><th>Importe</th></tr></thead>
          <tbody>${z.coste.lineas.filter((x) => x.importe > 0).map((x) => `<tr><td>${e(x.l.concepto)}</td>
            <td>${fmtM(x.cant, dec(x.u))} ${x.u.corto}</td><td>${fmtEur(x.l.precio)}</td><td>${fmtEur(x.importe)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">Subtotal ${e(z.est.nombre)}</td><td>${fmtEur(z.coste.total)}</td></tr></tfoot>
        </table>`).join('')}
      ${lineas.length ? `
        <p class="infEstPaq"><strong>Partidas generales</strong></p>
        <table>
          <thead><tr><th>Concepto</th><th>Medición</th><th>Precio</th><th>Importe</th></tr></thead>
          <tbody>${lineas.map((l) => `<tr><td>${e(l.p.nombre)}</td><td>${fmtM(l.cant, UNIDADES[l.p.unidad].corto === 'ud' ? 0 : 2)} ${UNIDADES[l.p.unidad].corto}</td>
            <td>${fmtEur(l.p.precio || 0)}</td><td>${fmtEur(l.importe)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">Subtotal partidas generales</td><td>${fmtEur(t.generales)}</td></tr></tfoot>
        </table>` : ''}
      <table style="margin-top:10px">
        <tfoot>
          <tr><td colspan="3">Base imponible</td><td>${fmtEur(t.base)}</td></tr>
          <tr><td colspan="3">IVA (${fmtM(presupuesto.iva, 0)} %)</td><td>${fmtEur(t.iva)}</td></tr>
          <tr class="infTotal"><td colspan="3">Total</td><td>${fmtEur(t.total)}</td></tr>
        </tfoot>
      </table>
    </section>` : ''}

    ${quiero('comparativa') && conPaquete.length ? `
    <section class="infTabla">
      <h2>Comparativa de paquetes</h2>
      ${conPaquete.map((z) => {
        const opciones = presupuesto.paquetesParaComparar(z.est);
        if (opciones.length < 2) return '';
        return `<p class="infEstPaq"><strong>${e(z.est.nombre)}</strong> <span>· ${fmtM(z.est.area, 2)} m² suelo · ${fmtM(z.est.m2ParedesNetas ?? z.est.m2Paredes, 2)} m² paredes</span></p>
        <table class="infComparativa">
          <thead><tr><th style="text-align:left">Paquete</th><th>Precio por m² de suelo</th><th>Importe (sin IVA)</th></tr></thead>
          <tbody>${opciones.map((q) => { const c = presupuesto.costePaquete(q, z.est); return `<tr class="${q.id === z.paq.id ? 'elegido' : ''}">
            <td style="text-align:left">${e(q.nombre)}${q.id === z.paq.id ? ' (elegido)' : ''}</td>
            <td>${z.est.area > 0 && c.total ? fmtEur(c.total / z.est.area) : '—'}</td><td>${fmtEur(c.total)}</td></tr>`; }).join('')}</tbody>
        </table>`;
      }).join('')}
    </section>` : ''}

    <p class="infPie">Medidas obtenidas de escaneo láser. Precisión orientativa ±2–3 cm; para elementos a medida, confirmar en obra.</p>
  `;
  const cont = document.getElementById('informe');
  cont.innerHTML = html;
  // esperar a que se carguen las imágenes antes de imprimir
  const imgs = [...cont.querySelectorAll('img')];
  Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(() => window.print());
}
