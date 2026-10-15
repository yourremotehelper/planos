// Pantalla principal — cargar el escaneo y mostrarlo en el visor.

const MAX_PUNTOS = 3000000; // puntos que nos quedamos para trabajar con fluidez

const $ = (id) => document.getElementById(id);
const fmt = (n, dec = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const filasHTML = (filas) => filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

const estado = { escaneo: null };
const visor = new Visor($('lienzo'));

// ---------- Cambiar de pantalla ----------

function mostrarCarga(zona) {
  $('pantallaCarga').classList.remove('oculto');
  $('pantallaVisor').classList.add('oculto');
  $('accionesVisor').classList.add('oculto');
  $('nombreEscaneo').textContent = 'Paso 3 · Ver la planta';
  ['zonaCarga', 'zonaProgreso', 'zonaError'].forEach((z) => $(z).classList.toggle('oculto', z !== zona));
}

function mostrarVisor() {
  $('pantallaCarga').classList.add('oculto');
  $('pantallaVisor').classList.remove('oculto');
  $('accionesVisor').classList.remove('oculto');
}

// ---------- Carga ----------

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
    ['Archivo', m.nombre],
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

  // El deslizador llega hasta un poco por debajo del techo
  const deslizador = $('alturaCorte');
  deslizador.max = String(Math.max(1.5, Math.floor(((m.techo || 3) - 0.1) * 20) / 20));
  deslizador.value = '1.1';
  actualizarTextoCorte();

  mostrarVisor();
  visor.cargar(m);
  console.log('Escaneo procesado', m);
}

function mostrarError(texto) {
  $('textoError').textContent = texto;
  mostrarCarga('zonaError');
}

// ---------- Altura del corte ----------

function actualizarTextoCorte() {
  $('valorCorte').textContent = `${fmt(parseFloat($('alturaCorte').value), 2)} m`;
}
$('alturaCorte').addEventListener('input', () => {
  actualizarTextoCorte();
  visor.cambiarCorte(parseFloat($('alturaCorte').value));
});

// ---------- Escala gráfica ----------
// Elige una longitud "redonda" (0,1 · 0,2 · 0,5 · 1 · 2 · 5 · 10 m…) que ocupe unos 80–160 px
visor.alCambiarVista = (vista) => {
  const objetivo = 100 / vista.escala; // metros que ocupan ~100 px
  const pot = Math.pow(10, Math.floor(Math.log10(objetivo)));
  const largo = [1, 2, 5, 10].map((k) => k * pot).find((l) => l >= objetivo) || 10 * pot;
  $('regla').style.width = `${largo * vista.escala}px`;
  $('textoEscala').textContent = largo >= 1 ? `${fmt(largo)} m` : `${fmt(largo * 100)} cm`;
};

// ---------- Botones ----------

$('btnEncajar').addEventListener('click', () => visor.encajar());
$('btnInfo').addEventListener('click', () => {
  const panel = $('panelInfo');
  panel.classList.toggle('oculto');
  $('btnInfo').classList.toggle('activo', !panel.classList.contains('oculto'));
});
$('cerrarInfo').addEventListener('click', () => {
  $('panelInfo').classList.add('oculto');
  $('btnInfo').classList.remove('activo');
});
$('btnOtro').addEventListener('click', () => { $('archivo').value = ''; mostrarCarga('zonaCarga'); });
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
  if (e.dataTransfer.files[0]) cargar(e.dataTransfer.files[0]);
});
