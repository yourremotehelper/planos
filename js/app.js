// Pantalla principal: carga del escaneo, herramientas, paneles, presupuesto y guardar/cargar trabajo.

const MAX_PUNTOS = 3000000; // puntos que nos quedamos para trabajar con fluidez

const $ = (id) => document.getElementById(id);
const fmt = (n, dec = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const filasHTML = (filas) => filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (t) => parseFloat(String(t).replace(',', '.'));

const estado = { escaneo: null, sinGuardar: false, paletaPlegada: false };

// ---------- Piezas ----------

const visor = new Visor($('lienzo'));
const iman = new Iman(visor);
const superficie = new CapaSuperficie(visor);
const estancias = new Estancias(visor, iman);
const medicion = new Medicion(visor, iman);
const plano = new Plano(visor);
const editor = new Editor({ visor, plano, iman, estancias, medicion, superficie });
const presupuesto = new Presupuesto({ plano, estancias });
visor.capasEncima = [superficie, estancias, plano, medicion, { dibujar: (ctx) => estancias.dibujarEtiquetas(ctx) }, editor]; // orden de dibujo

// Historial de deshacer: una "foto" de todo lo editable
plano.capturar = () => ({
  plano: plano.serializar(), estancias: estancias.serializar(), cotas: JSON.parse(JSON.stringify(medicion.cotas)),
});
plano.restaurar = (s) => {
  plano.cargarDatos(s.plano);
  estancias.restaurar(s.estancias);
  medicion.cotas = s.cotas;
  if (editor.sel && !editor.elementoSel()) editor.sel = null;
};
estancias.alAntesDeCambiar = () => plano.guardar();
medicion.alAntesDeCambiar = () => plano.guardar();
estancias.obtenerHuecos = () => plano.huecos;

const marcarCambio = () => { estado.sinGuardar = true; };
plano.alCambiar = () => { estancias.recalcularTodas(); marcarCambio(); actualizarSuperficies(); actualizarPresupuesto(); actualizarPropiedades(); actualizarCapas(); };
estancias.alCambiar = () => { marcarCambio(); presupuesto.limpiarEstancias(); actualizarHerramientas(); actualizarSuperficies(); actualizarPresupuesto(); };
medicion.alCambiar = () => { marcarCambio(); actualizarHerramientas(); };
superficie.alCambiar = () => { marcarCambio(); actualizarSuperficies(); };
editor.alCambiar = () => { actualizarHerramientas(); actualizarPropiedades(); };
presupuesto.alCambiar = () => { marcarCambio(); actualizarPresupuesto(); };

visor.alHacerClic = (p, e) => editor.clic(p, e);
visor.alMoverCursor = (p, e) => editor.mover(p, e);
visor.alPulsar = (p, e) => editor.pulsar(p, e);
visor.alArrastrar = (p, e) => editor.arrastrar(p, e);
visor.alSoltarArrastre = () => editor.soltar();

// ---------- Cambiar de pantalla ----------

function mostrarCarga(zona) {
  $('pantallaCarga').classList.remove('oculto');
  $('pantallaVisor').classList.add('oculto');
  $('accionesVisor').classList.add('oculto');
  $('nombreEscaneo').textContent = 'Abrir un escaneo';
  ['zonaCarga', 'zonaProgreso', 'zonaError'].forEach((z) => $(z).classList.toggle('oculto', z !== zona));
}

function mostrarVisor() {
  $('pantallaCarga').classList.add('oculto');
  $('pantallaVisor').classList.remove('oculto');
  $('accionesVisor').classList.remove('oculto');
}

// ---------- Carga del escaneo ----------

function cargar(archivo) {
  if (!archivo) return;
  if (!archivo.name.toLowerCase().endsWith('.ply')) { mostrarError('El archivo debe tener extensión .ply.'); return; }
  $('nombreArchivo').textContent = `Leyendo ${archivo.name}…`;
  $('progreso').style.width = '0';
  $('textoProgreso').textContent = '0 %';
  mostrarCarga('zonaProgreso');

  const inicio = performance.now();
  const worker = new Worker('js/worker.js');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.tipo === 'progreso') {
      const pct = Math.round(m.fraccion * 100);
      $('progreso').style.width = pct + '%';
      $('textoProgreso').textContent = pct + ' %';
    } else if (m.tipo === 'fase') {
      $('textoProgreso').textContent = m.texto;
    } else if (m.tipo === 'listo') {
      worker.terminate();
      m.segundos = (performance.now() - inicio) / 1000;
      estado.escaneo = m;
      abrirEnVisor(m);
    } else if (m.tipo === 'error') {
      worker.terminate();
      mostrarError(m.mensaje);
    }
  };
  worker.onerror = (e) => { worker.terminate(); mostrarError('Error inesperado al leer: ' + (e.message || 'desconocido')); };
  worker.postMessage({ tipo: 'cargar', archivo, maxPuntos: MAX_PUNTOS });
}

