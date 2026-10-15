// Informe imprimible (o "Guardar como PDF" desde el diálogo de imprimir del navegador):
// planos (actual / reforma / final), tabla de estancias y presupuesto.

function limitesDelPlano(plano, estancias, medicion, datos) {
  const pts = [];
  for (const w of plano.muros) pts.push(...cuerpo(w));
  for (const h of plano.huecos) pts.push(...cuerpo(h));
  for (const s of plano.simbolos) pts.push(...esquinasSimbolo(s));
  for (const e of estancias.lista) pts.push(...e.puntos);
  for (const c of medicion.cotas) pts.push(c.a, c.b);
  if (!pts.length) return { x0: 0, y0: 0, x1: datos.ancho, y1: datos.largo };
  return {
    x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)),
  };
}

// Dibuja la planta en una imagen (PNG) con la vista indicada
function imagenDelPlano({ visor, plano, estancias, medicion }, vistaPlano, opciones) {
  const lim = limitesDelPlano(plano, estancias, medicion, visor.datos);
  const margen = 0.6; // m
  const anchoM = lim.x1 - lim.x0 + 2 * margen, altoM = lim.y1 - lim.y0 + 2 * margen;
  // Imagen de 1800 px de ancho dibujada "a doble densidad": textos y líneas al doble de tamaño,
  // para que se lean bien en un A4
  const W = 1800, DPR = 2.2;
  const H = Math.round(Math.min(2400, Math.max(600, (W * altoM) / anchoM)));
  const Wc = W / DPR, Hc = H / DPR;
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
  lienzo.width = W; lienzo.height = H;
  const ctx = lienzo.getContext('2d');
  try {
    visor.renderizar(ctx, W, H, DPR, { escaneo: opciones.escaneo, tenue: true });
    // escala gráfica
    const objetivo = 150 / (escala * DPR);
    const pot = Math.pow(10, Math.floor(Math.log10(objetivo)));
    const L = [1, 2, 5, 10].map((k) => k * pot).find((l) => l >= objetivo) || 10 * pot;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    const Lp = L * escala * DPR;
    ctx.beginPath(); ctx.moveTo(30, H - 34); ctx.lineTo(30, H - 24); ctx.lineTo(30 + Lp, H - 24); ctx.lineTo(30 + Lp, H - 34); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText(`${fmtM(L, L < 1 ? 1 : 0)} m`, 42 + Lp, H - 20);
  } finally {
    visor.vista = guardada.vista;
    plano.vista = guardada.vistaPlano;
    visor.imprimiendo = false;
    visor.redibujar();
  }
  return lienzo.toDataURL('image/png');
}

function generarInforme(ctxApp) {
  const { plano, estancias, presupuesto, escaneo, visor } = ctxApp;
  const hayReforma = plano.muros.some((w) => w.estado !== 'existente') ||
    plano.huecos.some((h) => h.estado !== 'existente') || plano.simbolos.some((s) => s.estado !== 'existente');
  const escaneoVisible = visor.verEscaneo;

  const planos = [{ titulo: hayReforma ? 'Estado actual' : 'Plano', vista: 'actual' }];
  if (hayReforma) {
    planos.push({ titulo: 'Reforma (amarillo: derribo · rojo: nuevo)', vista: 'reforma' });
    planos.push({ titulo: 'Estado final', vista: 'final' });
  }

  const e = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = (n) => fmtM(n, 2);
  const lista = estancias.lista;
  const tot = lista.reduce((t, x) => ({
    area: t.area + x.area, per: t.per + x.perimetro, net: t.net + (x.m2ParedesNetas ?? x.m2Paredes), rod: t.rod + (x.mlRodapie ?? x.perimetro),
  }), { area: 0, per: 0, net: 0, rod: 0 });

  const lineas = presupuesto.lineas().filter((l) => l.importe > 0); // las partidas sin precio o sin medición no salen
  const t = presupuesto.totales();
  const fecha = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = `
    <header class="infCabecera">
      <div>
        <h1>Medición${lineas.length ? ' y presupuesto' : ''}</h1>
        ${presupuesto.obra ? `<p class="infObra">${e(presupuesto.obra)}</p>` : ''}
      </div>
      <div class="infFecha">${fecha}<br><span>Escaneo: ${e(escaneo.nombre)}</span></div>
    </header>

    ${planos.map((p) => `
      <section class="infPlano">
        <h2>${p.titulo}</h2>
        <img src="${imagenDelPlano(ctxApp, p.vista, { escaneo: escaneoVisible })}" alt="${p.titulo}">
      </section>`).join('')}

    ${lista.length ? `
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

    ${lineas.length ? `
    <section class="infTabla">
      <h2>Presupuesto</h2>
      <table>
        <thead><tr><th>Concepto</th><th>Medición</th><th>Precio</th><th>Importe</th></tr></thead>
        <tbody>${lineas.map((l) => `<tr><td>${e(l.p.nombre)}</td><td>${fmtM(l.cant, UNIDADES[l.p.unidad].corto === 'ud' ? 0 : 2)} ${UNIDADES[l.p.unidad].corto}</td>
          <td>${fmtEur(l.p.precio || 0)}</td><td>${fmtEur(l.importe)}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="3">Base imponible</td><td>${fmtEur(t.base)}</td></tr>
          <tr><td colspan="3">IVA (${fmtM(presupuesto.iva, 0)} %)</td><td>${fmtEur(t.iva)}</td></tr>
          <tr class="infTotal"><td colspan="3">Total</td><td>${fmtEur(t.total)}</td></tr>
        </tfoot>
      </table>
    </section>` : ''}

    <p class="infPie">Medidas obtenidas de escaneo láser. Precisión orientativa ±2–3 cm; para elementos a medida, confirmar en obra.</p>
  `;
  const cont = document.getElementById('informe');
  cont.innerHTML = html;
  // esperar a que se carguen las imágenes antes de imprimir
  const imgs = [...cont.querySelectorAll('img')];
  Promise.all(imgs.map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(() => window.print());
}
