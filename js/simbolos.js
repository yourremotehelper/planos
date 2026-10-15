// Biblioteca de símbolos de planta, a tamaño real (metros).
// Coordenadas locales: origen en el centro, x = ancho, y = fondo.
// La parte de atrás (la que va contra la pared) está en y = +fondo/2; el frente en y = -fondo/2.
// Cada símbolo se dibuja con líneas finas; "px" es el tamaño de un píxel en metros.

const BIBLIOTECA = [
  // ---------- Baño ----------
  { clave: 'inodoro', nombre: 'Inodoro', grupo: 'Baño', ancho: 0.37, fondo: 0.70, dibujar(c, w, f) {
    c.rect(-w / 2, f / 2 - 0.18, w, 0.18);                          // cisterna
    c.elipse(0, f / 2 - 0.18 - 0.25, w / 2 - 0.01, 0.25);           // taza
    c.elipse(0, f / 2 - 0.18 - 0.23, w / 2 - 0.06, 0.18);           // asiento interior
  } },
  { clave: 'bide', nombre: 'Bidé', grupo: 'Baño', ancho: 0.37, fondo: 0.55, dibujar(c, w, f) {
    c.rect(-w / 2 + 0.03, f / 2 - 0.08, w - 0.06, 0.08);
    c.elipse(0, f / 2 - 0.08 - 0.22, w / 2 - 0.01, 0.23);
    c.elipse(0, f / 2 - 0.08 - 0.2, w / 2 - 0.07, 0.15);
    c.circulo(0, f / 2 - 0.12, 0.015);
  } },
  { clave: 'lavabo', nombre: 'Lavabo', grupo: 'Baño', ancho: 0.60, fondo: 0.45, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.elipse(0, -0.02, w / 2 - 0.08, f / 2 - 0.1);
    c.circulo(0, f / 2 - 0.06, 0.02);
  } },
  { clave: 'mueble-lavabo', nombre: 'Mueble lavabo', grupo: 'Baño', ancho: 0.80, fondo: 0.46, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.redondeado(-0.25, -f / 2 + 0.08, 0.5, f - 0.18, 0.08);
    c.circulo(0, f / 2 - 0.06, 0.02);
  } },
  { clave: 'ducha', nombre: 'Plato de ducha', grupo: 'Baño', ancho: 0.80, fondo: 0.80, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.linea(-w / 2, -f / 2, w / 2, f / 2); c.linea(-w / 2, f / 2, w / 2, -f / 2);
    c.circulo(0, 0, 0.04);
  } },
  { clave: 'banera', nombre: 'Bañera', grupo: 'Baño', ancho: 1.70, fondo: 0.70, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.redondeado(-w / 2 + 0.06, -f / 2 + 0.06, w - 0.12, f - 0.12, 0.2);
    c.circulo(-w / 2 + 0.22, 0, 0.03);
  } },

  // ---------- Cocina ----------
  { clave: 'encimera', nombre: 'Encimera', grupo: 'Cocina', ancho: 1.20, fondo: 0.60, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.discontinua(-w / 2, -f / 2 + 0.05, w / 2, -f / 2 + 0.05);
  } },
  { clave: 'fregadero', nombre: 'Fregadero', grupo: 'Cocina', ancho: 0.80, fondo: 0.60, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.redondeado(-w / 2 + 0.05, -f / 2 + 0.07, w / 2 - 0.07, f - 0.2, 0.04);
    c.redondeado(0.02, -f / 2 + 0.07, w / 2 - 0.07, f - 0.2, 0.04);
    c.circulo(0, f / 2 - 0.07, 0.025);
  } },
  { clave: 'placa', nombre: 'Placa de cocina', grupo: 'Cocina', ancho: 0.60, fondo: 0.60, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    const r = Math.min(w, f) * 0.15;
    c.circulo(-w / 4, -f / 4, r); c.circulo(w / 4, -f / 4, r * 0.8);
    c.circulo(-w / 4, f / 4, r * 0.8); c.circulo(w / 4, f / 4, r);
  } },
  { clave: 'frigorifico', nombre: 'Frigorífico', grupo: 'Cocina', ancho: 0.60, fondo: 0.65, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f); c.linea(-w / 2, -f / 2 + 0.05, w / 2, -f / 2 + 0.05); c.texto('FR', 0, 0.03, 0.14);
  } },
  { clave: 'lavadora', nombre: 'Lavadora', grupo: 'Cocina', ancho: 0.60, fondo: 0.60, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f); c.circulo(0, 0, Math.min(w, f) * 0.3); c.texto('LV', 0, 0, 0.1);
  } },
  { clave: 'lavavajillas', nombre: 'Lavavajillas', grupo: 'Cocina', ancho: 0.60, fondo: 0.60, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f); c.linea(-w / 2, -f / 2 + 0.05, w / 2, -f / 2 + 0.05); c.texto('LVJ', 0, 0.03, 0.1);
  } },

  // ---------- Salón y comedor ----------
  { clave: 'sofa', nombre: 'Sofá', grupo: 'Salón', ancho: 2.00, fondo: 0.90, dibujar(c, w, f) {
    c.redondeado(-w / 2, -f / 2, w, f, 0.06);
    c.rect(-w / 2 + 0.18, f / 2 - 0.22, w - 0.36, 0.22);                 // respaldo
    c.rect(-w / 2, -f / 2, 0.18, f); c.rect(w / 2 - 0.18, -f / 2, 0.18, f); // brazos
    const n = Math.max(1, Math.round((w - 0.36) / 0.65));
    const anchoC = (w - 0.36) / n;
    for (let i = 1; i < n; i++) c.linea(-w / 2 + 0.18 + i * anchoC, -f / 2, -w / 2 + 0.18 + i * anchoC, f / 2 - 0.22);
  } },
  { clave: 'sillon', nombre: 'Sillón', grupo: 'Salón', ancho: 0.85, fondo: 0.85, dibujar(c, w, f) {
    c.redondeado(-w / 2, -f / 2, w, f, 0.06);
    c.rect(-w / 2 + 0.16, f / 2 - 0.2, w - 0.32, 0.2);
    c.rect(-w / 2, -f / 2, 0.16, f); c.rect(w / 2 - 0.16, -f / 2, 0.16, f);
  } },
  { clave: 'mesa', nombre: 'Mesa', grupo: 'Salón', ancho: 1.60, fondo: 0.90, dibujar(c, w, f) { c.rect(-w / 2, -f / 2, w, f); } },
  { clave: 'mesa-redonda', nombre: 'Mesa redonda', grupo: 'Salón', ancho: 1.00, fondo: 1.00, dibujar(c, w, f) { c.elipse(0, 0, w / 2, f / 2); } },
  { clave: 'silla', nombre: 'Silla', grupo: 'Salón', ancho: 0.45, fondo: 0.50, dibujar(c, w, f) {
    c.redondeado(-w / 2, -f / 2, w, f - 0.06, 0.04);
    c.rect(-w / 2, f / 2 - 0.06, w, 0.06);
  } },
  { clave: 'mueble-tv', nombre: 'Mueble TV', grupo: 'Salón', ancho: 1.60, fondo: 0.40, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.rect(-w * 0.3, f / 2 - 0.1, w * 0.6, 0.04);
  } },

  // ---------- Dormitorio ----------
  { clave: 'cama-doble', nombre: 'Cama doble', grupo: 'Dormitorio', ancho: 1.50, fondo: 2.00, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.rect(-w / 2, f / 2 - 0.06, w, 0.06);                               // cabecero
    c.redondeado(-w / 2 + 0.08, f / 2 - 0.42, w / 2 - 0.12, 0.3, 0.06);  // almohadas
    c.redondeado(0.04, f / 2 - 0.42, w / 2 - 0.12, 0.3, 0.06);
    c.linea(-w / 2, f / 2 - 0.6, w / 2, f / 2 - 0.6);                    // embozo
    c.linea(-w / 2, f / 2 - 0.6, -w / 2 + 0.3, f / 2 - 0.9);
  } },
  { clave: 'cama-individual', nombre: 'Cama individual', grupo: 'Dormitorio', ancho: 0.90, fondo: 1.90, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.rect(-w / 2, f / 2 - 0.06, w, 0.06);
    c.redondeado(-w / 2 + 0.1, f / 2 - 0.42, w - 0.2, 0.3, 0.06);
    c.linea(-w / 2, f / 2 - 0.6, w / 2, f / 2 - 0.6);
    c.linea(-w / 2, f / 2 - 0.6, -w / 2 + 0.25, f / 2 - 0.85);
  } },
  { clave: 'mesita', nombre: 'Mesita de noche', grupo: 'Dormitorio', ancho: 0.45, fondo: 0.40, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f); c.circulo(0, 0, Math.min(w, f) * 0.25);
  } },
  { clave: 'armario', nombre: 'Armario', grupo: 'Dormitorio', ancho: 1.20, fondo: 0.60, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f);
    c.discontinua(-w / 2 + 0.05, 0, w / 2 - 0.05, 0);                   // barra de colgar
    const n = Math.max(2, Math.round(w / 0.5));
    for (let i = 1; i < n; i++) c.linea(-w / 2 + (i * w) / n, -f / 2, -w / 2 + (i * w) / n, -f / 2 + 0.06); // puertas
  } },
  { clave: 'escritorio', nombre: 'Escritorio', grupo: 'Dormitorio', ancho: 1.20, fondo: 0.60, dibujar(c, w, f) {
    c.rect(-w / 2, -f / 2, w, f); c.rect(w / 2 - 0.42, -f / 2, 0.4, f - 0.02);
  } },
];

const SIMBOLOS = Object.fromEntries(BIBLIOTECA.map((s) => [s.clave, s]));

// Pinta un símbolo. ctx ya está trasladado/girado/escalado a metros (eje y hacia arriba).
function pintarSimbolo(ctx, def, ancho, fondo, px, color) {
  const c = {
    rect(x, y, w, h) { ctx.strokeRect(x, y, w, h); },
    linea(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); },
    discontinua(x0, y0, x1, y1) { ctx.save(); ctx.setLineDash([6 * px, 4 * px]); this.linea(x0, y0, x1, y1); ctx.restore(); },
    circulo(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); },
    elipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(rx, 0.001), Math.max(ry, 0.001), 0, 0, Math.PI * 2); ctx.stroke(); },
    redondeado(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); ctx.stroke(); },
    texto(t, x, y, alto) {
      ctx.save(); ctx.scale(1, -1); ctx.fillStyle = color;
      ctx.font = `600 ${alto}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t, x, -y); ctx.restore();
    },
  };
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillRect(-ancho / 2, -fondo / 2, ancho, fondo);
  def.dibujar(c, ancho, fondo);
}