function abrirEnVisor(m) {
  $('nombreEscaneo').textContent = m.nombre;
  $('datos').innerHTML = filasHTML([
    ['Archivo', esc(m.nombre)],
    ['Tamaño', `${fmt(m.tamanoMB, 1)} MB`],
    ['Puntos', `${fmt(m.totalPuntos)}`],
    ['Usados', `${fmt(m.puntosUsados)}${m.salto > 1 ? ` (1 de ${m.salto})` : ''}`],
    ['Tiempo', `${fmt(m.segundos, 1)} s`],
  ]);
  $('ajuste').innerHTML = filasHTML([
    ['Inclinación', `${fmt(m.inclinacion, 2)}°`],
    ['Giro', `${fmt(m.angulo, 1)}°`],
    ['Planta', `${fmt(m.ancho, 2)} × ${fmt(m.largo, 2)} m`],
    ['Techo', m.techo ? `≈ ${fmt(m.techo, 2)} m` : 'No detectado'],
  ]);
  const aviso = $('avisoSuelo');
  aviso.classList.toggle('oculto', m.coberturaSuelo >= 0.25);
  aviso.textContent = 'Se ha visto poco suelo en el escaneo. Revisa que la planta tenga sentido; si no, puede que haya que repetir el escaneo.';

  const deslizador = $('alturaCorte');
  deslizador.max = String(Math.max(1.5, Math.floor(((m.techo || 3) - 0.1) * 20) / 20));
  deslizador.value = '1.1';
  actualizarTextoCorte();

  mostrarVisor();
  visor.cargar(m);
  superficie.calcular(m, visor.malla);
  medicion.cotas = [];
  estancias.borrarTodo();
  plano.limpiar();
  plano.alturaPorDefecto = Math.round((m.techo || 2.5) * 100) / 100;
  editor.elegir(null);
  actualizarTodo();
  estado.sinGuardar = false;
}

function mostrarError(texto) { $('textoError').textContent = texto; mostrarCarga('zonaError'); }

function actualizarTodo() {
  actualizarHerramientas(); actualizarPropiedades(); actualizarSuperficies(); actualizarPresupuesto(); actualizarVista(); actualizarCapas();
}

// ---------- Altura del corte ----------

function actualizarTextoCorte() { $('valorCorte').value = fmt(parseFloat($('alturaCorte').value), 2); }
$('alturaCorte').addEventListener('input', () => { actualizarTextoCorte(); visor.cambiarCorte(parseFloat($('alturaCorte').value)); });
function aplicarCorteEscrito() {
  const campo = $('valorCorte'), desliz = $('alturaCorte');
  let v = num(campo.value);
  if (Number.isNaN(v)) { actualizarTextoCorte(); return; }
  v = Math.min(parseFloat(desliz.max), Math.max(parseFloat(desliz.min), v));
  desliz.value = String(v); campo.value = fmt(v, 2);
  visor.cambiarCorte(v);
}
$('valorCorte').addEventListener('change', aplicarCorteEscrito);
$('valorCorte').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { aplicarCorteEscrito(); e.target.blur(); }
  if (e.key === 'Escape') { actualizarTextoCorte(); e.target.blur(); }
});
$('valorCorte').addEventListener('focus', (e) => e.target.select());

// ---------- Escala gráfica ----------

visor.alCambiarVista = (vista) => {
  const objetivo = 100 / vista.escala;
  const pot = Math.pow(10, Math.floor(Math.log10(objetivo)));
  const L = [1, 2, 5, 10].map((k) => k * pot).find((l) => l >= objetivo) || 10 * pot;
  $('regla').style.width = `${L * vista.escala}px`;
  $('textoEscala').textContent = L >= 1 ? `${fmt(L)} m` : `${fmt(L * 100)} cm`;
};

// ---------- Vista del plano (actual / reforma / final) ----------

function actualizarVista() {
  document.querySelectorAll('#selectorVista button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vista === plano.vista)));
}
$('selectorVista').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  plano.vista = b.dataset.vista;
  if (editor.sel && ['muro', 'hueco', 'simbolo'].includes(editor.sel.tipo) && !plano.visible(editor.elementoSel())) editor.seleccionar(null);
  actualizarVista(); actualizarHerramientas();
  visor.redibujar();
});
$('verEscaneo').addEventListener('change', (e) => capas.poner('escaneo', 'visible', e.target.checked));

// ---------- Herramientas ----------

