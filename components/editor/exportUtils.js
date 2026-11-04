/**
 * AutoPlot Architectural Plan Export Utilities
 * Generates:
 * - High-Resolution Architectural PNG with Title Block & North Arrow
 * - Clean Scalable Vector Graphics (SVG)
 * - Browser Print Window trigger
 */

import { formatMeasurement, formatArea } from './units.js';
import { calculateStaircaseGeometry } from './staircaseGeometry.js';
import { getOpeningGeometry, getWallShape } from './wallOps.js';
import { arcSweep, pointAtAngle } from './cadGeometry.js';
import { dimensionLine } from './selectionModel.js';
import { isPlotDimension } from './cadCommands.js';
import { getPlotRect, getPlotWallPolygons, getRoadBands } from './siteGeometry.js';
import { getStaircaseBounds } from './staircaseGeometry.js';
import { entityBounds } from './cadGeometry.js';
import { getPlotDimensionMeta } from './layoutModel.js';
import { buildJpegPdf } from './pdfWriter.js';
import { furnitureSvg } from './furnitureSvg.js';

/** Layers of the 2D Plan drawing. Pass with any grid, label, or path toggles applied. */
export const PLAN_VIEW = { showGrid: true, showLabels: true, showFurniture: true, showCirculation: false, showSite: true, showRoad: true };

/** Layers of the Edit Layout drawing, so its exports match the editor. */
export const EDITOR_VIEW = { showRoad: true };

const xmlText = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PX_PER_FT = 20;
// At 1:50 one real foot is 6.096 mm on paper, so one drawing pixel (1/20 ft) is
// 0.3048 mm = 0.864 pt. Pages sized this way make the "SCALE: 1:50" label true.
const PT_PER_PX = 0.864;
const PDF_DPI = 300;
const MAX_CANVAS_SIDE = 8000;
const MAX_CANVAS_AREA = 40e6;

/** A safe file name from the title: letters and digits in any language, joined by hyphens. */
export const fileBaseName = (layout) => (layout.title || 'autoplot-plan')
  .toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '') || 'autoplot-plan';

