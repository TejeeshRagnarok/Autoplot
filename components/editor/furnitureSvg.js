/**
 * Furniture symbols for a room, as SVG, chosen from the room's name. Decorative
 * only: furniture is never stored in the layout and has no effect on geometry.
 */

const MIN_ROOM_PX = 40; // below this a symbol would only clutter the room
const STROKE = '#D97706';
const FILL = '#FEF3C7';
const GREY = '#94A3B8';

const box = (x, y, w, h, fill = FILL, stroke = STROKE, extra = '') => (
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1" ${extra}/>`
);

/**
 * @param {string} name room name
 * @param {number} x room left, in drawing pixels
 * @param {number} y room top, in drawing pixels
 * @param {number} w room width, in drawing pixels
 * @param {number} h room height, in drawing pixels
 * @param {number} ft drawing pixels per foot
 * @returns {string} SVG markup, empty when no symbol fits or applies
 */
export function furnitureSvg(name, x, y, w, h, ft) {
  if (w < MIN_ROOM_PX || h < MIN_ROOM_PX) return '';
  const n = String(name || '').toLowerCase();
  const pad = 0.4 * ft;
  const right = x + w;
  const bottom = y + h;

  if (n.includes('bedroom') || n.includes('guest') || n.includes('study')) {
    const bw = Math.min(w * 0.65, 6 * ft);
    const bh = Math.min(h * 0.7, 6.5 * ft);
    const bx = right - bw - pad;
    const by = bottom - bh - pad;
    const pw = bw * 0.38;
    const ph = Math.min(bh * 0.18, 1.2 * ft);
    return `<g data-furniture="bed">${box(bx, by, bw, bh)}`
      + `${box(bx + bw * 0.08, by + bh * 0.05, pw, ph, '#FFFFFF')}${box(right - pad - bw * 0.08 - pw, by + bh * 0.05, pw, ph, '#FFFFFF')}`
      + `${box(bx, by + bh * 0.58, bw, bh * 0.42, '#FDE68A')}</g>`;
  }

  if (n.includes('kitchen')) {
    const c = Math.min(w * 0.25, 2 * ft);
    const sw = Math.min(w * 0.4, 2.5 * ft);
    const sh = Math.min(h * 0.25, 1.6 * ft);
    const sink = Math.min(w * 0.3, 1.8 * ft);
    return `<g data-furniture="kitchen">${box(right - c, y, c, h, '#F1F5F9', GREY)}${box(x, bottom - c, w, c, '#F1F5F9', GREY)}`
      + `${box(right - sw - pad, bottom - c - sh - pad, sw, sh)}${box(right - sink - pad, y + pad, sink, sink, '#CBD5E1', '#64748B')}</g>`;
  }

  if (n.includes('toilet') || n.includes('bathroom')) {
    const cw = Math.min(w * 0.38, 1.6 * ft);
    const ch = Math.min(h * 0.45, 2.2 * ft);
    const basin = Math.min(w * 0.3, 1.5 * ft);
    return `<g data-furniture="bath">${box(x + pad, y + pad, cw, ch * 0.25, '#FFFFFF', GREY)}`
      + `<ellipse cx="${x + pad + cw / 2}" cy="${y + pad + ch * 0.62}" rx="${cw * 0.38}" ry="${ch * 0.33}" fill="#FFFFFF" stroke="${GREY}" stroke-width="1"/>`
      + `${box(right - basin - pad, y + pad, basin, basin, '#FFFFFF', GREY)}</g>`;
  }

  if (n.includes('living') || n.includes('hall') || n.includes('drawing')) {
    const seat = Math.min(w * 0.22, 1.8 * ft);
    const depth = Math.min(h * 0.22, 1.8 * ft);
    const tw = Math.min(w * 0.4, 2.8 * ft);
    const th = Math.min(h * 0.3, 1.8 * ft);
    return `<g data-furniture="sofa">${box(x + pad, y + pad, seat, h * 0.5, '#E2E8F0', GREY)}`
      + `${box(x + pad + seat, y + pad, seat * 1.5, depth, '#E2E8F0', GREY)}`
      + `${box(x + pad + seat * 1.8, y + pad + depth * 1.5, tw, th)}</g>`;
  }

  if (n.includes('dining')) {
    const tw = w * 0.55;
    const th = h * 0.42;
    const tx = x + w * 0.22;
    const ty = y + h * 0.28;
    const r = Math.min(w * 0.04, 0.5 * ft);
    const chair = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#CBD5E1" stroke="#64748B" stroke-width="1"/>`;
    return `<g data-furniture="dining">${chair(tx - r - 1, ty + th * 0.3)}${chair(tx - r - 1, ty + th * 0.7)}`
      + `${chair(tx + tw + r + 1, ty + th * 0.3)}${chair(tx + tw + r + 1, ty + th * 0.7)}${box(tx, ty, tw, th)}</g>`;
  }

  if (n.includes('pooja')) {
    const size = Math.min(w * 0.4, 1.8 * ft);
    const px = right - size - pad;
    const py = y + pad;
    return `<g data-furniture="pooja">${box(px, py, size, size)}`
      + `<path d="M ${px + size / 2} ${py + size * 0.2} q ${size * 0.25} ${size * 0.3} 0 ${size * 0.6} q ${-size * 0.25} ${-size * 0.3} 0 ${-size * 0.6} z" fill="#D97706"/></g>`;
  }

  return '';
}