const PISTAS = {
  '': 'Pulsa un elemento para elegirlo · arrástralo para moverlo',
  medir: (m) => (m.primero ? 'Pincha en el segundo punto · Esc para cancelar' : 'Pincha en el primer punto · arrastra para moverte'),
  estancia: () => {
    const n = estancias.puntos.length;
    return n === 0 ? 'Pincha en una esquina de la estancia' : n < 3 ? 'Sigue pinchando en las esquinas' : 'Sigue, o pincha en el primer punto (o Intro) para cerrar';
  },
  muro: () => (editor.muroA ? 'Pincha el final del tramo · sigue encadenando · Esc para terminar' : 'Pincha donde empieza el muro'),
  puerta: () => (editor.huecoInicio ? 'Pincha en la otra jamba (o en el mismo sitio para 80 cm)' : 'Pincha en una jamba de la puerta, sobre la pared'),
  ventana: () => (editor.huecoInicio ? 'Pincha en el otro lado (o en el mismo sitio para 120 cm)' : 'Pincha en un lado de la ventana, sobre la pared'),
  simbolo: () => (estado.paletaPlegada ? `${SIMBOLOS[editor.simbolo].nombre}: toca donde va · 🛋️ para cambiar` : 'Elige un símbolo y pincha: se pega solo a la pared · R para girar'),
};

function actualizarHerramientas() {
  const h = editor.herramienta || '';
  document.querySelectorAll('#barraHerramientas [data-herramienta]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.herramienta === h)));
  $('btnIman').setAttribute('aria-pressed', String(iman.activo));
  $('btnDeshacerGlobal').disabled = !plano.historial.length;
  $('btnRehacer').disabled = !plano.rehacer.length;
  $('grupoCotas').classList.toggle('oculto', h !== 'medir' || medicion.cotas.length === 0);
  $('grupoEstancia').classList.toggle('oculto', h !== 'estancia' || estancias.puntos.length === 0);
  $('btnCerrarEstancia').disabled = estancias.puntos.length < 3;
  $('grupoMuro').classList.toggle('oculto', h !== 'muro');
  $('grupoSimbolos').classList.toggle('oculto', h !== 'simbolo' || estado.paletaPlegada);
  document.querySelectorAll('#grupoSimbolos [data-simbolo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.simbolo === editor.simbolo)));

  const pista = $('pista');
  const f = PISTAS[h];
  let texto = typeof f === 'function' ? f(medicion) : f;
  if (h && h !== 'medir' && h !== 'estancia' && h !== 'simbolo' && plano.vista !== 'actual' && !editor.muroA && !editor.huecoInicio) texto += ' · se dibuja como NUEVO';
  if (h === 'simbolo' && plano.vista !== 'actual') texto += ' · se coloca como NUEVO';
  if (editor.sel && !h) texto = '';
  if (h && editor.capaActivada) texto = `Capa «${CAPAS.find((c) => c.id === editor.capaActivada).nombre}» mostrada para dibujar · ${texto}`;
  pista.textContent = texto || '';
  pista.classList.toggle('oculto', !texto);
}

$('barraHerramientas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-herramienta]');
  if (!b) return;
  const h = b.dataset.herramienta || null;
  // En móvil la paleta se pliega al elegir símbolo; tocar 🛋️ otra vez la vuelve a abrir
  if (h === 'simbolo' && editor.herramienta === 'simbolo' && estado.paletaPlegada) { estado.paletaPlegada = false; actualizarHerramientas(); return; }
  estado.paletaPlegada = false;
  editor.elegir(editor.herramienta === h ? null : h);
});
$('btnIman').addEventListener('click', () => {
  iman.activo = !iman.activo;
  medicion.cursor = null; estancias.cursor = null; editor.cursor = null;
  visor.redibujar(); actualizarHerramientas();
});
$('btnDeshacerGlobal').addEventListener('click', () => { deshacer(); });
$('btnRehacer').addEventListener('click', () => { plano.rehacerCambio(); actualizarTodo(); });
$('btnBorrarCotas').addEventListener('click', () => { plano.guardar(); medicion.borrarTodo(); });
$('btnCerrarEstancia').addEventListener('click', () => estancias.cerrar());
$('btnDeshacerPunto').addEventListener('click', () => estancias.deshacerPunto());
$('btnCancelarEstancia').addEventListener('click', () => estancias.cancelar());
$('grosorMuro').addEventListener('change', (e) => { editor.grosorMuro = num(e.target.value); });
$('btnTerminarMuro').addEventListener('click', () => { editor.muroA = null; editor.avisar(); });

function deshacer() {
  // primero, lo que esté a medias en la herramienta; si no, el último cambio
  if (editor.herramienta === 'estancia' && estancias.puntos.length) return estancias.deshacerPunto();
  if (editor.herramienta === 'medir' && medicion.primero) return medicion.cancelar();
  if (editor.muroA) { editor.muroA = null; return editor.avisar(); }
  if (editor.huecoInicio) { editor.huecoInicio = null; return editor.avisar(); }
  plano.deshacer();
  actualizarTodo();
}

