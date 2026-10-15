// Pantalla principal: carga del escaneo, herramientas, paneles y guardar/cargar trabajo.

const MAX_PUNTOS = 3000000; // puntos que nos quedamos para trabajar con fluidez

const $ = (id) => document.getElementById(id);
const fmt = (n, dec = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const filasHTML = (filas) => filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const estado = { escaneo: null, herramienta: null }; // herramienta: null | 'medir' | 'estancia'

const visor = new Visor($('lienzo'));
const iman = new Iman(visor);
const superficie = new CapaSuperficie(visor);
const estancias = new Estancias(visor, iman);
const medicion = new Medicion(visor, iman);
visor.capasEncima = [superficie, estancias, medicion]; // orden de dibujo

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
  if (!archivo.name.toLowerCase().endsWith('.ply')) {
    mostrarError('El archivo debe tener extensión .ply.');
    return;
  }
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
  worker.onerror = (e) => {
    worker.terminate();
    mostrarError('Error inesperado al leer: ' + (e.message || 'desconocido'));
  };
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
  medicion.borrarTodo();
  estancias.borrarTodo();
  elegirHerramienta(null);
  actualizarSuperficies();
  estado.sinGuardar = false;
  console.log('Escaneo procesado', m, 'superficie', superficie.datos);
}

function mostrarError(texto) {
  $('textoError').textContent = texto;
  mostrarCarga('zonaError');
}

// ---------- Altura del corte ----------

function actualizarTextoCorte() {
  $('valorCorte').value = fmt(parseFloat($('alturaCorte').value), 2);
}
$('alturaCorte').addEventListener('input', () => {
  actualizarTextoCorte();
  visor.cambiarCorte(parseFloat($('alturaCorte').value));
});

// Escribir la altura a mano: acepta "1,25" o "1.25"; se aplica con Intro o al salir del campo
function aplicarCorteEscrito() {
  const campo = $('valorCorte');
  const desliz = $('alturaCorte');
  let v = parseFloat(campo.value.replace(',', '.'));
  if (Number.isNaN(v)) { actualizarTextoCorte(); return; }
  v = Math.min(parseFloat(desliz.max), Math.max(parseFloat(desliz.min), v));
  desliz.value = String(v);
  campo.value = fmt(v, 2);
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
  const largo = [1, 2, 5, 10].map((k) => k * pot).find((l) => l >= objetivo) || 10 * pot;
  $('regla').style.width = `${largo * vista.escala}px`;
  $('textoEscala').textContent = largo >= 1 ? `${fmt(largo)} m` : `${fmt(largo * 100)} cm`;
};

// ---------- Herramientas ----------

function elegirHerramienta(h) {
  estado.herramienta = h;
  medicion.activar(h === 'medir');
  estancias.activar(h === 'estancia');
  visor.bloquearDobleClic = !!h;
  visor.lienzo.classList.toggle('modoMedir', !!h);
  actualizarHerramientas();
}

function actualizarHerramientas() {
  const h = estado.herramienta;
  $('btnMedir').setAttribute('aria-pressed', String(h === 'medir'));
  $('btnEstancia').setAttribute('aria-pressed', String(h === 'estancia'));
  $('btnIman').setAttribute('aria-pressed', String(iman.activo));
  $('grupoCotas').classList.toggle('oculto', h !== 'medir' || (medicion.cotas.length === 0 && !medicion.primero));
  $('grupoEstancia').classList.toggle('oculto', h !== 'estancia' || estancias.puntos.length === 0);
  $('btnCerrarEstancia').disabled = estancias.puntos.length < 3;

  const pista = $('pista');
  let texto = '';
  if (h === 'medir') {
    texto = medicion.primero ? 'Pincha en el segundo punto · Esc para cancelar' : 'Pincha en el primer punto · arrastra para moverte';
  } else if (h === 'estancia') {
    const n = estancias.puntos.length;
    texto = n === 0 ? 'Pincha en una esquina de la estancia'
      : n < 3 ? 'Sigue pinchando en las esquinas'
      : 'Sigue, o pincha en el primer punto (o Intro) para cerrar';
  }
  pista.textContent = texto;
  pista.classList.toggle('oculto', !texto);
}

medicion.alCambiar = () => { estado.sinGuardar = true; actualizarHerramientas(); };
estancias.alCambiar = () => { estado.sinGuardar = true; actualizarHerramientas(); actualizarSuperficies(); };
superficie.alCambiar = () => { estado.sinGuardar = true; actualizarSuperficies(); };

