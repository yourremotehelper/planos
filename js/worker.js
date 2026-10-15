// Lectura de archivos PLY en segundo plano (Web Worker).
// Recibe: { tipo: 'cargar', archivo: File, maxPuntos: número }
// Devuelve: mensajes 'progreso', 'listo' o 'error'.

const TIPOS = {
  char: ['getInt8', 1], int8: ['getInt8', 1],
  uchar: ['getUint8', 1], uint8: ['getUint8', 1],
  short: ['getInt16', 2], int16: ['getInt16', 2],
  ushort: ['getUint16', 2], uint16: ['getUint16', 2],
  int: ['getInt32', 4], int32: ['getInt32', 4],
  uint: ['getUint32', 4], uint32: ['getUint32', 4],
  float: ['getFloat32', 4], float32: ['getFloat32', 4],
  double: ['getFloat64', 8], float64: ['getFloat64', 8],
};

importScripts('geometria.js');

self.onmessage = async (e) => {
  if (e.data.tipo !== 'cargar') return;
  try {
    const lectura = await leerPLY(e.data.archivo, e.data.maxPuntos);
    const avisar = (texto) => self.postMessage({ tipo: 'fase', texto });
    const t0 = performance.now();
    const geo = nivelarYEnderezar(lectura.xyz, lectura.min, lectura.max, avisar);
    const { xyz, ...datos } = lectura; // las coordenadas originales ya no hacen falta
    const resultado = { ...datos, ...geo, segundosProceso: (performance.now() - t0) / 1000 };
    const transferir = [geo.x.buffer, geo.y.buffer, geo.h.buffer];
    if (lectura.rgb) transferir.push(lectura.rgb.buffer);
    self.postMessage({ tipo: 'listo', ...resultado }, transferir);
  } catch (err) {
    self.postMessage({ tipo: 'error', mensaje: err.message || String(err) });
  }
};

// ---------- Cabecera ----------

async function leerCabecera(archivo) {
  const trozo = new Uint8Array(await archivo.slice(0, 65536).arrayBuffer());
  const texto = new TextDecoder('latin1').decode(trozo);
  const fin = texto.indexOf('end_header');
  if (!texto.startsWith('ply') || fin < 0) {
    throw new Error('No parece un archivo PLY válido (falta la cabecera "ply … end_header").');
  }
  // El bloque de datos empieza tras el salto de línea que sigue a end_header
  let inicioDatos = fin + 'end_header'.length;
  if (texto[inicioDatos] === '\r') inicioDatos++;
  if (texto[inicioDatos] === '\n') inicioDatos++;

  const lineas = texto.slice(0, fin).split(/\r?\n/);
  let formato = null;
  const elementos = [];
  for (const l of lineas) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'format') formato = p[1];
    else if (p[0] === 'element') elementos.push({ nombre: p[1], cantidad: parseInt(p[2], 10), props: [] });
    else if (p[0] === 'property') {
      const el = elementos[elementos.length - 1];
      if (p[1] === 'list') el.props.push({ nombre: p[4], lista: true, tipoN: p[2], tipo: p[3] });
      else el.props.push({ nombre: p[2], tipo: p[1] });
    }
  }
  return { formato, elementos, inicioDatos };
}

// ---------- Lectura principal ----------

async function leerPLY(archivo, maxPuntos) {
  const cab = await leerCabecera(archivo);
  const iVert = cab.elementos.findIndex((el) => el.nombre === 'vertex');
  if (iVert < 0) throw new Error('El archivo no contiene puntos (falta "element vertex").');
  const vert = cab.elementos[iVert];
  const total = vert.cantidad;

  const caras = cab.elementos.find((el) => el.nombre === 'face');
  if (caras && caras.cantidad > 0) {
    throw new Error('Este archivo es una malla (tiene caras). Exporta desde RayStudio la nube de puntos, no la malla.');
  }
  for (const n of ['x', 'y', 'z']) {
    if (!vert.props.some((p) => p.nombre === n)) throw new Error(`Falta la coordenada "${n}" en los puntos.`);
  }
  if (vert.props.some((p) => /^f_dc_|^scale_|^rot_|^opacity$/.test(p.nombre))) {
    throw new Error('Este archivo es de Gaussian Splatting, no sirve para medir. Exporta la nube de puntos normal.');
  }

  // Cuántos puntos nos quedamos: uno de cada "salto"
  const salto = Math.max(1, Math.ceil(total / maxPuntos));
  const nUsados = Math.ceil(total / salto);
  const xyz = new Float32Array(nUsados * 3);
  const tieneColor = ['red', 'green', 'blue'].every((c) => vert.props.some((p) => p.nombre === c));
  const rgb = tieneColor ? new Uint8Array(nUsados * 3) : null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const guardar = (k, x, y, z, r, g, b) => {
    xyz[k * 3] = x; xyz[k * 3 + 1] = y; xyz[k * 3 + 2] = z;
    if (rgb) { rgb[k * 3] = r; rgb[k * 3 + 1] = g; rgb[k * 3 + 2] = b; }
    if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
  };

  let usados;
  if (cab.formato === 'binary_little_endian' || cab.formato === 'binary_big_endian') {
    usados = await leerBinario(archivo, cab, iVert, salto, guardar);
  } else if (cab.formato === 'ascii') {
    usados = await leerAscii(archivo, cab, iVert, salto, guardar);
  } else {
    throw new Error(`Formato PLY no soportado: ${cab.formato}`);
  }

  return {
    nombre: archivo.name,
    tamanoMB: archivo.size / 1048576,
    formato: cab.formato,
    totalPuntos: total,
    puntosUsados: usados,
    salto,
    tieneColor,
    min, max,
    xyz: usados === nUsados ? xyz : xyz.slice(0, usados * 3),
    rgb: rgb ? (usados === nUsados ? rgb : rgb.slice(0, usados * 3)) : null,
  };
}