// Paleta de símbolos (con miniatura dibujada)
(function crearPaleta() {
  const cont = $('grupoSimbolos');
  const grupos = [...new Set(BIBLIOTECA.map((s) => s.grupo))];
  cont.innerHTML = grupos.map((g) => `<div class="grupoPaleta"><span class="tituloPaleta">${g}</span>${BIBLIOTECA.filter((s) => s.grupo === g)
    .map((s) => `<button class="simbolo" data-simbolo="${s.clave}" title="${s.nombre} (${fmt(s.ancho * 100)} × ${fmt(s.fondo * 100)} cm)"><canvas width="44" height="44"></canvas><span>${s.nombre}</span></button>`).join('')}</div>`).join('');
  cont.querySelectorAll('[data-simbolo]').forEach((b) => {
    const def = SIMBOLOS[b.dataset.simbolo];
    const cv = b.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    cv.width = 44 * dpr; cv.height = 44 * dpr; cv.style.width = '44px'; cv.style.height = '44px';
    const ctx = cv.getContext('2d');
    const s = (38 * dpr) / Math.max(def.ancho, def.fondo);
    ctx.translate(22 * dpr, 22 * dpr); ctx.scale(s, -s);
    ctx.strokeStyle = '#343a40'; ctx.lineWidth = (1.1 * dpr) / s;
    pintarSimbolo(ctx, def, def.ancho, def.fondo, dpr / s, '#343a40');
  });
  cont.addEventListener('click', (e) => {
    const b = e.target.closest('[data-simbolo]');
    if (!b) return;
    editor.simbolo = b.dataset.simbolo;
    const capaSim = capaDeSimbolo(editor.simbolo);
    editor.capaActivada = capas.activar(capaSim) ? capaSim : null;
    if (window.innerWidth <= 600) estado.paletaPlegada = true;
    actualizarHerramientas();
  });
})();

// ---------- Propiedades del elemento elegido ----------

const ESTADO_BOTONES = (actual) => `<div class="segmentado estados">${Object.entries(ESTADOS)
  .map(([k, v]) => `<button data-estado="${k}" aria-pressed="${k === actual}" class="est-${k}">${v.nombre}</button>`).join('')}</div>`;

function actualizarPropiedades() {
  const panel = $('panelPropiedades');
  const el = editor.elementoSel();
  if (!el || editor.herramienta) { panel.classList.add('oculto'); return; }
  const tipo = editor.sel.tipo;
  let html = '';
  const campo = (etq, clave, valor, unidad, extra = '') =>
    `<label class="prop">${etq}<span><input data-campo="${clave}" value="${fmt(valor, 2)}" inputmode="decimal" ${extra}> ${unidad}</span></label>`;

  if (tipo === 'muro') {
    html = `<strong>Muro</strong>${ESTADO_BOTONES(el.estado)}
      ${campo('Largo', 'largo', largo(el.a, el.b), 'm')}
      ${campo('Grosor', 'grosor', el.grosor * 100, 'cm')}
      ${campo('Altura', 'altura', el.altura, 'm')}
      <div class="fila"><span>Grosor hacia</span><div class="segmentado">
        <button data-lado="1" aria-pressed="${el.lado === 1}" title="A un lado">◧</button>
        <button data-lado="0" aria-pressed="${el.lado === 0}" title="Centrado">▣</button>
        <button data-lado="-1" aria-pressed="${el.lado === -1}" title="Al otro lado">◨</button></div></div>`;
  } else if (tipo === 'hueco') {
    html = `<strong>${el.tipo === 'puerta' ? 'Puerta' : 'Ventana'}</strong>${ESTADO_BOTONES(el.estado)}
      ${campo('Ancho', 'ancho', largo(el.a, el.b), 'm')}
      ${campo('Alto', 'alto', el.alto, 'm')}
      ${el.tipo === 'ventana' ? campo('Antepecho', 'antepecho', el.antepecho, 'm') : ''}
      ${el.tipo === 'puerta' ? `<div class="fila"><button class="mini" data-accion="bisagra">⇄ Bisagra</button><button class="mini" data-accion="abre">⇅ Abre hacia</button></div>` : ''}`;
  } else if (tipo === 'simbolo') {
    const def = SIMBOLOS[el.clave];
    html = `<strong>${def ? def.nombre : 'Símbolo'}</strong>${ESTADO_BOTONES(el.estado)}
      ${campo('Ancho', 'ancho', el.ancho, 'm')}
      ${campo('Fondo', 'fondo', el.fondo, 'm')}
      <div class="fila"><button class="mini" data-accion="girar-izq">⟲ 90°</button><button class="mini" data-accion="girar-der">⟳ 90°</button></div>`;
  } else if (tipo === 'estancia') {
    html = `<strong>${esc(el.nombre)}</strong><p class="nota">${fmt(el.area, 2)} m² · arrastra los cuadrados azules para corregir las esquinas.</p>`;
  } else if (tipo === 'cota') {
    html = `<strong>Cota</strong><p class="nota">${fmt(el.d, 2)} m</p>`;
  }
  html += `<button class="mini peligro" data-accion="borrar">🗑 Borrar</button>`;
  panel.innerHTML = html;
  panel.classList.remove('oculto');
}

