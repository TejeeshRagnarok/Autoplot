/**
 * AutoPlot Selection Model
 *
 * Hit testing and box selection against real geometry. Tolerances are given in
 * screen pixels and converted with the current scale, so selection behaves the
 * same at every zoom level.
 *
 * A selection is `selectedElement`: either { type, data } for one element, or
 * { type: 'multi', data: { items: [{ type, id }...] } } for several.
 */

import { getStaircaseBounds } from './staircaseGeometry.js';
import { getOpeningGeometry } from './wallOps.js';
import { COLLECTIONS, isPlotDimension } from './cadCommands.js';
import { distanceToOutline, entityBounds, projectToSegment } from './cadGeometry.js';

export const STROKE_PICK_PX = 5;

// Higher wins: small, deliberate targets sit in front of the areas behind them.
const PRIORITY = {
  door: 100,
  window: 100,
  annotation: 90,
  dimension: 90,
  column: 80,
  entity: 70,
  wall: 60,
  staircase: 50,
  utility: 45,
  parking: 40,
  room: 30,
  plot: 1,
};

const insideRect = (x, y, r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.length;

/** Approximate world box of a text annotation at its font size. */
export function annotationBox(a, scale) {
  const size = (Number(a.fontSize) || 12) / scale;
  const width = String(a.text || '').length * size * 0.6;
  return { x: a.x, y: a.y - size, width, length: size * 1.25 };
}

/** The drawn line of a user dimension: its two points shifted by the offset. */
export function dimensionLine(d) {
  const dx = d.x2 - d.x1;
  const dy = d.y2 - d.y1;
  const L = Math.hypot(dx, dy) || 1;
  const off = Number(d.offset) || 0;
  const nx = (-dy / L) * off;
  const ny = (dx / L) * off;
  return { x1: d.x1 + nx, y1: d.y1 + ny, x2: d.x2 + nx, y2: d.y2 + ny };
}

/**
 * Every element under a world point, best candidate first.
 * @returns {Array<{type, data, rank}>}
 */
export function hitTestAll(layout, wx, wy, scale, { includePlot = true } = {}) {
  if (!layout) return [];
  const tol = STROKE_PICK_PX / Math.max(1e-6, scale);
  const p = { x: wx, y: wy };
  const hits = [];
  const add = (type, data, closeness = 0, size = 0) => hits.push({ type, data, closeness, size });

  for (const [type, key] of [['door', 'doors'], ['window', 'windows']]) {
    for (const o of layout[key] || []) {
      const g = getOpeningGeometry(o, layout.walls);
      const rx = wx - o.x;
      const ry = wy - o.y;
      const along = Math.abs(rx * g.ux + ry * g.uy);
      const across = Math.abs(rx * g.nx + ry * g.ny);
      if (along <= g.width / 2 + tol && across <= g.thickness / 2 + tol) add(type, o, across);
    }
  }
  for (const a of layout.annotations || []) {
    if (insideRect(wx, wy, annotationBox(a, scale))) add('annotation', a);
  }
  for (const d of layout.dimensions || []) {
    if (isPlotDimension(d.id)) continue;
    const line = dimensionLine(d);
    const q = projectToSegment(p, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 });
    if (q.distance <= tol * 1.5) add('dimension', d, q.distance);
  }
  for (const c of layout.columns || []) {
    const half = (Number(c.size) || 0.75) / 2 + tol;
    if (Math.abs(wx - c.x) <= half && Math.abs(wy - c.y) <= half) add('column', c, Math.hypot(wx - c.x, wy - c.y));
  }
  for (const e of layout.cadEntities || []) {
    const d = distanceToOutline(p, e, 'entity');
    if (d <= tol) add('entity', e, d);
  }
  for (const w of layout.walls || []) {
    const q = projectToSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    if (q.distance <= Math.max((Number(w.thickness) || 0.375) / 2, tol)) add('wall', w, q.distance);
  }
  for (const s of layout.staircases || []) {
    const b = getStaircaseBounds(s);
    if (insideRect(wx, wy, b)) add('staircase', s, 0, b.width * b.length);
  }
  for (const u of layout.utilities || []) {
    if (insideRect(wx, wy, u)) add('utility', u, 0, u.width * u.length);
  }
  for (const pk of layout.parking || []) {
    if (insideRect(wx, wy, pk)) add('parking', pk, 0, pk.width * pk.length);
  }
  for (const r of layout.rooms || []) {
    if (insideRect(wx, wy, r)) add('room', r, 0, r.width * r.length);
  }
  if (includePlot && layout.plot) {
    const W = Number(layout.plot.width) || 30;
    const L = Number(layout.plot.length) || 40;
    if (wx >= 0 && wx <= W && wy >= 0 && wy <= L) add('plot', layout.plot);
  }

  // Priority first; then the closest outline; then the smaller of two overlapping areas.
  return hits.sort((a, b) => (PRIORITY[b.type] - PRIORITY[a.type]) || (a.closeness - b.closeness) || (a.size - b.size));
}