// ---------- Binario ----------

async function leerBinario(archivo, cab, iVert, salto, guardar) {
  const le = cab.formato === 'binary_little_endian';
  const vert = cab.elementos[iVert];
  if (vert.props.some((p) => p.lista)) throw new Error('Puntos con propiedades de lista: formato no soportado.');

  // Posición de cada propiedad dentro de un punto
  let paso = 0;
  const pos = {};
  for (const p of vert.props) {
    const t = TIPOS[p.tipo];
    if (!t) throw new Error(`Tipo de dato desconocido: ${p.tipo}`);
    pos[p.nombre] = { off: paso, fn: t[0] };
    paso += t[1];
  }
  // Elementos anteriores a los puntos (raro, pero posible) — solo si son de tamaño fijo
  let inicio = cab.inicioDatos;
  for (let i = 0; i < iVert; i++) {
    const el = cab.elementos[i];
    if (el.props.some((p) => p.lista)) throw new Error('Estructura PLY no soportada.');
    inicio += el.cantidad * el.props.reduce((s, p) => s + TIPOS[p.tipo][1], 0);
  }

  const total = vert.cantidad;
  const necesario = inicio + total * paso;
  if (archivo.size < necesario) throw new Error('El archivo está incompleto o dañado (es más corto de lo que indica su cabecera).');

  const PX = pos.x, PY = pos.y, PZ = pos.z, R = pos.red, G = pos.green, B = pos.blue;
  const puntosPorTrozo = Math.floor((16 * 1048576) / paso); // ~16 MB por lectura
  let k = 0;
  for (let p0 = 0; p0 < total; p0 += puntosPorTrozo) {
    const n = Math.min(puntosPorTrozo, total - p0);
    const buf = await archivo.slice(inicio + p0 * paso, inicio + (p0 + n) * paso).arrayBuffer();
    const dv = new DataView(buf);
    // primer índice de este trozo que toca guardar
    let i = (salto - (p0 % salto)) % salto;
    for (; i < n; i += salto) {
      const b = i * paso;
      guardar(
        k++,
        dv[PX.fn](b + PX.off, le), dv[PY.fn](b + PY.off, le), dv[PZ.fn](b + PZ.off, le),
        R ? dv[R.fn](b + R.off, le) : 0, G ? dv[G.fn](b + G.off, le) : 0, B ? dv[B.fn](b + B.off, le) : 0
      );
    }
    self.postMessage({ tipo: 'progreso', fraccion: (p0 + n) / total });
  }
  self.postMessage({ tipo: 'fase', texto: 'Archivo leído' });
  return k;
}

// ---------- ASCII ----------

async function leerAscii(archivo, cab, iVert, salto, guardar) {
  if (iVert !== 0) throw new Error('PLY de texto con elementos antes de los puntos: no soportado.');
  const vert = cab.elementos[iVert];
  const col = {};
  vert.props.forEach((p, i) => { col[p.nombre] = i; });
  const total = vert.cantidad;

  const lector = archivo.slice(cab.inicioDatos).stream().pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  let idx = 0, k = 0;
  while (idx < total) {
    const { value, done } = await lector.read();
    const texto = resto + (value || '');
    const lineas = texto.split('\n');
    resto = done ? '' : lineas.pop();
    for (const l of lineas) {
      if (idx >= total) break;
      if (!l.trim()) continue;
      if (idx % salto === 0) {
        const v = l.trim().split(/\s+/).map(Number);
        guardar(k++, v[col.x], v[col.y], v[col.z], v[col.red] || 0, v[col.green] || 0, v[col.blue] || 0);
      }
      idx++;
    }
    self.postMessage({ tipo: 'progreso', fraccion: idx / total });
    if (done) break;
  }
  lector.cancel();
  return k;
}