$('btnMedir').addEventListener('click', () => elegirHerramienta(estado.herramienta === 'medir' ? null : 'medir'));
$('btnEstancia').addEventListener('click', () => elegirHerramienta(estado.herramienta === 'estancia' ? null : 'estancia'));
$('btnIman').addEventListener('click', () => {
  iman.activo = !iman.activo;
  medicion.cursor = null; estancias.cursor = null;
  visor.redibujar();
  actualizarHerramientas();
});
$('btnDeshacer').addEventListener('click', () => medicion.deshacer());
$('btnBorrarCotas').addEventListener('click', () => {
  if (medicion.cotas.length <= 1 || confirm(`¿Borrar las ${medicion.cotas.length} cotas?`)) medicion.borrarTodo();
});
$('btnCerrarEstancia').addEventListener('click', () => estancias.cerrar());
$('btnDeshacerPunto').addEventListener('click', () => estancias.deshacerPunto());
$('btnCancelarEstancia').addEventListener('click', () => estancias.cancelar());

// Clics y movimiento sobre la planta: van a la herramienta activa
visor.alHacerClic = (p, e) => {
  if (estado.herramienta === 'medir') return medicion.clic(p, e);
  if (estado.herramienta === 'estancia') return estancias.clic(p, e);
  // Sin herramienta: seleccionar estancia, o (con zonas visibles) incluir/excluir zona
  const est = estancias.estanciaEn(p);
  if (est) { estancias.seleccionar(est.id); abrirPanel('panelSuperficies'); return; }
  estancias.seleccionar(null);
  if (superficie.visible) {
    const z = superficie.zonaEn(p);
    if (z) superficie.alternar(z);
  }
};
visor.alMoverCursor = (p, e) => {
  if (estado.herramienta === 'medir') medicion.mover(p, e);
  else if (estado.herramienta === 'estancia') estancias.mover(p, e);
};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || $('pantallaVisor').classList.contains('oculto')) return;
  const h = estado.herramienta;
  const deshacer = (e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey);
  if (e.key === 'Escape') {
    if (h === 'medir' && medicion.primero) medicion.cancelar();
    else if (h === 'estancia' && estancias.puntos.length) estancias.cancelar();
    else elegirHerramienta(null);
  } else if (e.key === 'Enter' && h === 'estancia') {
    estancias.cerrar();
  } else if (deshacer || (e.key === 'Backspace' && h)) {
    e.preventDefault();
    if (h === 'estancia') estancias.deshacerPunto(); else if (h === 'medir') medicion.deshacer();
  } else if ((e.key === 'Delete' || e.key === 'Supr') && !h && estancias.seleccion) {
    const est = estancias.lista.find((q) => q.id === estancias.seleccion);
    if (est && confirm(`¿Borrar la estancia "${est.nombre}"?`)) estancias.borrar(est.id);
  }
});

// ---------- Paneles laterales ----------

function abrirPanel(id) {
  for (const p of ['panelInfo', 'panelSuperficies']) $(p).classList.toggle('oculto', p !== id);
  $('btnInfo').classList.toggle('activo', id === 'panelInfo');
  $('btnSuperficies').classList.toggle('activo', id === 'panelSuperficies');
}
function alternarPanel(id) { abrirPanel($(id).classList.contains('oculto') ? id : null); }

$('btnInfo').addEventListener('click', () => alternarPanel('panelInfo'));
$('btnSuperficies').addEventListener('click', () => alternarPanel('panelSuperficies'));
document.querySelectorAll('[data-cierra]').forEach((b) => b.addEventListener('click', () => abrirPanel(null)));

$('verZonas').addEventListener('change', (e) => {
  superficie.visible = e.target.checked;
  visor.redibujar();
});

