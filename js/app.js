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
    } else if (m.tipo === 'fase') {
      $('textoProgreso').textContent = m.texto;
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

const filasHTML = (filas) => filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

function mostrarResultado(m) {
  $('datos').innerHTML = filasHTML([
    ['Archivo', m.nombre],
    ['Tamaño', `${fmt(m.tamanoMB, 1)} MB`],
    ['Puntos en el archivo', fmt(m.totalPuntos)],
    ['Puntos usados', `${fmt(m.puntosUsados)}${m.salto > 1 ? ` (1 de cada ${m.salto})` : ''}`],
    ['Color', m.tieneColor ? 'Sí' : 'No'],
    ['Tiempo total', `${fmt(m.segundos, 1)} s`],
  ]);

  $('ajuste').innerHTML = filasHTML([
    ['Inclinación corregida', `${fmt(m.inclinacion, 2)}°`],
    ['Giro de la planta', `${fmt(m.angulo, 1)}°`],
    ['Tamaño en planta', `${fmt(m.ancho, 2)} × ${fmt(m.largo, 2)} m`],
    ['Altura del techo', m.techo ? `≈ ${fmt(m.techo, 2)} m` : 'No detectada'],
  ]);

  const aviso = $('avisoSuelo');
  if (m.coberturaSuelo < 0.25) {
    aviso.textContent = 'Se ha visto poco suelo en el escaneo. Revisa que la vista previa tenga sentido; si no, puede que haya que repetir el escaneo.';
    aviso.classList.remove('oculto');
  } else {
    aviso.classList.add('oculto');
  }

  mostrar('zonaResultado');
  dibujarVistaPrevia(m);
  console.log('Escaneo procesado', m);
}

// Dibuja los puntos entre 1,0 y 1,2 m de altura vistos desde arriba.
// Cuantos más puntos caen en un píxel, más oscuro.
function dibujarVistaPrevia(m) {
  const lienzo = $('vistaPrevia');
  const dpr = window.devicePixelRatio || 1;
  const anchoCss = lienzo.clientWidth;
  const margen = 10;
  const escala = (anchoCss - 2 * margen) / m.ancho; // píxeles CSS por metro
  const altoCss = Math.round(m.largo * escala + 2 * margen);
  lienzo.style.height = altoCss + 'px';
  const W = Math.round(anchoCss * dpr), H = Math.round(altoCss * dpr);
  lienzo.width = W; lienzo.height = H;

  const cuenta = new Uint16Array(W * H);
  const e = escala * dpr, mg = margen * dpr;
  for (let i = 0; i < m.h.length; i++) {
    if (m.h[i] < 1.0 || m.h[i] > 1.2) continue;
    const px = Math.floor(mg + m.x[i] * e);
    const py = Math.floor(H - mg - m.y[i] * e); // el eje Y del canvas va hacia abajo
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    const k = py * W + px;
    if (cuenta[k] < 65535) cuenta[k]++;
  }

  const ctx = lienzo.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let k = 0; k < cuenta.length; k++) {
    const t = Math.min(1, cuenta[k] / 4);
    const g = Math.round(255 * (1 - t));
    img.data[k * 4] = g; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = g; img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
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