$('panelPropiedades').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.estado) editor.cambiar((el) => { el.estado = b.dataset.estado; });
  if (b.dataset.lado !== undefined) editor.cambiar((el) => { el.lado = Number(b.dataset.lado); });
  const a = b.dataset.accion;
  if (a === 'borrar') editor.borrarSeleccion();
  if (a === 'bisagra') editor.cambiar((el) => { el.bisagra = el.bisagra === 'a' ? 'b' : 'a'; });
  if (a === 'abre') editor.cambiar((el) => { el.abreLado = -el.abreLado; });
  if (a === 'girar-izq') editor.girarSeleccion(90);
  if (a === 'girar-der') editor.girarSeleccion(-90);
});
$('panelPropiedades').addEventListener('change', (e) => {
  const c = e.target.dataset.campo;
  const v = num(e.target.value);
  if (!c || Number.isNaN(v) || v <= 0) { actualizarPropiedades(); return; }
  editor.cambiar((el) => {
    if (c === 'largo' || (c === 'ancho' && editor.sel.tipo === 'hueco')) {
      // se conserva el extremo a y la dirección
      const u = unit(el.a, el.b);
      if (editor.sel.tipo === 'hueco') { const mid = por(sumar(el.a, el.b), 0.5); el.a = sumar(mid, por(u, -v / 2)); el.b = sumar(mid, por(u, v / 2)); }
      else el.b = sumar(el.a, por(u, v));
    } else if (c === 'grosor') el.grosor = v / 100;
    else el[c] = v;
  });
});
$('panelPropiedades').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// ---------- Teclado ----------

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || $('pantallaVisor').classList.contains('oculto')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { editor.cancelar(); actualizarHerramientas(); }
  else if (ctrl && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); deshacer(); }
  else if (ctrl && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); plano.rehacerCambio(); actualizarTodo(); }
  else if (e.key === 'Enter' && editor.herramienta === 'estancia') estancias.cerrar();
  else if (e.key === 'Enter' && editor.herramienta === 'muro') { editor.muroA = null; editor.avisar(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !editor.herramienta && editor.sel) { e.preventDefault(); editor.borrarSeleccion(); }
  else if ((e.key === 'r' || e.key === 'R') && !ctrl) editor.girarSeleccion(e.shiftKey ? -90 : 90);
});

// ---------- Paneles laterales ----------

const PANELES = ['panelInfo', 'panelSuperficies', 'panelPresupuesto', 'panelCapas'];
const BOTON_PANEL = { panelInfo: 'btnInfo', panelSuperficies: 'btnSuperficies', panelPresupuesto: 'btnPresupuesto', panelCapas: 'btnCapas' };
function abrirPanel(id) {
  for (const p of PANELES) { $(p).classList.toggle('oculto', p !== id); $(BOTON_PANEL[p]).classList.toggle('activo', p === id); }
}
function alternarPanel(id) { abrirPanel($(id).classList.contains('oculto') ? id : null); }
$('btnInfo').addEventListener('click', () => alternarPanel('panelInfo'));
$('btnSuperficies').addEventListener('click', () => alternarPanel('panelSuperficies'));
$('btnPresupuesto').addEventListener('click', () => alternarPanel('panelPresupuesto'));
$('btnCapas').addEventListener('click', () => alternarPanel('panelCapas'));
document.querySelectorAll('[data-cierra]').forEach((b) => b.addEventListener('click', () => abrirPanel(null)));

// ---------- Capas ----------

function cuantosEnCapa(id) {
  const n = {
    estancias: estancias.lista.length, nombres: estancias.lista.length, cotasEstancias: estancias.lista.length,
    cotas: medicion.cotas.length, muros: plano.muros.length, huecos: plano.huecos.length,
  }[id];
  if (n !== undefined) return n;
  if (['sanitarios', 'cocina', 'mobiliario'].includes(id)) return plano.simbolos.filter((s) => capaDeSimbolo(s.clave) === id).length;
  return null;
}

function actualizarCapas() {
  $('listaCapas').innerHTML = CAPAS.map((c) => {
    const st = capas.estado[c.id];
    const n = cuantosEnCapa(c.id);
    return `<li data-capa="${c.id}" class="${st.visible ? '' : 'oculta'}">
      <span class="iconoCapa">${c.icono}</span>
      <span class="nombreCapa">${c.nombre}</span>
      ${n !== null ? `<span class="cuenta">${n}</span>` : ''}
      <button class="interruptorCapa" data-campo="visible" aria-pressed="${st.visible}" title="${st.visible ? 'Ocultar' : 'Mostrar'}">👁</button>
      <button class="interruptorCapa" data-campo="bloqueada" aria-pressed="${st.bloqueada}" title="${st.bloqueada ? 'Desbloquear' : 'Bloquear'}" ${CAPAS_SIN_BLOQUEO.has(c.id) ? 'disabled' : ''}>🔒</button>
    </li>`;
  }).join('');
  $('verEscaneo').checked = capas.visible('escaneo');
  $('verZonas').checked = capas.visible('zonas');
}

$('listaCapas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-campo]');
  if (!b) return;
  const id = b.closest('[data-capa]').dataset.capa;
  capas.poner(id, b.dataset.campo, !capas.estado[id][b.dataset.campo]);
});
$('btnMostrarTodo').addEventListener('click', () => capas.mostrarTodo());