/** World box holding the plot and everything drawn, so an export never cuts anything off. */
function getDrawingBounds(layout) {
  const site = getPlotRect(layout);
  let minX = site.x0;
  let minY = site.y0;
  let maxX = site.x1;
  let maxY = site.y1;
  const grow = (x0, y0, x1, y1) => {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  const rect = (r) => grow(r.x, r.y, r.x + r.width, r.y + r.length);

  (layout.rooms || []).forEach(rect);
  (layout.parking || []).forEach(rect);
  (layout.utilities || []).forEach(rect);
  (layout.staircases || []).forEach((s) => rect(getStaircaseBounds(s)));
  (layout.walls || []).forEach((w) => {
    const half = (Number(w.thickness) || 0) / 2;
    grow(Math.min(w.x1, w.x2) - half, Math.min(w.y1, w.y2) - half, Math.max(w.x1, w.x2) + half, Math.max(w.y1, w.y2) + half);
  });
  [...(layout.doors || []), ...(layout.windows || [])].forEach((o) => {
    const reach = Number(o.width) || 0;
    grow(o.x - reach, o.y - reach, o.x + reach, o.y + reach);
  });
  (layout.columns || []).forEach((c) => {
    const half = (Number(c.size) || 0.75) / 2;
    grow(c.x - half, c.y - half, c.x + half, c.y + half);
  });
  (layout.annotations || []).forEach((a) => grow(a.x, a.y - 1, a.x + String(a.text || '').length * 0.5, a.y + 0.5));
  (layout.cadEntities || []).forEach((e) => {
    const b = entityBounds(e);
    grow(b.minX, b.minY, b.maxX, b.maxY);
  });
  (layout.dimensions || []).filter((d) => !isPlotDimension(d.id)).forEach((d) => {
    const l = dimensionLine(d);
    grow(Math.min(d.x1, d.x2, l.x1, l.x2), Math.min(d.y1, d.y2, l.y1, l.y2), Math.max(d.x1, d.x2, l.x1, l.x2), Math.max(d.y1, d.y2, l.y1, l.y2));
  });
  return { minX, minY, maxX, maxY };
}

/**
 * Generate full SVG string for the entire layout
 * @param {object} layout
 * @param {string} unit
 * @param {object} [view] layers to draw; see PLAN_VIEW
 * @returns {string} SVG xml content
 */
export function generateLayoutSVG(layout, unit = 'ft-in', view = {}) {
  if (!layout) return '';
  const { showGrid = true, showLabels = true, showFurniture = false, showCirculation = false, showSite = false, showRoad = false } = view;

  const site = getPlotRect(layout);
  const plotW = site.width;
  const plotL = site.length;
  const scale = PX_PER_FT;
  const padding = 100;

  const svgW = plotW * scale + padding * 2;
  const svgH = plotL * scale + padding * 2 + 80; // Extra room for title block

  // The plot's corner sits at (padding, padding); world (0, 0) is offset from it
  // when the west or north edge has moved.
  const plotLeft = padding;
  const plotTop = padding;
  const originX = plotLeft - site.x0 * scale;
  const originY = plotTop - site.y0 * scale;

  let elementsSvg = '';

  // 1. Grid
  if (showGrid) {
    elementsSvg += `<g data-layer="grid" opacity="0.15">`;
    for (let x = 0; x <= plotW; x += 2) {
      elementsSvg += `<line x1="${plotLeft + x * scale}" y1="${plotTop}" x2="${plotLeft + x * scale}" y2="${plotTop + plotL * scale}" stroke="#64748B" stroke-width="0.5"/>`;
    }
    for (let y = 0; y <= plotL; y += 2) {
      elementsSvg += `<line x1="${plotLeft}" y1="${plotTop + y * scale}" x2="${plotLeft + plotW * scale}" y2="${plotTop + y * scale}" stroke="#64748B" stroke-width="0.5"/>`;
    }
    elementsSvg += `</g>`;
  }

  // 2. Plot boundary
  elementsSvg += `
    <rect x="${plotLeft}" y="${plotTop}" width="${plotW * scale}" height="${plotL * scale}"
      fill="none" stroke="#D97706" stroke-width="3" stroke-dasharray="6,4"/>
  `;

  // 2a. Plot boundary walls
  Object.entries(getPlotWallPolygons(layout)).forEach(([side, polygon]) => {
    const points = polygon.map((p) => `${originX + p.x * scale},${originY + p.y * scale}`).join(' ');
    elementsSvg += `<polygon data-plot-wall="${side}" points="${points}" fill="#64748B"/>`;
  });

  // 2b. Setback line (buildable area)
  const sb = layout.plot?.setbacks || {};
  const bx0 = Number(sb.west) || 0;
  const by0 = Number(sb.north) || 0;
  const bw = plotW - bx0 - (Number(sb.east) || 0);
  const bl = plotL - by0 - (Number(sb.south) || 0);
  if (bw > 0 && bl > 0) {
    elementsSvg += `<rect x="${plotLeft + bx0 * scale}" y="${plotTop + by0 * scale}" width="${bw * scale}" height="${bl * scale}" fill="none" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3,3"/>`;
  }

  // 2c. Vastu quadrant labels, as on the canvas
  const plotRight = plotLeft + plotW * scale;
  const plotBottom = plotTop + plotL * scale;
  elementsSvg += `<g font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#B45309">
    <text x="${plotLeft + 16}" y="${plotTop + 24}">NW</text>
    <text x="${plotRight - 32}" y="${plotTop + 24}">NE</text>
    <text x="${plotLeft + 16}" y="${plotBottom - 16}">SW</text>
    <text x="${plotRight - 32}" y="${plotBottom - 16}">SE</text>
  </g>`;

  // 3. Rooms
  (layout.rooms || []).forEach(room => {
    const rx = originX + room.x * scale;
    const ry = originY + room.y * scale;
    const rw = room.width * scale;
    const rh = room.length * scale;
    const area = room.width * room.length;

    // A white outline keeps labels readable where they cross furniture.
    const halo = showFurniture ? 'paint-order="stroke" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"' : '';
    const labels = !showLabels ? '' : `
        <text x="${rx + rw / 2}" y="${ry + rh / 2 - 8}" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#1E293B" text-anchor="middle" ${halo}>
          ${xmlText(room.name || 'Room')}
        </text>
        <text x="${rx + rw / 2}" y="${ry + rh / 2 + 8}" font-family="Arial, sans-serif" font-size="10" fill="#64748B" text-anchor="middle" ${halo}>
          ${formatMeasurement(room.width, unit)} × ${formatMeasurement(room.length, unit)}
        </text>
        <text x="${rx + rw / 2}" y="${ry + rh / 2 + 22}" font-family="Arial, sans-serif" font-size="9" font-weight="600" fill="#0284C7" text-anchor="middle" ${halo}>
          ${formatArea(area, unit)}
        </text>`;
    elementsSvg += `
      <g>
        <rect data-room-id="${xmlText(room.id)}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${room.color || '#F8FAFC'}" stroke="#CBD5E1" stroke-width="1"/>
        ${showFurniture ? furnitureSvg(room.name, rx, ry, rw, rh, scale) : ''}
        ${labels}
      </g>
    `;
  });

  // 4. Utilities, Parking & Stairs
  (layout.parking || []).forEach(p => {
    elementsSvg += `
      <g>
        <rect x="${originX + p.x * scale}" y="${originY + p.y * scale}" width="${p.width * scale}" height="${p.length * scale}" 
          fill="#F1F5F9" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="4,3"/>
        <text x="${originX + (p.x + p.width / 2) * scale}" y="${originY + (p.y + p.length / 2) * scale}" 
          font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#64748B" text-anchor="middle">
          ${xmlText(p.label || 'PARKING')}
        </text>
      </g>
    `;
  });

  (layout.utilities || []).forEach(u => {
    elementsSvg += `
      <g>
        <rect x="${originX + u.x * scale}" y="${originY + u.y * scale}" width="${u.width * scale}" height="${u.length * scale}" 
          fill="#E0F2FE" stroke="#0284C7" stroke-width="1.5"/>
        <text x="${originX + (u.x + u.width / 2) * scale}" y="${originY + (u.y + u.length / 2) * scale + 4}" 
          font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#0369A1" text-anchor="middle">
          ${xmlText(u.name || 'Utility')}
        </text>
      </g>
    `;
  });

  (layout.staircases || []).forEach(s => {
    // Steps are regenerated from the staircase parameters, exactly as on the canvas.
    const geo = calculateStaircaseGeometry(s);
    const X = (x) => originX + x * scale;
    const Y = (y) => originY + y * scale;
    const pts = (poly) => poly.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
    const ln = (l, stroke, w) => `<line x1="${X(l.x1)}" y1="${Y(l.y1)}" x2="${X(l.x2)}" y2="${Y(l.y2)}" stroke="${stroke}" stroke-width="${w}"/>`;
    elementsSvg += `<g><polygon points="${pts(geo.outline)}" fill="#F8FAFC" stroke="#475569" stroke-width="1.5"/>`;
    geo.landings.forEach((l) => { elementsSvg += `<polygon points="${pts(l.polygon)}" fill="#EEF2F7" stroke="#64748B" stroke-width="1"/>`; });
    geo.flights.forEach((f) => {
      elementsSvg += `<polygon points="${pts(f.polygon)}" fill="none" stroke="#64748B" stroke-width="1"/>`;
      f.treads.forEach((t) => { elementsSvg += ln(t, '#94A3B8', 1); });
    });
    geo.dividers.forEach((d) => { elementsSvg += ln(d, '#334155', 1.5); });
    elementsSvg += `<polyline points="${pts(geo.arrow.points)}" fill="none" stroke="#0F172A" stroke-width="1.2"/>`;
    elementsSvg += `<polyline points="${pts(geo.arrow.arrowHead)}" fill="none" stroke="#0F172A" stroke-width="1.2"/>`;
    elementsSvg += `
        <text x="${X(geo.labelPos.x)}" y="${Y(geo.labelPos.y) + 3}" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#0F172A" text-anchor="middle">
          ${xmlText(s.label || 'STAIRS')} ${geo.labelText} (${geo.metrics.totalRisers}R / ${geo.metrics.totalTreads}T)
        </text>
      </g>
    `;
  });

  // 5. Walls
  (layout.walls || []).forEach(w => {
    const { polygon, joints } = getWallShape(w, layout.walls);
    const points = polygon.map((p) => `${originX + p.x * scale},${originY + p.y * scale}`).join(' ');
    elementsSvg += `<polygon points="${points}" fill="#0F172A" stroke="#0F172A" stroke-width="0.5"/>`;
    joints.forEach((j) => {
      elementsSvg += `<circle cx="${originX + j.x * scale}" cy="${originY + j.y * scale}" r="${j.r * scale}" fill="#0F172A"/>`;
    });
  });

  // 6. Doors & Windows (same geometry as the canvas: on the host wall, with hinge and swing)
  const SX = (x) => originX + x * scale;
  const SY = (y) => originY + y * scale;
  (layout.doors || []).forEach(d => {
    const g = getOpeningGeometry(d, layout.walls);
    const gap = Math.max(2, g.thickness * scale) + 1;
    elementsSvg += `<g><line x1="${SX(g.a.x)}" y1="${SY(g.a.y)}" x2="${SX(g.b.x)}" y2="${SY(g.b.y)}" stroke="#FFFFFF" stroke-width="${gap}"/>`;
    g.leaves.forEach((leaf) => {
      const r = leaf.radius * scale;
      const cross = (leaf.tip.x - leaf.hinge.x) * (leaf.free.y - leaf.hinge.y) - (leaf.tip.y - leaf.hinge.y) * (leaf.free.x - leaf.hinge.x);
      elementsSvg += `<line x1="${SX(leaf.hinge.x)}" y1="${SY(leaf.hinge.y)}" x2="${SX(leaf.tip.x)}" y2="${SY(leaf.tip.y)}" stroke="#B45309" stroke-width="2"/>`;
      elementsSvg += `<path d="M ${SX(leaf.tip.x)} ${SY(leaf.tip.y)} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${SX(leaf.free.x)} ${SY(leaf.free.y)}" fill="none" stroke="#B45309" stroke-width="1.2" stroke-dasharray="3,3"/>`;
    });
    if (d.type === 'sliding') {
      elementsSvg += `<line x1="${SX(g.a.x)}" y1="${SY(g.a.y)}" x2="${SX(g.b.x)}" y2="${SY(g.b.y)}" stroke="#B45309" stroke-width="2"/>`;
    }
    elementsSvg += '</g>';
  });

  (layout.windows || []).forEach(win => {
    const g = getOpeningGeometry(win, layout.walls);
    const h = Math.max(1.5, (g.thickness * scale) / 2);
    const ax = SX(g.a.x); const ay = SY(g.a.y); const bx = SX(g.b.x); const by = SY(g.b.y);
    const nx = g.nx * h; const ny = g.ny * h;
    elementsSvg += `
      <g>
        <polygon points="${ax + nx},${ay + ny} ${bx + nx},${by + ny} ${bx - nx},${by - ny} ${ax - nx},${ay - ny}" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.5"/>
        <text x="${SX(win.x)}" y="${SY(win.y) + 3}" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="#0369A1" text-anchor="middle">
          ${win.isBathroom || win.type === 'ventilator' ? 'V' : 'W'}
        </text>
      </g>
    `;
  });

  // 6b. Columns, CAD entities, user dimensions and text
  (layout.columns || []).forEach((c) => {
    const size = (c.size || 0.75) * scale;
    elementsSvg += c.shape === 'round'
      ? `<circle cx="${SX(c.x)}" cy="${SY(c.y)}" r="${size / 2}" fill="#475569"/>`
      : `<rect x="${SX(c.x) - size / 2}" y="${SY(c.y) - size / 2}" width="${size}" height="${size}" fill="#475569"/>`;
  });
  (layout.cadEntities || []).forEach((ent) => {
    const stroke = `fill="none" stroke="${ent.color || '#0F172A'}" stroke-width="1.5"`;
    if (ent.kind === 'line') {
      elementsSvg += `<line x1="${SX(ent.x1)}" y1="${SY(ent.y1)}" x2="${SX(ent.x2)}" y2="${SY(ent.y2)}" ${stroke}/>`;
    } else if (ent.points) {
      const pts = ent.points.map((p) => `${SX(p.x)},${SY(p.y)}`).join(' ');
      elementsSvg += ent.closed ? `<polygon points="${pts}" ${stroke}/>` : `<polyline points="${pts}" ${stroke}/>`;
    } else if (ent.kind === 'circle') {
      elementsSvg += `<circle cx="${SX(ent.cx)}" cy="${SY(ent.cy)}" r="${ent.r * scale}" ${stroke}/>`;
    } else {
      const a = pointAtAngle(ent, ent.start);
      const b = pointAtAngle(ent, ent.end);
      const r = ent.r * scale;
      elementsSvg += `<path d="M ${SX(a.x)} ${SY(a.y)} A ${r} ${r} 0 ${arcSweep(ent) > 180 ? 1 : 0} 1 ${SX(b.x)} ${SY(b.y)}" ${stroke}/>`;
    }
  });
  (layout.dimensions || []).filter((d) => !isPlotDimension(d.id)).forEach((d) => {
    const l = dimensionLine(d);
    const text = formatMeasurement(Math.hypot(d.x2 - d.x1, d.y2 - d.y1), unit);
    elementsSvg += `<line x1="${SX(d.x1)}" y1="${SY(d.y1)}" x2="${SX(l.x1)}" y2="${SY(l.y1)}" stroke="#B45309" stroke-width="0.8"/>`;
    elementsSvg += `<line x1="${SX(d.x2)}" y1="${SY(d.y2)}" x2="${SX(l.x2)}" y2="${SY(l.y2)}" stroke="#B45309" stroke-width="0.8"/>`;
    elementsSvg += `<line x1="${SX(l.x1)}" y1="${SY(l.y1)}" x2="${SX(l.x2)}" y2="${SY(l.y2)}" stroke="#B45309" stroke-width="1.2"/>`;
    elementsSvg += `<text x="${(SX(l.x1) + SX(l.x2)) / 2}" y="${(SY(l.y1) + SY(l.y2)) / 2 - 5}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#B45309" text-anchor="middle">${xmlText(text)}</text>`;
  });
  (layout.annotations || []).forEach((a) => {
    elementsSvg += `<text x="${SX(a.x)}" y="${SY(a.y)}" font-family="Arial, sans-serif" font-size="${a.fontSize || 12}" fill="${a.color || '#334155'}">${xmlText(a.text)}</text>`;
  });

  // 6c. Outer plot dimensions, as on the canvas
  const dimColor = '#B45309';
  const dimLabel = (x, y, text) => `
    <rect x="${x - 34}" y="${y - 10}" width="68" height="20" rx="3" fill="#FFFFFF" stroke="${dimColor}" stroke-width="1.2"/>
    <text x="${x}" y="${y + 4}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="${dimColor}" text-anchor="middle">${xmlText(text)}</text>`;
  const widthY = plotTop - getPlotDimensionMeta(layout, 'width').offset * scale;
  const lengthX = plotLeft - getPlotDimensionMeta(layout, 'length').offset * scale;
  elementsSvg += `<g data-plot-dimensions="true" stroke="${dimColor}" stroke-width="1.4">
    <line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${widthY - 12}" stroke-width="1" stroke-dasharray="3,2"/>
    <line x1="${plotRight}" y1="${plotTop}" x2="${plotRight}" y2="${widthY - 12}" stroke-width="1" stroke-dasharray="3,2"/>
    <line x1="${plotLeft}" y1="${widthY}" x2="${plotRight}" y2="${widthY}"/>
    <polygon points="${plotLeft},${widthY} ${plotLeft + 11},${widthY - 4} ${plotLeft + 11},${widthY + 4}" fill="${dimColor}" stroke="none"/>
    <polygon points="${plotRight},${widthY} ${plotRight - 11},${widthY - 4} ${plotRight - 11},${widthY + 4}" fill="${dimColor}" stroke="none"/>
    <line x1="${plotLeft}" y1="${plotTop}" x2="${lengthX - 12}" y2="${plotTop}" stroke-width="1" stroke-dasharray="3,2"/>
    <line x1="${plotLeft}" y1="${plotBottom}" x2="${lengthX - 12}" y2="${plotBottom}" stroke-width="1" stroke-dasharray="3,2"/>
    <line x1="${lengthX}" y1="${plotTop}" x2="${lengthX}" y2="${plotBottom}"/>
    <polygon points="${lengthX},${plotTop} ${lengthX - 4},${plotTop + 11} ${lengthX + 4},${plotTop + 11}" fill="${dimColor}" stroke="none"/>
    <polygon points="${lengthX},${plotBottom} ${lengthX - 4},${plotBottom - 11} ${lengthX + 4},${plotBottom - 11}" fill="${dimColor}" stroke="none"/>
  </g>
  <g>${dimLabel((plotLeft + plotRight) / 2, widthY, formatMeasurement(plotW, unit))}${dimLabel(lengthX, (plotTop + plotBottom) / 2, formatMeasurement(plotL, unit))}</g>`;

  // 6d. Plan view only: walking paths, road, main gate, open space around the building
  const mainDoor = (layout.doors || []).find((d) => d.isMain);
  if (showCirculation && mainDoor) {
    const hall = (layout.rooms || []).find((r) => /living|hall/i.test(r.name || ''));
    if (hall) {
      const hx = SX(hall.x + hall.width / 2);
      const hy = SY(hall.y + hall.length / 2);
      const path = (d) => `<line x1="${hx}" y1="${hy}" x2="${SX(d.x)}" y2="${SY(d.y)}" stroke="#10B981" stroke-width="1.5" stroke-dasharray="4,3"/><circle cx="${SX(d.x)}" cy="${SY(d.y)}" r="3" fill="#10B981"/>`;
      elementsSvg += `<g data-layer="circulation">${(layout.doors || []).map(path).join('')}<circle cx="${hx}" cy="${hy}" r="3" fill="#10B981"/></g>`;
    }
  }

  const roads = showRoad ? getRoadBands(layout) : [];
  roads.forEach((r) => {
    const x = SX(r.x);
    const y = SY(r.y);
    const w = r.width * scale;
    const h = r.length * scale;
    const cx = x + w / 2;
    const cy = y + h / 2;
    elementsSvg += `<g data-layer="road" data-road="${r.side}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#E2E8F0" stroke="#94A3B8" stroke-width="1"/>
        <text x="${cx}" y="${cy + 3}" transform="${h > w ? `rotate(90 ${cx} ${cy})` : ''}" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#475569" text-anchor="middle">${r.side.toUpperCase()} ROADWAY</text></g>`;
  });

  if (showSite) {
    if (mainDoor) {
      const g = getOpeningGeometry(mainDoor, layout.walls);
      const cx = site.x0 + plotW / 2;
      const cy = site.y0 + plotL / 2;
      const away = (mainDoor.x - cx) * g.nx + (mainDoor.y - cy) * g.ny >= 0 ? 1 : -1;
      const mx = SX(mainDoor.x) + g.nx * away * 34;
      const my = SY(mainDoor.y) + g.ny * away * 34;
      elementsSvg += `<g data-layer="main-gate"><circle cx="${mx}" cy="${my}" r="7" fill="#10B981"/>
        <text x="${mx + 12}" y="${my + 3}" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="#047857">MAIN GATE</text></g>`;
    }

    const exterior = (layout.walls || []).filter((w) => w.type === 'exterior');
    if (exterior.length) {
      const xs = exterior.flatMap((w) => [SX(w.x1), SX(w.x2)]);
      const ys = exterior.flatMap((w) => [SY(w.y1), SY(w.y2)]);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const atY = plotTop + plotL * scale * 0.72;
      const atX = plotLeft + plotW * scale * 0.72;
      const gap = (x1, y1, x2, y2, px) => (px < 12 ? '' : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#B45309" stroke-width="1" stroke-dasharray="3,2"/>
        <text x="${(x1 + x2) / 2 + (x1 === x2 ? 4 : 0)}" y="${(y1 + y2) / 2 - (y1 === y2 ? 3 : -3)}" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#B45309" text-anchor="${x1 === x2 ? 'start' : 'middle'}">${formatMeasurement(px / scale, unit)}</text>`);
      elementsSvg += `<g data-layer="open-space">${gap(plotLeft, atY, left, atY, left - plotLeft)}${gap(right, atY, plotRight, atY, plotRight - right)}${gap(atX, plotTop, atX, top, top - plotTop)}${gap(atX, bottom, atX, plotBottom, plotBottom - bottom)}</g>`;
    }
  }

  // 7. Title Block & North Compass. The sheet grows to fit anything beyond the plot.
  const bounds = getDrawingBounds(layout);
  const margin = 2 * scale;
  const roadEdge = (pick, fallback, read) => (roads.length ? pick(...roads.map(read)) : fallback);
  const roadBottom = roadEdge(Math.max, bounds.maxY, (r) => r.y + r.length);
  const titleBlockY = originY + Math.max(bounds.maxY, roadBottom) * scale + 24;
  // Beside the plot, clear of the width dimension line above it.
  const compassX = plotRight + padding / 2;
  const compassY = plotTop + 30;
  const roadMargin = 4;
  const viewLeft = Math.min(0, originX + bounds.minX * scale - margin, SX(roadEdge(Math.min, bounds.minX, (r) => r.x)) - roadMargin);
  const viewTop = Math.min(0, originY + bounds.minY * scale - margin, SY(roadEdge(Math.min, bounds.minY, (r) => r.y)) - roadMargin);
  const viewRight = Math.max(svgW, originX + bounds.maxX * scale + margin, SX(roadEdge(Math.max, bounds.maxX, (r) => r.x + r.width)) + roadMargin);
  const viewBottom = Math.max(svgH, titleBlockY + 64 + 24);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewLeft} ${viewTop} ${viewRight - viewLeft} ${viewBottom - viewTop}" width="100%" height="100%" style="background-color: #FFFFFF;">
      <defs>
        <style>
          .txt-title { font-family: 'Segoe UI', Arial, sans-serif; font-size: 16px; font-weight: 800; fill: #070262; }
          .txt-meta { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; fill: #64748B; }
          .txt-bold { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 700; fill: #1E293B; }
        </style>
      </defs>

      <!-- Elements -->
      ${elementsSvg}

      <!-- North Arrow Indicator -->
      <g transform="translate(${compassX}, ${compassY}) rotate(${layout.plot?.compassAngle || 0})">
        <circle cx="0" cy="0" r="18" fill="#FFFFFF" stroke="#070262" stroke-width="1.5"/>
        <polygon points="0,-14 5,4 0,0 -5,4" fill="#DC2626"/>
        <polygon points="0,14 5,-4 0,0 -5,-4" fill="#070262"/>
        <text x="0" y="-18" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#DC2626" text-anchor="middle">N</text>
      </g>

      <!-- Architectural Title Block -->
      <g transform="translate(${plotLeft}, ${titleBlockY})">
        <rect x="0" y="0" width="${plotW * scale}" height="64" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.5" rx="4"/>
        <line x1="${plotW * scale * 0.5}" y1="0" x2="${plotW * scale * 0.5}" y2="64" stroke="#CBD5E1" stroke-width="1"/>
        <line x1="${plotW * scale * 0.75}" y1="0" x2="${plotW * scale * 0.75}" y2="64" stroke="#CBD5E1" stroke-width="1"/>

        <!-- Project & Client -->
        <text x="16" y="24" class="txt-title">${xmlText(layout.title || 'AUTOPLOT ARCHITECTURAL PLAN')}</text>
        <text x="16" y="44" class="txt-meta">Client: <tspan class="txt-bold">${xmlText(layout.ownerName || 'Client')}</tspan> | Facing: <tspan class="txt-bold">${xmlText(layout.plot?.facing || 'North')}</tspan></text>

        <!-- Plot Dimensions -->
        <text x="${plotW * scale * 0.5 + 16}" y="24" class="txt-bold">Plot: ${formatMeasurement(plotW, unit)} × ${formatMeasurement(plotL, unit)}</text>
        <text x="${plotW * scale * 0.5 + 16}" y="44" class="txt-meta">Area: ${formatArea(plotW * plotL, unit)}</text>

        <!-- Date & Stamp -->
        <text x="${plotW * scale * 0.75 + 16}" y="24" class="txt-bold">SCALE: 1:50</text>
        <text x="${plotW * scale * 0.75 + 16}" y="44" class="txt-meta">Date: ${new Date().toLocaleDateString()}</text>
      </g>
    </svg>
  `;
}

/**
 * Download SVG file
 */
export function exportAsSVG(layout, unit = 'ft-in', view = {}) {
  if (typeof window === 'undefined') return;
  try {
    const svgStr = generateLayoutSVG(layout, unit, view);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileBaseName(layout)}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error exporting SVG:', err);
  }
}

/** Drawing size in pixels at 20 px/ft, read from the SVG's own viewBox. */
export function getSvgSheetSize(svg) {
  const m = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/);
  return { width: Number(m[3]), height: Number(m[4]) };
}

/** Image resolution for a sheet: the DPI asked for, within what browsers can allocate. */
export function getRasterScale(sheet, dpi = PDF_DPI) {
  const wanted = (dpi / 72) * PT_PER_PX;
  return Math.min(
    wanted,
    MAX_CANVAS_SIDE / Math.max(sheet.width, sheet.height),
    Math.sqrt(MAX_CANVAS_AREA / (sheet.width * sheet.height)),
  );
}

/** Draw the layout onto a white canvas at the given resolution. */
function rasterizeLayout(layout, unit, pixelScale, view) {
  return new Promise((resolve, reject) => {
    const svg = generateLayoutSVG(layout, unit, view);
    const sheet = getSvgSheetSize(svg);
    const scale = pixelScale ?? getRasterScale(sheet);
    const width = Math.round(sheet.width * scale);
    const height = Math.round(sheet.height * scale);
    // Explicit pixel size: an image loaded with width="100%" has no reliable size.
    const sized = svg.replace('width="100%" height="100%"', `width="${width}" height="${height}"`);
    const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ canvas, sheet });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The layout drawing could not be rendered.'));
    };
    img.src = url;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be created.'))), type, quality);
});

/**
 * Download the exact layout as a one-page PDF. The page is sized so the drawing
 * measures true at 1:50 when printed at 100%.
 * @param {object} [view] layers to draw, so the file matches the screen it came from
 * @returns {Promise<boolean>} whether the file was created
 */
export async function exportAsPDF(layout, unit = 'ft-in', view = {}) {
  if (typeof document === 'undefined' || !layout) return false;
  try {
    const { canvas, sheet } = await rasterizeLayout(layout, unit, undefined, view);
    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    const pdf = buildJpegPdf({
      jpeg: new Uint8Array(await jpegBlob.arrayBuffer()),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      pageWidthPt: sheet.width * PT_PER_PX,
      pageHeightPt: sheet.height * PT_PER_PX,
      title: layout.title || 'AutoPlot Layout',
    });
    downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `${fileBaseName(layout)}.pdf`);
    return true;
  } catch (err) {
    console.error('Error exporting PDF:', err);
    return false;
  }
}

/**
 * Export high-resolution PNG image
 */
export async function exportAsPNG(layout, unit = 'ft-in', view = {}) {
  if (typeof document === 'undefined') return;
  try {
    const { canvas } = await rasterizeLayout(layout, unit, 2, view);
    downloadBlob(await canvasToBlob(canvas, 'image/png'), `${fileBaseName(layout)}.png`);
  } catch (err) {
    console.error('Error exporting PNG:', err);
  }
}

/**
 * Trigger clean browser print preview
 */
export function printLayoutPlan(layout, unit = 'ft-in', view = {}) {
  if (typeof window === 'undefined') return;
  try {
    const svgContent = generateLayoutSVG(layout, unit, view);
    const printWindow = window.open('', '_blank', 'width=1000,height=800');
    if (!printWindow) {
      alert('Please allow popups to open print preview.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${layout.title || 'Architectural Layout Plan'}</title>
          <style>
            @page { size: landscape; margin: 10mm; }
            body { margin: 0; padding: 20px; font-family: sans-serif; display: flex; justify-content: center; align-items: center; }
            .print-container { width: 100%; max-width: 95vw; }
            svg { width: 100%; height: auto; max-height: 90vh; }
          </style>
        </head>
        <body>
          <div class="print-container">
            ${svgContent}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 400);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  } catch (err) {
    console.error('Error triggering print:', err);
  }
}