export const toSelection = (hit) => (hit ? { type: hit.type, data: hit.data } : null);

/** Element to select next when clicking repeatedly at a spot where objects overlap. */
export function nextOverlappingHit(hits, current) {
  if (!hits.length) return null;
  const idx = hits.findIndex((h) => h.type === current?.type && h.data?.id === current?.data?.id);
  return idx < 0 ? hits[0] : hits[(idx + 1) % hits.length];
}

function elementBox(type, el, layout, scale) {
  switch (type) {
    case 'wall':
    case 'dimension':
      return { minX: Math.min(el.x1, el.x2), minY: Math.min(el.y1, el.y2), maxX: Math.max(el.x1, el.x2), maxY: Math.max(el.y1, el.y2) };
    case 'door':
    case 'window': {
      const g = getOpeningGeometry(el, layout.walls);
      return { minX: Math.min(g.a.x, g.b.x), minY: Math.min(g.a.y, g.b.y), maxX: Math.max(g.a.x, g.b.x), maxY: Math.max(g.a.y, g.b.y) };
    }
    case 'column': {
      const h = (Number(el.size) || 0.75) / 2;
      return { minX: el.x - h, minY: el.y - h, maxX: el.x + h, maxY: el.y + h };
    }
    case 'annotation': {
      const b = annotationBox(el, scale);
      return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.length };
    }
    case 'entity':
      return entityBounds(el);
    case 'staircase': {
      const b = getStaircaseBounds(el);
      return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.length };
    }
    default:
      return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.length };
  }
}

/**
 * Box selection, CAD convention: dragging left to right selects what is fully
 * inside the box; dragging right to left also selects what the box touches.
 * @returns {Array<{type, id}>}
 */
export function boxSelect(layout, start, end, scale) {
  const crossing = end.x < start.x;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const out = [];
  for (const [type, key] of Object.entries(COLLECTIONS)) {
    for (const el of layout[key] || []) {
      if (type === 'dimension' && isPlotDimension(el.id)) continue;
      const b = elementBox(type, el, layout, scale);
      const inside = b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY;
      const touches = b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;
      if (crossing ? touches : inside) out.push({ type, id: el.id });
    }
  }
  return out;
}

/** The selection as a flat list of refs. */
export function selectionItems(selected) {
  if (!selected) return [];
  if (selected.type === 'multi') return selected.data.items;
  if (selected.type === 'plot') return [];
  if (selected.type === 'dimension' && isPlotDimension(selected.data?.id)) return [];
  return selected.data?.id ? [{ type: selected.type, id: selected.data.id }] : [];
}

/** Build a selection value from refs (single element, multi, or nothing). */
export function selectionFromItems(layout, items) {
  const live = items.filter((r) => (layout[COLLECTIONS[r.type]] || []).some((e) => e.id === r.id));
  if (live.length === 0) return null;
  if (live.length === 1) {
    return { type: live[0].type, data: layout[COLLECTIONS[live[0].type]].find((e) => e.id === live[0].id) };
  }
  return { type: 'multi', data: { items: live } };
}

/** Add or remove one element (Shift+click). */
export function toggleInSelection(layout, selected, hit) {
  const items = selectionItems(selected);
  const exists = items.some((r) => r.type === hit.type && r.id === hit.data.id);
  const next = exists ? items.filter((r) => !(r.type === hit.type && r.id === hit.data.id)) : [...items, { type: hit.type, id: hit.data.id }];
  return selectionFromItems(layout, next);
}

export function isItemSelected(selected, type, id) {
  if (!selected) return false;
  if (selected.type === 'multi') return selected.data.items.some((r) => r.type === type && r.id === id);
  return selected.type === type && selected.data?.id === id;
}