capas.alCambiar = () => {
  // si lo elegido queda oculto o bloqueado, se suelta
  if (editor.sel) {
    const el = editor.elementoSel();
    const ok = !el ? false
      : editor.sel.tipo === 'estancia' ? capas.editable('estancias')
      : editor.sel.tipo === 'cota' ? capas.editable('cotas')
      : plano.editable(el);
    if (!ok) editor.seleccionar(null);
  }
  marcarCambio();
  actualizarCapas();
  visor.redibujar();
};

// ---------- Superficies y estancias ----------

$('verZonas').addEventListener('change', (e) => capas.poner('zonas', 'visible', e.target.checked));

function actualizarSuperficies() {
  $('totalAuto').textContent = superficie.datos ? `${fmt(superficie.total(), 1)} m²` : '—';
  const lista = estancias.lista;
  $('sinEstancias').classList.toggle('oculto', lista.length > 0);
  $('tablaEstancias').classList.toggle('oculto', lista.length === 0);
  $('filasEstancias').innerHTML = lista.map((e) => `
    <tr data-id="${e.id}" class="${e.id === estancias.seleccion ? 'sel' : ''}">
      <td><input class="nombre" value="${esc(e.nombre)}" aria-label="Nombre de la estancia"></td>
      <td>${fmt(e.area, 2)} m²</td>
      <td>${fmt(e.perimetro, 2)} m</td>
      <td><input class="altura" value="${fmt(e.altura, 2)}" inputmode="decimal" aria-label="Altura de techo"
           title="${e.alturaAuto ? `Medida en el escaneo: ${fmt(e.alturaAuto, 2)} m` : 'No se pudo medir: valor general'}"></td>
      <td title="Bruto ${fmt(e.m2Paredes, 2)} m² − huecos ${fmt(e.m2Huecos || 0, 2)} m²">${fmt(e.m2ParedesNetas ?? e.m2Paredes, 2)} m²</td>
      <td>${fmt(e.mlRodapie ?? e.perimetro, 2)} m</td>
      <td><button class="borrarFila" title="Borrar estancia" aria-label="Borrar">×</button></td>
    </tr>`).join('');
  const t = lista.reduce((s, e) => ({ a: s.a + e.area, p: s.p + e.perimetro, w: s.w + (e.m2ParedesNetas ?? e.m2Paredes), r: s.r + (e.mlRodapie ?? e.perimetro) }), { a: 0, p: 0, w: 0, r: 0 });
  $('totalesEstancias').innerHTML = lista.length > 1
    ? `<tr><td>Total (${lista.length})</td><td>${fmt(t.a, 2)} m²</td><td>${fmt(t.p, 2)} m</td><td></td><td>${fmt(t.w, 2)} m²</td><td>${fmt(t.r, 2)} m</td><td></td></tr>` : '';
}

$('filasEstancias').addEventListener('change', (e) => {
  const fila = e.target.closest('tr');
  if (!fila) return;
  const id = Number(fila.dataset.id);
  if (e.target.classList.contains('nombre')) estancias.renombrar(id, e.target.value);
  if (e.target.classList.contains('altura')) {
    const v = num(e.target.value);
    if (!Number.isNaN(v)) estancias.cambiarAltura(id, v); else actualizarSuperficies();
  }
});
$('filasEstancias').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('filasEstancias').addEventListener('click', (e) => {
  const fila = e.target.closest('tr');
  if (!fila) return;
  const id = Number(fila.dataset.id);
  if (e.target.classList.contains('borrarFila')) { editor.seleccionar({ tipo: 'estancia', id }); editor.borrarSeleccion(); }
  else if (e.target.tagName !== 'INPUT') editor.seleccionar({ tipo: 'estancia', id });
});

// ---------- Presupuesto ----------

