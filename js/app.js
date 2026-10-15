// Pantalla principal — Paso 1: cargar el escaneo.

const MAX_PUNTOS = 3000000; // puntos que nos quedamos para trabajar con fluidez

const $ = (id) => document.getElementById(id);
const zonas = ['zonaCarga', 'zonaProgreso', 'zonaResultado', 'zonaError'];
function mostrar(zona) {
  zonas.forEach((z) => $(z).classList.toggle('oculto', z !== zona));
}

// Aquí guardaremos el escaneo cargado para los siguientes pasos
const estado = { escaneo: null };

const fmt = (n, dec = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function cargar(archivo) {
  if (!archivo) return;
  if (!archivo.name.toLowerCase().endsWith('.ply')) {
    mostrarError('El archivo debe tener extensión .ply.');
    return;
  }
  $('nombreArchivo').textContent = `Leyendo ${archivo.name}…`;
  $('progreso').style.width = '0';
  $('textoProgreso').textContent = '0 %';
  mostrar('zonaProgreso');

  const inicio = performance.now();
  const worker = new Worker('js/worker.js');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.tipo === 'progreso') {
      const pct = Math.round(m.fraccion * 100);
      $('progreso').style.width = pct + '%';
      $('textoProgreso').textContent = pct + ' %';
    } else if (m.tipo === 'listo') {
      worker.terminate();
      m.segundos = (performance.now() - inicio) / 1000;
      estado.escaneo = m;
      mostrarResultado(m);
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

function mostrarResultado(m) {
  const ancho = m.max[0] - m.min[0];
  const largo = m.max[1] - m.min[1];
  const alto = m.max[2] - m.min[2];
  const filas = [
    ['Archivo', m.nombre],
    ['Tamaño', `${fmt(m.tamanoMB, 1)} MB`],
    ['Puntos en el archivo', fmt(m.totalPuntos)],
    ['Puntos usados', `${fmt(m.puntosUsados)}${m.salto > 1 ? ` (1 de cada ${m.salto})` : ''}`],
    ['Color', m.tieneColor ? 'Sí' : 'No'],
    ['Extensión aproximada', `${fmt(ancho, 1)} × ${fmt(largo, 1)} m · ${fmt(alto, 1)} m de alto`],
    ['Tiempo de lectura', `${fmt(m.segundos, 1)} s`],
  ];
  $('datos').innerHTML = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  mostrar('zonaResultado');
  console.log('Escaneo cargado', m);
}

function mostrarError(texto) {
  $('textoError').textContent = texto;
  mostrar('zonaError');
}

// ---------- Eventos ----------

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
document.addEventListener('drop', (e) => cargar(e.dataTransfer.files[0]));

const volver = () => { $('archivo').value = ''; mostrar('zonaCarga'); };
$('otroArchivo').addEventListener('click', volver);
$('reintentar').addEventListener('click', volver);