function actualizarSuperficies() {
  // Superficie automática
  $('totalAuto').textContent = superficie.datos ? `${fmt(superficie.total(), 1)} m²` : '—';

  // Tabla de estancias
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
      <td>${fmt(e.m2Paredes, 2)} m²</td>
      <td><button class="borrarFila" title="Borrar estancia" aria-label="Borrar">×</button></td>
    </tr>`).join('');
  const t = estancias.totales();
  $('totalesEstancias').innerHTML = lista.length > 1
    ? `<tr><td>Total (${lista.length})</td><td>${fmt(t.area, 2)} m²</td><td>${fmt(t.perimetro, 2)} m</td><td></td><td>${fmt(t.m2Paredes, 2)} m²</td><td></td></tr>`
    : '';
}

// Edición en la tabla (delegada)
$('filasEstancias').addEventListener('change', (e) => {
  const fila = e.target.closest('tr');
  if (!fila) return;
  const id = Number(fila.dataset.id);
  if (e.target.classList.contains('nombre')) estancias.renombrar(id, e.target.value);
  if (e.target.classList.contains('altura')) {
    const v = parseFloat(e.target.value.replace(',', '.'));
    if (!Number.isNaN(v)) estancias.cambiarAltura(id, v); else actualizarSuperficies();
  }
});
$('filasEstancias').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('filasEstancias').addEventListener('click', (e) => {
  const fila = e.target.closest('tr');
  if (!fila) return;
  const id = Number(fila.dataset.id);
  if (e.target.classList.contains('borrarFila')) {
    const est = estancias.lista.find((q) => q.id === id);
    if (est && confirm(`¿Borrar la estancia "${est.nombre}"?`)) estancias.borrar(id);
  } else if (e.target.tagName !== 'INPUT') {
    estancias.seleccionar(id);
  }
});
$('filasEstancias').addEventListener('focusin', (e) => {
  const fila = e.target.closest('tr');
  if (fila && Number(fila.dataset.id) !== estancias.seleccion) {
    estancias.seleccion = Number(fila.dataset.id);
    visor.redibujar();
    document.querySelectorAll('#filasEstancias tr').forEach((r) => r.classList.toggle('sel', r === fila));
  }
});

// ---------- Guardar y cargar el trabajo ----------
// El trabajo se guarda en un archivo .json pequeño. Para seguir otro día:
// se abre el mismo .ply y se carga el .json.

$('btnGuardar').addEventListener('click', () => {
  const m = estado.escaneo;
  if (!m) return;
  const trabajo = {
    app: 'escaner-planos', version: 1, fecha: new Date().toISOString(),
    escaneo: { nombre: m.nombre, totalPuntos: m.totalPuntos, angulo: m.angulo, inclinacion: m.inclinacion },
    estancias: estancias.lista.map((e) => ({ nombre: e.nombre, altura: e.altura, puntos: e.puntos })),
    cotas: medicion.cotas,
    zonas: superficie.datos ? superficie.datos.zonas
      .filter((z) => z.incluida === z.sinEscanear) // solo las cambiadas a mano
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
  if (!mismo && !confirm(`Este trabajo se hizo con otro escaneo (${t.escaneo ? t.escaneo.nombre : '?'}). Las estancias pueden no coincidir. ¿Cargarlo igualmente?`)) return;
  if ((estancias.lista.length || medicion.cotas.length) && !confirm('Se sustituirán las estancias y cotas actuales. ¿Continuar?')) return;

  estancias.borrarTodo();
  for (const e of t.estancias || []) estancias.crear(e.puntos, e.nombre, e.altura);
  medicion.cotas = (t.cotas || []).map((c) => ({ ...c }));
  if (superficie.datos) {
    for (const z of superficie.datos.zonas) z.incluida = !z.sinEscanear;
    for (const g of t.zonas || []) {
      const p = visor.aPantalla(g.x, g.y);
      const z = superficie.zonaEn(p);
      if (z) z.incluida = g.incluida;
    }
    superficie.crearImagen();
  }
  visor.redibujar();
  actualizarSuperficies();
  actualizarHerramientas();
  abrirPanel('panelSuperficies');
  estado.sinGuardar = false;
});

// ---------- Otros botones ----------

$('btnEncajar').addEventListener('click', () => visor.encajar());
$('btnOtro').addEventListener('click', () => {
  if (estado.sinGuardar && !confirm('Se perderán las estancias y cotas no guardadas. ¿Abrir otro escaneo?')) return;
  $('archivo').value = '';
  mostrarCarga('zonaCarga');
});
$('reintentar').addEventListener('click', () => { $('archivo').value = ''; mostrarCarga('zonaCarga'); });

// ---------- Elegir o arrastrar archivo ----------

$('archivo').addEventListener('change', (e) => cargar(e.target.files[0]));

const soltar = $('soltar');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  soltar.classList.add('activo');
}));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'drop' || e.target === document.documentElement) soltar.classList.remove('activo');
}));
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (f.name.toLowerCase().endsWith('.json') && estado.escaneo) {
    const dt = new DataTransfer(); dt.items.add(f);
    $('archivoTrabajo').files = dt.files;
    $('archivoTrabajo').dispatchEvent(new Event('change'));
  } else {
    cargar(f);
  }
});

// Aviso al cerrar la pestaña con trabajo sin guardar
window.addEventListener('beforeunload', (e) => {
  if (estado.sinGuardar) { e.preventDefault(); e.returnValue = ''; }
});