function actualizarPresupuesto() {
  if ($('obra') !== document.activeElement) $('obra').value = presupuesto.obra;
  const est = estancias.lista;
  const opcionesUnidad = (sel) => Object.entries(UNIDADES).map(([k, u]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${u.nombre}</option>`).join('');
  const opcionesSimbolo = (sel) => BIBLIOTECA.map((s) => `<option value="${s.clave}" ${s.clave === sel ? 'selected' : ''}>${s.nombre}</option>`).join('');
  $('listaPartidas').innerHTML = presupuesto.partidas.map((p) => {
    const u = UNIDADES[p.unidad] || UNIDADES.ud;
    const cant = presupuesto.medicion(p);
    const importe = cant * (p.precio || 0);
    const dec = u.corto === 'ud' || u.corto === 'PA' ? 0 : 2;
    const chips = u.porEstancia && est.length ? `<div class="chips">${est.map((e) => {
      const on = p.estancias === null || p.estancias.includes(e.id);
      return `<button class="chip" data-chip="${e.id}" aria-pressed="${on}">${esc(e.nombre)}</button>`;
    }).join('')}</div>` : (u.porEstancia ? '<p class="nota">Dibuja estancias para medir esta partida.</p>' : '');
    return `<div class="partida ${p.activa ? '' : 'inactiva'}" data-id="${p.id}">
      <div class="filaPartida">
        <input type="checkbox" data-p="activa" ${p.activa ? 'checked' : ''} title="Incluir en el presupuesto">
        <input class="nombrePartida" data-p="nombre" value="${esc(p.nombre)}">
        <button class="borrarFila" data-p="borrar" title="Quitar partida">×</button>
      </div>
      <div class="filaPartida calculo">
        <select data-p="unidad">${opcionesUnidad(p.unidad)}</select>
        ${u.conSimbolo ? `<select data-p="simbolo">${opcionesSimbolo(p.simbolo)}</select>` : ''}
      </div>
      <div class="filaPartida calculo">
        ${u.manual ? `<input class="cant" data-p="cantidad" value="${fmt(p.cantidad || (p.unidad === 'pa' ? 1 : 0), dec)}" inputmode="decimal">` : `<span class="cant">${fmt(cant, dec)}</span>`}
        <span>${u.corto} ×</span>
        <input class="precio" data-p="precio" value="${fmt(p.precio || 0, 2)}" inputmode="decimal"> <span>€</span>
        <span class="importe ${p.precio ? '' : 'sinPrecio'}">${p.precio ? fmtEur(importe) : 'sin precio'}</span>
      </div>
      ${chips}
    </div>`;
  }).join('');
  const t = presupuesto.totales();
  $('totalesPresupuesto').innerHTML = `
    <dt>Base imponible</dt><dd>${fmtEur(t.base)}</dd>
    <dt>IVA <input id="iva" value="${fmt(presupuesto.iva, 0)}" inputmode="decimal"> %</dt><dd>${fmtEur(t.iva)}</dd>
    <dt class="total">Total</dt><dd class="total">${fmtEur(t.total)}</dd>`;
}

$('obra').addEventListener('input', (e) => { presupuesto.obra = e.target.value; marcarCambio(); });
$('listaPartidas').addEventListener('change', (e) => {
  const caja = e.target.closest('.partida');
  if (!caja) return;
  const p = presupuesto.partidas.find((q) => q.id === Number(caja.dataset.id));
  const campo = e.target.dataset.p;
  if (!p || !campo) return;
  if (campo === 'activa') p.activa = e.target.checked;
  else if (campo === 'nombre') p.nombre = e.target.value.trim() || p.nombre;
  else if (campo === 'unidad') { p.unidad = e.target.value; if (p.unidad === 'pa' && !p.cantidad) p.cantidad = 1; }
  else if (campo === 'simbolo') p.simbolo = e.target.value;
  else if (campo === 'precio' || campo === 'cantidad') { const v = num(e.target.value); p[campo] = Number.isNaN(v) ? 0 : v; }
  presupuesto.cambio();
});
$('listaPartidas').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('listaPartidas').addEventListener('click', (e) => {
  const caja = e.target.closest('.partida');
  if (!caja) return;
  const p = presupuesto.partidas.find((q) => q.id === Number(caja.dataset.id));
  if (!p) return;
  if (e.target.dataset.p === 'borrar') { presupuesto.borrar(p.id); return; }
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    const id = Number(chip.dataset.chip);
    let lista = p.estancias === null ? estancias.lista.map((x) => x.id) : [...p.estancias];
    lista = lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
    p.estancias = lista.length === estancias.lista.length ? null : lista;
    presupuesto.cambio();
  }
});
$('totalesPresupuesto').addEventListener('change', (e) => {
  if (e.target.id !== 'iva') return;
  const v = num(e.target.value);
  presupuesto.iva = Number.isNaN(v) ? 0 : v;
  presupuesto.cambio();
});
$('btnAñadirPartida').addEventListener('click', () => presupuesto.añadir());
$('btnPartidasEjemplo').addEventListener('click', () => {
  if (confirm('Se sustituirán tus partidas por las de ejemplo (sin precios). ¿Continuar?')) { presupuesto.restaurarEjemplo(); presupuesto.cambio(); }
});

// ---------- Imprimir / PDF ----------

const CLAVE_EXPORTAR = 'escaner-planos:exportar';
$('btnImprimir').addEventListener('click', () => {
  editor.elegir(null);
  const d = $('dialogoExportar');
  const conReforma = hayReforma(plano);
  let pref = null;
  try { pref = JSON.parse(localStorage.getItem(CLAVE_EXPORTAR)); } catch { /* sin preferencias guardadas */ }
  $('etqActual').textContent = conReforma ? 'Estado actual' : 'Plano';
  d.querySelectorAll('[name="plano"]').forEach((c) => {
    const disponible = c.value === 'actual' || conReforma;
    c.disabled = !disponible;
    c.closest('label').classList.toggle('apagada', !disponible);
    c.checked = disponible && (pref && pref.planos ? pref.planos.includes(c.value) || (c.value === 'actual' && !pref.planos.length) : true);
  });
  d.querySelectorAll('[name="seccion"]').forEach((c) => {
    c.checked = pref && pref.secciones ? pref.secciones.includes(c.value) : true;
  });
  d.showModal();
});
$('dialogoExportar').addEventListener('close', () => {
  const d = $('dialogoExportar');
  if (d.returnValue !== 'exportar') return;
  const opciones = {
    planos: [...d.querySelectorAll('[name="plano"]:checked')].map((c) => c.value),
    secciones: [...d.querySelectorAll('[name="seccion"]:checked')].map((c) => c.value),
  };
  try { localStorage.setItem(CLAVE_EXPORTAR, JSON.stringify(opciones)); } catch { /* no pasa nada */ }
  generarInforme({ visor, plano, estancias, medicion, presupuesto, escaneo: estado.escaneo }, opciones);
});

// ---------- Guardar y cargar el trabajo ----------

$('btnGuardar').addEventListener('click', () => {
  const m = estado.escaneo;
  if (!m) return;
  const trabajo = {
    app: 'escaner-planos', version: 2, fecha: new Date().toISOString(),
    escaneo: { nombre: m.nombre, totalPuntos: m.totalPuntos, angulo: m.angulo, inclinacion: m.inclinacion },
    estancias: estancias.lista.map((e) => ({ nombre: e.nombre, altura: e.altura, puntos: e.puntos })),
    cotas: medicion.cotas,
    plano: plano.serializar(),
    presupuesto: presupuesto.serializar(),
    capas: capas.serializar(),
    zonas: superficie.datos ? superficie.datos.zonas.filter((z) => z.incluida === z.sinEscanear)
      .map((z) => ({ x: z.etiqueta.x, y: z.etiqueta.y, incluida: z.incluida })) : [],
  };
  const blob = new Blob([JSON.stringify(trabajo, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m.nombre.replace(/\.ply$/i, '') + '-trabajo.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  estado.sinGuardar = false;
});

$('archivoTrabajo').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  e.target.value = '';
  if (!archivo || !estado.escaneo) return;
  let t;
  try { t = JSON.parse(await archivo.text()); } catch { alert('El archivo no es un trabajo válido.'); return; }
  if (t.app !== 'escaner-planos') { alert('El archivo no es un trabajo de esta herramienta.'); return; }
  const m = estado.escaneo;
  const mismo = t.escaneo && t.escaneo.totalPuntos === m.totalPuntos;
  if (!mismo && !confirm(`Este trabajo se hizo con otro escaneo (${t.escaneo ? t.escaneo.nombre : '?'}). Puede no coincidir. ¿Cargarlo igualmente?`)) return;
  if (estado.sinGuardar && !confirm('Se sustituirá lo que tienes dibujado ahora. ¿Continuar?')) return;

  plano.limpiar();
  if (t.plano) plano.cargarDatos(t.plano);
  estancias.borrarTodo();
  for (const x of t.estancias || []) estancias.crear(x.puntos, x.nombre, x.altura);
  estancias.recalcularTodas();
  medicion.cotas = (t.cotas || []).map((c) => ({ ...c }));
  if (t.presupuesto) presupuesto.cargarDatos(t.presupuesto);
  if (t.capas) capas.cargarDatos(t.capas);
  if (superficie.datos) {
    for (const z of superficie.datos.zonas) z.incluida = !z.sinEscanear;
    for (const g of t.zonas || []) { const z = superficie.zonaEn(visor.aPantalla(g.x, g.y)); if (z) z.incluida = g.incluida; }
    superficie.crearImagen();
  }
  editor.seleccionar(null);
  visor.redibujar();
  actualizarTodo();
  abrirPanel('panelSuperficies');
  estado.sinGuardar = false;
});

// ---------- Otros ----------

$('btnEncajar').addEventListener('click', () => visor.encajar());
$('btnOtro').addEventListener('click', () => {
  if (estado.sinGuardar && !confirm('Se perderá lo dibujado sin guardar. ¿Abrir otro escaneo?')) return;
  $('archivo').value = '';
  mostrarCarga('zonaCarga');
});
$('reintentar').addEventListener('click', () => { $('archivo').value = ''; mostrarCarga('zonaCarga'); });
$('archivo').addEventListener('change', (e) => cargar(e.target.files[0]));

const soltarZona = $('soltar');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); soltarZona.classList.add('activo'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'drop' || e.target === document.documentElement) soltarZona.classList.remove('activo');
}));
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (f.name.toLowerCase().endsWith('.json') && estado.escaneo) {
    const dt = new DataTransfer(); dt.items.add(f);
    $('archivoTrabajo').files = dt.files;
    $('archivoTrabajo').dispatchEvent(new Event('change'));
  } else cargar(f);
});

window.addEventListener('beforeunload', (e) => { if (estado.sinGuardar) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('afterprint', () => { $('informe').innerHTML = ''; });
