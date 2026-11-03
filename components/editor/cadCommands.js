/**
 * AutoPlot CAD Modification Commands
 *
 * Every command is a pure function: layout in, { layout, created, skipped, reason }
 * out. Nothing is simulated - each command computes real geometry, and anything
 * a command cannot do to an element is reported in `skipped` / `reason` rather
 * than approximated. The caller records the returned layout as one undo step.
 *
 * SUPPORT MATRIX
 *                          move copy rotate mirror scale offset trim extend fillet chamfer stretch break join array
 *   wall                    x    x    x      x      x     x      x    x      r=0    x       x       x     x    x
 *   line                    x    x    x      x      x     x      x    x      x      x       x       x     x    x
 *   polyline / polygon      x    x    x      x      x     x      x    x(open) -      -      x       x     x    x
 *   circle                  x    x    x      x      x     x      x    -      -      -       x       x     -    x
 *   arc                     x    x    x      x      x     x      x    -      -      -       x       x     x    x
 *   room, parking, utility  x    x    90deg  axis   x     -      -    -      -      -       x       -     -    x
 *   staircase               x    x    90deg  axis   -     -      -    -      -      -       x       -     -    x
 *   column, text, dimension x    x    x      x      x     -      -    -      -      -       x       -     -    x
 *   door, window            with their host wall, or sliding along a wall
 */

import { generateUniqueId, createRoom, createRoomBoundaryWalls } from './layoutModel.js';
import { fillRoomEdgeWalls, moveRoom, resizeRoom } from './roomResize.js';
import { findHostWall } from './constraintEngine.js';
import { getStaircaseBounds, rotateStaircase, normalizeRotation } from './staircaseGeometry.js';
import { getOpeningHost, placeOpeningOnWall, reattachOpenings, joinWallPair } from './wallOps.js';
import {
  norm360, toDeg, dist, arcSweep, angleOnArc, pointAtAngle, lineLineIntersection, lineCircleParams,
  elementPath, elementCurve, pathSegments, pathLength, pointAtLength, projectToPath, subPath, pathCuts, curveCuts,
  offsetPoints, distanceToOutline, circleThroughThree,
} from './cadGeometry.js';

export const COLLECTIONS = {
  room: 'rooms',
  wall: 'walls',
  door: 'doors',
  window: 'windows',
  staircase: 'staircases',
  column: 'columns',
  parking: 'parking',
  utility: 'utilities',
  annotation: 'annotations',
  dimension: 'dimensions',
  entity: 'cadEntities',
};

const ID_PREFIX = {
  room: 'room', wall: 'wall', door: 'door', window: 'win', staircase: 'stair', column: 'col',
  parking: 'parking', utility: 'util', annotation: 'anno', dimension: 'dim', entity: 'ent',
};

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const rp = (p) => ({ x: round6(p.x), y: round6(p.y) });
const clone = (o) => JSON.parse(JSON.stringify(o));

export const isPlotDimension = (id) => id === 'dim-plot-width' || id === 'dim-plot-length';

export function getElement(layout, ref) {
  if (!ref) return null;
  return (layout[COLLECTIONS[ref.type]] || []).find((e) => e.id === ref.id) || null;
}

function replaceElement(layout, ref, el) {
  const key = COLLECTIONS[ref.type];
  return { ...layout, [key]: (layout[key] || []).map((e) => (e.id === ref.id ? el : e)) };
}

function appendElements(layout, type, list) {
  const key = COLLECTIONS[type];
  return { ...layout, [key]: [...(layout[key] || []), ...list] };
}

const result = (layout, extra = {}) => ({ layout, created: [], skipped: [], reason: null, ...extra });

// ---------------------------------------------------------------------------
// Entity construction
// ---------------------------------------------------------------------------

const base = (kind, params = {}) => ({
  id: params.id || generateUniqueId(ID_PREFIX.entity),
  kind,
  color: params.color || '#0F172A',
  isLocked: !!params.isLocked,
});

export function createLineEntity(a, b, params) {
  return { ...base('line', params), x1: round6(a.x), y1: round6(a.y), x2: round6(b.x), y2: round6(b.y) };
}

export function createPolylineEntity(points, params) {
  return { ...base('polyline', params), points: points.map(rp), closed: false };
}

export function createRectangleEntity(a, b, params) {
  const pts = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  return { ...base('polygon', params), shape: 'rect', points: pts.map(rp), closed: true };
}

/** Regular polygon from its centre and one vertex. */
export function createRegularPolygonEntity(center, vertex, sides = 6, params) {
  const n = Math.max(3, Math.round(sides));
  const r = dist(center, vertex);
  const a0 = Math.atan2(vertex.y - center.y, vertex.x - center.x);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * 2 * Math.PI) / n;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return { ...base('polygon', params), shape: 'polygon', points: pts.map(rp), closed: true };
}

export function createCircleEntity(center, radius, params) {
  return { ...base('circle', params), cx: round6(center.x), cy: round6(center.y), r: round6(radius) };
}

/** Arc from a start point, through a mid point, to an end point. Null if collinear. */
export function createArcEntity(a, m, b, params) {
  const c = circleThroughThree(a, m, b);
  if (!c) return null;
  const angle = (p) => norm360(toDeg(Math.atan2(p.y - c.cy, p.x - c.cx)));
  const sa = angle(a);
  const se = angle(b);
  const mid = norm360(angle(m) - sa);
  const toEnd = norm360(se - sa);
  const [start, end] = mid <= toEnd ? [sa, se] : [se, sa];
  return { ...base('arc', params), cx: round6(c.cx), cy: round6(c.cy), r: round6(c.r), start: round6(start), end: round6(end) };
}

function rebuildFromPoints(el, type, pts, id) {
  if (type === 'wall') {
    return { ...el, id, x1: round6(pts[0].x), y1: round6(pts[0].y), x2: round6(pts[1].x), y2: round6(pts[1].y) };
  }
  if (pts.length === 2) {
    const { points, closed, shape, ...rest } = el;
    return { ...rest, id, kind: 'line', x1: round6(pts[0].x), y1: round6(pts[0].y), x2: round6(pts[1].x), y2: round6(pts[1].y) };
  }
  const { x1, y1, x2, y2, shape, ...rest } = el;
  return { ...rest, id, kind: 'polyline', points: pts.map(rp), closed: false };
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export const makeTranslate = (dx, dy) => ({ kind: 'translate', dx, dy, map: (p) => ({ x: p.x + dx, y: p.y + dy }) });

export function makeRotate(center, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return {
    kind: 'rotate',
    deg,
    center,
    map: (p) => ({
      x: center.x + (p.x - center.x) * c - (p.y - center.y) * s,
      y: center.y + (p.x - center.x) * s + (p.y - center.y) * c,
    }),
  };
}

export function makeMirror(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  return {
    kind: 'mirror',
    axisDeg: toDeg(Math.atan2(dy, dx)),
    map: (p) => {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      const fx = a.x + t * dx;
      const fy = a.y + t * dy;
      return { x: 2 * fx - p.x, y: 2 * fy - p.y };
    },
  };
}

export const makeScale = (center, f) => ({
  kind: 'scale',
  f,
  map: (p) => ({ x: center.x + (p.x - center.x) * f, y: center.y + (p.y - center.y) * f }),
});

/** Multiple of 90 degrees for a rotation; null otherwise. */
function rightAngleOf(deg) {
  const n = norm360(deg);
  const r = Math.round(n / 90) * 90;
  return Math.abs(n - r) < 1e-6 ? norm360(r) : null;
}

/** 'x' when the mirror axis is vertical (x flips), 'y' when horizontal, else null. */
function mirrorFlipAxis(T) {
  const a = norm360(T.axisDeg) % 180;
  if (Math.abs(a - 90) < 1e-6) return 'x';
  if (a < 1e-6 || Math.abs(a - 180) < 1e-6) return 'y';
  return null;
}

function transformRect(el, T, name) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.length / 2;
  const c = T.map({ x: cx, y: cy });
  let w = el.width;
  let l = el.length;
  if (T.kind === 'rotate') {
    const ra = rightAngleOf(T.deg);
    if (ra === null) return { reason: `${name} stays axis-aligned, so it can only rotate in steps of 90°.` };
    if (ra === 90 || ra === 270) [w, l] = [l, w];
  } else if (T.kind === 'mirror') {
    if (!mirrorFlipAxis(T)) return { reason: `${name} stays axis-aligned, so it can only mirror about a horizontal or vertical line.` };
  } else if (T.kind === 'scale') {
    w *= T.f;
    l *= T.f;
  }
  return { el: { ...el, x: round6(c.x - w / 2), y: round6(c.y - l / 2), width: round6(w), length: round6(l) } };
}

function transformStair(el, T) {
  const b = getStaircaseBounds(el);
  const c = T.map({ x: b.x + b.width / 2, y: b.y + b.length / 2 });
  const place = (s) => {
    const nb = getStaircaseBounds(s);
    return { ...s, x: round6(c.x - nb.width / 2), y: round6(c.y - nb.length / 2) };
  };
  if (T.kind === 'translate') return { el: place(el) };
  if (T.kind === 'scale') return { reason: 'A staircase is parametric: change its width, length or tread depth instead of scaling it.' };
  if (T.kind === 'rotate') {
    const ra = rightAngleOf(T.deg);
    if (ra === null) return { reason: 'A staircase can only rotate in steps of 90°.' };
    return { el: place(rotateStaircase(el, ra)) };
  }
  const axis = mirrorFlipAxis(T);
  if (!axis) return { reason: 'A staircase can only mirror about a horizontal or vertical line.' };
  const rot = normalizeRotation(el.rotation);
  const swap = rot === 90 || rot === 270;
  const nextRot = axis === 'x' ? (swap ? norm360(rot + 180) : rot) : (swap ? rot : norm360(rot + 180));
  return { el: place({ ...el, rotation: nextRot, mirrored: !el.mirrored }) };
}

function transformEntity(el, T) {
  if (el.kind === 'line') {
    const a = T.map({ x: el.x1, y: el.y1 });
    const b = T.map({ x: el.x2, y: el.y2 });
    return { el: { ...el, x1: round6(a.x), y1: round6(a.y), x2: round6(b.x), y2: round6(b.y) } };
  }
  if (el.kind === 'polyline' || el.kind === 'polygon') {
    const next = { ...el, points: el.points.map((p) => rp(T.map(p))) };
    if (T.kind === 'rotate' && el.shape === 'rect' && rightAngleOf(T.deg) === null) next.shape = 'polygon';
    return { el: next };
  }
  const c = T.map({ x: el.cx, y: el.cy });
  const next = { ...el, cx: round6(c.x), cy: round6(c.y) };
  if (T.kind === 'scale') next.r = round6(el.r * T.f);
  if (el.kind === 'arc') {
    if (T.kind === 'rotate') {
      next.start = round6(norm360(el.start + T.deg));
      next.end = round6(norm360(el.end + T.deg));
    } else if (T.kind === 'mirror') {
      // A reflection reverses the sweep: start and end exchange roles.
      next.start = round6(norm360(2 * T.axisDeg - el.end));
      next.end = round6(norm360(2 * T.axisDeg - el.start));
    }
  }
  return { el: next };
}

/** Transform one element. Returns { el } or { reason }. */
export function transformElement(el, type, T) {
  switch (type) {
    case 'wall': {
      const a = T.map({ x: el.x1, y: el.y1 });
      const b = T.map({ x: el.x2, y: el.y2 });
      return { el: { ...el, x1: round6(a.x), y1: round6(a.y), x2: round6(b.x), y2: round6(b.y) } };
    }
    case 'dimension': {
      if (isPlotDimension(el.id)) return { reason: 'The plot dimensions follow the plot boundary.' };
      const a = T.map({ x: el.x1, y: el.y1 });
      const b = T.map({ x: el.x2, y: el.y2 });
      return { el: { ...el, x1: round6(a.x), y1: round6(a.y), x2: round6(b.x), y2: round6(b.y) } };
    }
    case 'entity':
      return transformEntity(el, T);
    case 'room':
      return transformRect(el, T, `"${el.name || 'Room'}"`);
    case 'parking':
      return transformRect(el, T, `"${el.label || 'Parking'}"`);
    case 'utility':
      return transformRect(el, T, `"${el.name || 'Utility'}"`);
    case 'staircase':
      return transformStair(el, T);
    case 'column':
    case 'annotation': {
      const c = T.map({ x: el.x, y: el.y });
      return { el: { ...el, x: round6(c.x), y: round6(c.y) } };
    }
    case 'door':
    case 'window': {
      const c = T.map({ x: el.x, y: el.y });
      const next = { ...el, x: round6(c.x), y: round6(c.y) };
      // A reflection flips which side the wall normal points to.
      if (T.kind === 'mirror' && type === 'door') next.swing = el.swing === 'outward' ? 'inward' : 'outward';
      return { el: next };
    }
    default:
      return { reason: `A ${type} cannot be transformed.` };
  }
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

function onRoomEdge(room, w) {
  const near = (a, b) => Math.abs(a - b) <= 0.02;
  const h = Math.abs(w.y1 - w.y2) < 0.02;
  const v = Math.abs(w.x1 - w.x2) < 0.02;
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.01;
  if (h && (near(w.y1, room.y) || near(w.y1, room.y + room.length))) {
    return overlap(Math.min(w.x1, w.x2), Math.max(w.x1, w.x2), room.x, room.x + room.width);
  }
  if (v && (near(w.x1, room.x) || near(w.x1, room.x + room.width))) {
    return overlap(Math.min(w.y1, w.y2), Math.max(w.y1, w.y2), room.y, room.y + room.length);
  }
  return false;
}

/** Walls drawn only for this room (not exterior, not shared with another room). */
export function exclusiveRoomWalls(layout, room, ignoreRoomIds = new Set()) {
  return (layout.walls || []).filter((w) => w.type !== 'exterior' && !w.isLocked && onRoomEdge(room, w) &&
    !(layout.rooms || []).some((r) => r.id !== room.id && !ignoreRoomIds.has(r.id) && onRoomEdge(r, w)));
}

function hostedOpenings(layout, wallIds) {
  const refs = [];
  for (const [type, key] of [['door', 'doors'], ['window', 'windows']]) {
    for (const o of layout[key] || []) {
      const host = getOpeningHost(o, layout.walls);
      if (host && wallIds.has(host.wall.id)) refs.push({ type, id: o.id });
    }
  }
  return refs;
}

const refKey = (r) => `${r.type}:${r.id}`;

/** Selection plus what travels with it: a room's own walls, a wall's openings. */
function expandForMove(layout, items) {
  const out = new Map(items.map((r) => [refKey(r), r]));
  for (const r of items) {
    if (r.type !== 'room') continue;
    const room = getElement(layout, r);
    if (room) for (const w of exclusiveRoomWalls(layout, room)) out.set(refKey({ type: 'wall', id: w.id }), { type: 'wall', id: w.id });
  }
  const wallIds = new Set([...out.values()].filter((r) => r.type === 'wall').map((r) => r.id));
  for (const r of hostedOpenings(layout, wallIds)) out.set(refKey(r), r);
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Move / rotate / mirror / scale (in place)
// ---------------------------------------------------------------------------

/** Apply a transform to the selection in place. */
export function transformSelection(layout, items, T) {
  const expanded = expandForMove(layout, items);
  const movingWalls = new Set(expanded.filter((r) => r.type === 'wall').map((r) => r.id));
  const skipped = [];
  const rejected = new Set();
  const changes = [];
  for (const ref of expanded) {
    const el = getElement(layout, ref);
    if (!el) continue;
    if (el.isLocked) {
      rejected.add(refKey(ref));
      skipped.push(`A locked ${ref.type} was left where it is.`);
      continue;
    }
    if (ref.type === 'door' || ref.type === 'window') {
      const host = getOpeningHost(el, layout.walls);
      if (!host || !movingWalls.has(host.wall.id)) {
        if (T.kind === 'translate') {
          // An opening selected without its wall can only slide along walls.
          const place = placeOpeningOnWall(layout, el, T.map({ x: el.x, y: el.y }), { maxDist: 1.5 });
          if (place) changes.push([ref, { ...el, ...place }]);
          else skipped.push('A door or window must stay on a wall, so it was not moved.');
        } else {
          skipped.push('Select the host wall as well to transform a door or window.');
        }
        continue;
      }
    }
    const res = transformElement(el, ref.type, T);
    if (res.reason) {
      rejected.add(refKey(ref));
      skipped.push(res.reason);
      continue;
    }
    changes.push([ref, res.el]);
  }
  let next = layout;
  for (const [ref, el] of changes) next = replaceElement(next, ref, el);
  const movedRooms = changes.filter(([r]) => r.type === 'room').map(([r]) => r.id);
  if (movedRooms.length) {
    next = clone(next);
    fillRoomEdgeWalls(next, movedRooms);
  }
  return result(changes.length ? next : layout, { skipped: [...new Set(skipped)], changed: changes.length });
}

// ---------------------------------------------------------------------------
// Copy / duplicate / paste / arrays
// ---------------------------------------------------------------------------

/** Independent copies of element records, transformed and added to the layout. */
export function insertCopies(layout, records, T) {
  const wallIdMap = new Map();
  const added = {};
  const created = [];
  const skipped = [];
  const push = (type, el) => {
    (added[type] = added[type] || []).push(el);
    created.push({ type, id: el.id });
  };

  for (const { type, data } of records) {
    if (type !== 'wall') continue;
    const res = transformElement(data, type, T);
    if (res.reason) { skipped.push(res.reason); continue; }
    const id = generateUniqueId(ID_PREFIX.wall);
    wallIdMap.set(data.id, id);
    push('wall', { ...res.el, id, isLocked: false });
  }

  let next = appendElements(layout, 'wall', added.wall || []);
  const roomsToWall = [];

  for (const { type, data } of records) {
    if (type === 'wall' || type === 'plot') continue;
    if (type === 'dimension' && isPlotDimension(data.id)) { skipped.push('The plot dimensions cannot be copied.'); continue; }
    if (type === 'door' || type === 'window') {
      const mapped = T.map({ x: data.x, y: data.y });
      const newId = generateUniqueId(ID_PREFIX[type]);
      if (wallIdMap.has(data.wallId)) {
        const res = transformElement(data, type, T);
        const el = { ...res.el, id: newId, wallId: wallIdMap.get(data.wallId), isMain: false, isLocked: false };
        next = appendElements(next, type, [el]);
        created.push({ type, id: newId });
      } else {
        // The copy must land on a wall: slide past the original when it would overlap.
        const place = placeOpeningOnWall(next, { ...data, id: newId }, mapped, { maxDist: 3 });
        if (place) {
          next = appendElements(next, type, [{ ...data, ...place, id: newId, isMain: false, isLocked: false }]);
          created.push({ type, id: newId });
        } else {
          skipped.push(`No free wall length for a copy of this ${type}.`);
        }
      }
      continue;
    }
    const res = transformElement(data, type, T);
    if (res.reason) { skipped.push(res.reason); continue; }
    const id = generateUniqueId(ID_PREFIX[type]);
    const el = { ...clone(res.el), id, isLocked: false };
    if (type === 'room') {
      el.name = `${data.name || 'Room'} (Copy)`;
      el.label = el.name;
      roomsToWall.push(el);
    }
    next = appendElements(next, type, [el]);
    created.push({ type, id });
  }
  // Every room gets its own boundary walls, reusing any wall already there.
  for (const room of roomsToWall) {
    next = { ...next, walls: createRoomBoundaryWalls(next, createRoom(room)) };
  }
  return result(created.length ? next : layout, { created, skipped: [...new Set(skipped)] });
}

/** Snapshot of the selection, independent of later edits. */
export function copyToClipboard(layout, items) {
  const wallIds = new Set(items.filter((r) => r.type === 'wall').map((r) => r.id));
  const refs = [...items, ...hostedOpenings(layout, wallIds).filter((r) => !items.some((i) => refKey(i) === refKey(r)))];
  return refs
    .map((ref) => ({ type: ref.type, data: clone(getElement(layout, ref)) }))
    .filter((r) => r.data && !(r.type === 'dimension' && isPlotDimension(r.data.id)));
}

export function copySelection(layout, items, dx, dy) {
  return insertCopies(layout, copyToClipboard(layout, items), makeTranslate(dx, dy));
}

export function rectangularArray(layout, items, { rows = 1, cols = 1, dx = 0, dy = 0 }) {
  const records = copyToClipboard(layout, items);
  let next = layout;
  const created = [];
  const skipped = [];
  for (let r = 0; r < Math.max(1, rows); r++) {
    for (let c = 0; c < Math.max(1, cols); c++) {
      if (r === 0 && c === 0) continue;
      const res = insertCopies(next, records, makeTranslate(c * dx, r * dy));
      next = res.layout;
      created.push(...res.created);
      skipped.push(...res.skipped);
    }
  }
  return result(next, { created, skipped: [...new Set(skipped)], reason: created.length ? null : 'The array settings create no copies.' });
}

/** Polar array: `count` items in total spread over `angle` degrees about a centre. */
export function polarArray(layout, items, { count = 4, angle = 360, center }) {
  const records = copyToClipboard(layout, items);
  const full = Math.abs(Math.abs(angle) - 360) < 1e-6;
  const n = Math.max(2, Math.round(count));
  const step = angle / (full ? n : n - 1);
  let next = layout;
  const created = [];
  const skipped = [];
  for (let i = 1; i < n; i++) {
    const res = insertCopies(next, records, makeRotate(center, step * i));
    next = res.layout;
    created.push(...res.created);
    skipped.push(...res.skipped);
  }
  return result(next, { created, skipped: [...new Set(skipped)], reason: created.length ? null : (skipped[0] || 'Nothing was copied.') });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete the selection. A wall takes its openings with it; a room takes the
 * walls only it was using. The last remaining room cannot be deleted.
 */
export function deleteSelection(layout, items) {
  const skipped = [];
  const remove = new Map();
  const roomIds = new Set(items.filter((r) => r.type === 'room').map((r) => r.id));
  if (roomIds.size && roomIds.size >= (layout.rooms || []).length) {
    skipped.push('Cannot delete the only remaining room.');
    const keep = items.find((r) => r.type === 'room');
    roomIds.delete(keep.id);
    items = items.filter((r) => r !== keep);
  }
  for (const ref of items) {
    const el = getElement(layout, ref);
    if (!el) continue;
    if (ref.type === 'dimension' && isPlotDimension(el.id)) { skipped.push('The plot dimensions cannot be deleted.'); continue; }
    if (el.isLocked) { skipped.push(`A locked ${ref.type} was not deleted.`); continue; }
    remove.set(refKey(ref), ref);
    if (ref.type === 'room') {
      for (const w of exclusiveRoomWalls(layout, el, roomIds)) remove.set(refKey({ type: 'wall', id: w.id }), { type: 'wall', id: w.id });
    }
  }
  const wallIds = new Set([...remove.values()].filter((r) => r.type === 'wall').map((r) => r.id));
  for (const r of hostedOpenings(layout, wallIds)) remove.set(refKey(r), r);
  if (remove.size === 0) return result(layout, { skipped, removed: 0 });
  const next = { ...layout };
  for (const [type, key] of Object.entries(COLLECTIONS)) {
    if (!next[key]) continue;
    next[key] = next[key].filter((e) => !remove.has(`${type}:${e.id}`));
  }
  return result(next, { skipped: [...new Set(skipped)], removed: remove.size });
}

// ---------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------

/** Parallel copy at an exact distance, on the side of `sidePoint`. */
export function offsetElement(layout, ref, distance, sidePoint) {
  const el = getElement(layout, ref);
  if (!el) return result(layout, { reason: 'Nothing to offset.' });
  if (!(distance > 0)) return result(layout, { reason: 'The offset distance must be greater than zero.' });

  const curve = elementCurve(el, ref.type);
  if (curve) {
    const outward = Math.hypot(sidePoint.x - el.cx, sidePoint.y - el.cy) > el.r;
    const r = el.r + (outward ? distance : -distance);
    if (r <= 1e-6) return result(layout, { reason: 'The offset is larger than the radius.' });
    const copy = { ...clone(el), id: generateUniqueId(ID_PREFIX.entity), r: round6(r) };
    return result(appendElements(layout, 'entity', [copy]), { created: [{ type: 'entity', id: copy.id }] });
  }

  const path = elementPath(el, ref.type);
  if (!path) return result(layout, { reason: `A ${ref.type} cannot be offset.` });
  const a = offsetPoints(path.points, path.closed, distance);
  const b = offsetPoints(path.points, path.closed, -distance);
  const closer = (cand) => projectToPath({ points: cand, closed: path.closed }, sidePoint).distance;
  const pts = closer(a) <= closer(b) ? a : b;
  const id = generateUniqueId(ID_PREFIX[ref.type]);
  const copy = ref.type === 'wall'
    ? { ...el, id, isLocked: false, x1: round6(pts[0].x), y1: round6(pts[0].y), x2: round6(pts[1].x), y2: round6(pts[1].y) }
    : el.kind === 'line'
      ? { ...el, id, isLocked: false, x1: round6(pts[0].x), y1: round6(pts[0].y), x2: round6(pts[1].x), y2: round6(pts[1].y) }
      : { ...el, id, isLocked: false, points: pts.map(rp), shape: el.shape === 'rect' ? 'rect' : el.shape };
  return result(appendElements(layout, ref.type, [copy]), { created: [{ type: ref.type, id }] });
}

// ---------------------------------------------------------------------------
// Trim / Extend / Break
// ---------------------------------------------------------------------------

/** Everything another entity can be cut by or extended to. */
function collectCutters(layout, exclude) {
  const out = [];
  for (const w of layout.walls || []) {
    if (exclude?.type === 'wall' && w.id === exclude.id) continue;
    out.push({ path: elementPath(w, 'wall') });
  }
  for (const e of layout.cadEntities || []) {
    if (exclude?.type === 'entity' && e.id === exclude.id) continue;
    const path = elementPath(e, 'entity');
    if (path) out.push({ path });
    else out.push({ curve: e });
  }
  return out;
}

/** Replace one straight element with pieces; a wall's openings follow their piece. */
function replaceWithPieces(layout, ref, el, piecePoints) {
  const pieces = piecePoints.map((pts, i) => rebuildFromPoints(el, ref.type, pts, i === 0 ? el.id : generateUniqueId(ID_PREFIX[ref.type])));
  const key = COLLECTIONS[ref.type];
  const list = (layout[key] || []).flatMap((e) => (e.id === ref.id ? pieces : [e]));
  let next = { ...layout, [key]: list };
  if (ref.type === 'wall') {
    const rehome = (arr, kind) => (arr || []).map((o) => {
      const host = getOpeningHost(o, [el]);
      if (!host) return o;
      const hit = findHostWall(o, pieces, 0.05);
      const owner = hit ? hit.wall : pieces[0];
      const place = placeOpeningOnWall(next, o, { x: o.x, y: o.y }, { onlyWallId: owner.id, maxDist: Infinity });
      return place ? { ...o, ...place } : { ...o, wallId: owner.id };
    });
    next = { ...next, doors: rehome(next.doors, 'door'), windows: rehome(next.windows, 'window') };
  }
  return { layout: next, created: pieces.slice(1).map((p) => ({ type: ref.type, id: p.id })) };
}

/** Would removing [s0, s1] along this wall take a hosted opening with it? */
function openingInSpan(layout, wall, s0, s1) {
  const len = dist({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
  return [...(layout.doors || []), ...(layout.windows || [])].some((o) => {
    const host = getOpeningHost(o, [wall], 0.05);
    if (!host) return false;
    const c = host.t * len;
    return c >= s0 - 1e-6 && c <= s1 + 1e-6;
  });
}

/**
 * Trim: remove the piece of an entity under `click`, bounded by the actual
 * intersections with the other walls and entities.
 */
export function trimElement(layout, ref, click) {
  const el = getElement(layout, ref);
  if (!el) return result(layout, { reason: 'Click the piece to remove.' });
  if (el.isLocked) return result(layout, { reason: 'This object is locked.' });
  const cutters = collectCutters(layout, ref);
  const noCut = 'This object does not cross a cutting edge here, so there is nothing to trim.';

  const curve = elementCurve(el, ref.type);
  if (curve) {
    const clickDeg = norm360(toDeg(Math.atan2(click.y - el.cy, click.x - el.cx)));
    const cuts = curveCuts(el, cutters);
    if (el.kind === 'circle') {
      if (cuts.length < 2) return result(layout, { reason: noCut });
      const sorted = [...new Set(cuts.map((c) => round6(c)))].sort((p, q) => p - q);
      const next = sorted.find((c) => c > clickDeg) ?? sorted[0];
      const before = [...sorted].reverse().find((c) => c < clickDeg) ?? sorted[sorted.length - 1];
      const { cx, cy, r, ...rest } = el;
      const arc = { ...rest, kind: 'arc', cx, cy, r, start: next, end: before };
      return result(replaceElement(layout, ref, arc));
    }
    const sweep = arcSweep(el);
    const offs = cuts.map((c) => norm360(c - el.start)).filter((o) => o > 1e-6 && o < sweep - 1e-6).sort((p, q) => p - q);
    if (offs.length === 0) return result(layout, { reason: noCut });
    const off = norm360(clickDeg - el.start);
    const lo = [...offs].reverse().find((o) => o < off) ?? 0;
    const hi = offs.find((o) => o > off) ?? sweep;
    const arcs = [];
    if (lo > 1e-6) arcs.push({ ...el, end: round6(norm360(el.start + lo)) });
    if (hi < sweep - 1e-6) arcs.push({ ...el, id: arcs.length ? generateUniqueId(ID_PREFIX.entity) : el.id, start: round6(norm360(el.start + hi)) });
    const list = layout.cadEntities.flatMap((e) => (e.id === el.id ? arcs : [e]));
    return result({ ...layout, cadEntities: list });
  }

  const path = elementPath(el, ref.type);
  if (!path) return result(layout, { reason: `A ${ref.type} cannot be trimmed.` });
  const L = pathLength(path);
  const s = projectToPath(path, click).s;
  if (path.closed) {
    const cuts = pathCuts(path, cutters);
    if (cuts.length < 2) return result(layout, { reason: noCut });
    const next = cuts.find((c) => c > s) ?? cuts[0];
    const prev = [...cuts].reverse().find((c) => c < s) ?? cuts[cuts.length - 1];
    const first = next > prev ? [] : subPath(path, next, prev);
    const kept = next > prev ? [...subPath(path, next, L), ...subPath(path, 0, prev).slice(1)] : first;
    return result(replaceElement(layout, ref, rebuildFromPoints(el, ref.type, kept, el.id)));
  }
  const cuts = pathCuts(path, cutters).filter((c) => c > 1e-6 && c < L - 1e-6);
  if (cuts.length === 0) return result(layout, { reason: noCut });
  const prev = [...cuts].reverse().find((c) => c <= s) ?? 0;
  const next = cuts.find((c) => c > s) ?? L;
  if (ref.type === 'wall' && openingInSpan(layout, el, prev, next)) {
    return result(layout, { reason: 'That piece of wall hosts a door or window. Move or delete the opening first.' });
  }
  const pieces = [];
  if (prev > 1e-6) pieces.push(subPath(path, 0, prev));
  if (next < L - 1e-6) pieces.push(subPath(path, next, L));
  if (pieces.length === 0) {
    const del = deleteSelection(layout, [ref]);
    return result(del.layout);
  }
  const res = replaceWithPieces(layout, ref, el, pieces);
  return result(res.layout, { created: res.created });
}

/** Extend the end nearest `click` along its own direction to the next boundary. */
export function extendElement(layout, ref, click) {
  const el = getElement(layout, ref);
  if (!el) return result(layout, { reason: 'Click near the end to extend.' });
  if (el.isLocked) return result(layout, { reason: 'This object is locked.' });
  const path = elementPath(el, ref.type);
  if (!path || path.closed) return result(layout, { reason: 'Only walls, lines and open polylines can be extended.' });
  const pts = path.points;
  const atStart = dist(click, pts[0]) < dist(click, pts[pts.length - 1]);
  const end = atStart ? pts[0] : pts[pts.length - 1];
  const inner = atStart ? pts[1] : pts[pts.length - 2];
  let bestT = Infinity;
  for (const c of collectCutters(layout, ref)) {
    if (c.path) {
      for (const [p, q] of pathSegments(c.path)) {
        const hit = lineLineIntersection(inner, end, p, q);
        if (hit && hit.t > 1 + 1e-6 && hit.u >= -1e-7 && hit.u <= 1 + 1e-7 && hit.t < bestT) bestT = hit.t;
      }
    } else {
      for (const t of lineCircleParams(inner, end, c.curve)) {
        if (t <= 1 + 1e-6 || t >= bestT) continue;
        const pt = { x: inner.x + t * (end.x - inner.x), y: inner.y + t * (end.y - inner.y) };
        const deg = toDeg(Math.atan2(pt.y - c.curve.cy, pt.x - c.curve.cx));
        if (c.curve.kind !== 'arc' || angleOnArc(c.curve, deg)) bestT = t;
      }
    }
  }
  if (bestT === Infinity) return result(layout, { reason: 'There is no boundary to extend to in that direction.' });
  const target = rp({ x: inner.x + bestT * (end.x - inner.x), y: inner.y + bestT * (end.y - inner.y) });
  let next;
  if (ref.type === 'wall' || el.kind === 'line') {
    const moved = atStart ? { ...el, x1: target.x, y1: target.y } : { ...el, x2: target.x, y2: target.y };
    next = replaceElement(layout, ref, moved);
    if (ref.type === 'wall') next = reattachOpenings(layout, next);
  } else {
    const points = pts.slice();
    points[atStart ? 0 : points.length - 1] = target;
    next = replaceElement(layout, ref, { ...el, points });
  }
  return result(next);
}

/** Break at one point (splits) or between two points (removes the span). */
export function breakElement(layout, ref, p1, p2 = null) {
  const el = getElement(layout, ref);
  if (!el) return result(layout, { reason: 'Click the object to break.' });
  if (el.isLocked) return result(layout, { reason: 'This object is locked.' });

  const curve = elementCurve(el, ref.type);
  if (curve) {
    const angle = (p) => norm360(toDeg(Math.atan2(p.y - el.cy, p.x - el.cx)));
    if (el.kind === 'circle') {
      if (!p2) return result(layout, { reason: 'Pick two points to break a circle.' });
      const { cx, cy, r, ...rest } = el;
      return result(replaceElement(layout, ref, { ...rest, kind: 'arc', cx, cy, r, start: round6(angle(p2)), end: round6(angle(p1)) }));
    }
    const sweep = arcSweep(el);
    const o1 = norm360(angle(p1) - el.start);
    const o2 = p2 ? norm360(angle(p2) - el.start) : o1;
    const lo = Math.min(o1, o2);
    const hi = Math.max(o1, o2);
    if (hi > sweep) return result(layout, { reason: 'Pick a point on the arc.' });
    const arcs = [];
    if (lo > 1e-6) arcs.push({ ...el, end: round6(norm360(el.start + lo)) });
    if (hi < sweep - 1e-6) arcs.push({ ...el, id: arcs.length ? generateUniqueId(ID_PREFIX.entity) : el.id, start: round6(norm360(el.start + hi)) });
    return result({ ...layout, cadEntities: layout.cadEntities.flatMap((e) => (e.id === el.id ? arcs : [e])) });
  }

  const path = elementPath(el, ref.type);
  if (!path) return result(layout, { reason: `A ${ref.type} cannot be broken.` });
  const L = pathLength(path);
  const s1 = projectToPath(path, p1).s;
  const s2 = p2 ? projectToPath(path, p2).s : s1;
  const lo = Math.min(s1, s2);
  const hi = Math.max(s1, s2);
  if (path.closed) {
    // Opening a closed shape leaves one open polyline.
    const kept = [...subPath(path, hi, L), ...subPath(path, 0, lo).slice(1)];
    return result(replaceElement(layout, ref, rebuildFromPoints(el, ref.type, kept, el.id)));
  }
  if (ref.type === 'wall' && hi > lo && openingInSpan(layout, el, lo, hi)) {
    return result(layout, { reason: 'That span of wall hosts a door or window. Move or delete the opening first.' });
  }
  const pieces = [];
  if (lo > 1e-6) pieces.push(subPath(path, 0, lo));
  if (hi < L - 1e-6) pieces.push(subPath(path, hi, L));
  if (pieces.length < (hi > lo ? 1 : 2)) return result(layout, { reason: 'Pick a point away from the ends.' });
  const res = replaceWithPieces(layout, ref, el, pieces);
  return result(res.layout, { created: res.created });
}

// ---------------------------------------------------------------------------
// Fillet / Chamfer
// ---------------------------------------------------------------------------

function cornerSetup(layout, refA, refB, pickA, pickB) {
  const a = getElement(layout, refA);
  const b = getElement(layout, refB);
  const straight = (el, ref) => el && (ref.type === 'wall' || el.kind === 'line');
  if (!straight(a, refA) || !straight(b, refB)) return { reason: 'Pick two walls or two lines.' };
  if (refA.type === refB.type && refA.id === refB.id) return { reason: 'Pick two different objects.' };
  if (a.isLocked || b.isLocked) return { reason: 'A locked object cannot be changed.' };
  const seg = (e) => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  const [a1, a2] = seg(a);
  const [b1, b2] = seg(b);
  const I = lineLineIntersection(a1, a2, b1, b2);
  if (!I) return { reason: 'These objects are parallel, so they have no corner.' };
  const keepEnd = (p, q, pick) => {
    if (pick) {
      const dot = (e) => (e.x - I.x) * (pick.x - I.x) + (e.y - I.y) * (pick.y - I.y);
      const dp = dot(p);
      const dq = dot(q);
      if (Math.abs(dp - dq) > 1e-9) return dp > dq ? 'p1' : 'p2';
    }
    return dist(p, I) >= dist(q, I) ? 'p1' : 'p2';
  };
  const ka = keepEnd(a1, a2, pickA);
  const kb = keepEnd(b1, b2, pickB);
  const kept = (k, p, q) => (k === 'p1' ? p : q);
  const A = kept(ka, a1, a2);
  const B = kept(kb, b1, b2);
  const lenA = dist(A, I);
  const lenB = dist(B, I);
  if (lenA < 1e-6 || lenB < 1e-6) return { reason: 'These objects have no length on the picked side of the corner.' };
  return {
    a, b, I, ka, kb, A, B, lenA, lenB,
    dirA: { x: (A.x - I.x) / lenA, y: (A.y - I.y) / lenA },
    dirB: { x: (B.x - I.x) / lenB, y: (B.y - I.y) / lenB },
  };
}

const withEnd = (el, keep, p) => (keep === 'p1'
  ? { ...el, x2: round6(p.x), y2: round6(p.y) }
  : { ...el, x1: round6(p.x), y1: round6(p.y) });

function applyCorner(layout, refA, refB, s, pa, pb) {
  let next = replaceElement(layout, refA, withEnd(s.a, s.ka, pa));
  next = replaceElement(next, refB, withEnd(s.b, s.kb, pb));
  return reattachOpenings(layout, next);
}

/** Fillet: radius 0 makes a sharp corner; radius > 0 adds a tangent arc (lines only). */
export function filletElements(layout, refA, refB, radius = 0, pickA = null, pickB = null) {
  const s = cornerSetup(layout, refA, refB, pickA, pickB);
  if (s.reason) return result(layout, { reason: s.reason });
  const r = Number(radius) || 0;
  if (r <= 1e-9) return result(applyCorner(layout, refA, refB, s, s.I, s.I));
  if (refA.type === 'wall' || refB.type === 'wall') {
    return result(layout, { reason: 'Curved walls are not supported. Use radius 0 to make a sharp wall corner.' });
  }
  const cos = s.dirA.x * s.dirB.x + s.dirA.y * s.dirB.y;
  const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
  const d = r / Math.tan(theta / 2);
  if (d > s.lenA + 1e-6 || d > s.lenB + 1e-6) return result(layout, { reason: `The lines are too short for a ${r}' fillet.` });
  const tA = { x: s.I.x + s.dirA.x * d, y: s.I.y + s.dirA.y * d };
  const tB = { x: s.I.x + s.dirB.x * d, y: s.I.y + s.dirB.y * d };
  const bx = s.dirA.x + s.dirB.x;
  const by = s.dirA.y + s.dirB.y;
  const bl = Math.hypot(bx, by) || 1;
  const centreDist = r / Math.sin(theta / 2);
  const c = { x: s.I.x + (bx / bl) * centreDist, y: s.I.y + (by / bl) * centreDist };
  const angA = norm360(toDeg(Math.atan2(tA.y - c.y, tA.x - c.x)));
  const angB = norm360(toDeg(Math.atan2(tB.y - c.y, tB.x - c.x)));
  const [start, end] = norm360(angB - angA) <= 180 ? [angA, angB] : [angB, angA];
  const arc = { ...base('arc'), cx: round6(c.x), cy: round6(c.y), r: round6(r), start: round6(start), end: round6(end) };
  const next = appendElements(applyCorner(layout, refA, refB, s, tA, tB), 'entity', [arc]);
  return result(next, { created: [{ type: 'entity', id: arc.id }] });
}

/** Chamfer: cut the corner at the given distances and connect the two ends. */
export function chamferElements(layout, refA, refB, d1, d2 = d1, pickA = null, pickB = null) {
  const s = cornerSetup(layout, refA, refB, pickA, pickB);
  if (s.reason) return result(layout, { reason: s.reason });
  const da = Number(d1);
  const db = Number(d2);
  if (!(da > 0) || !(db > 0)) return result(layout, { reason: 'Chamfer distances must be greater than zero.' });
  if (da > s.lenA + 1e-6 || db > s.lenB + 1e-6) return result(layout, { reason: 'The chamfer is longer than the objects.' });
  const pa = { x: s.I.x + s.dirA.x * da, y: s.I.y + s.dirA.y * da };
  const pb = { x: s.I.x + s.dirB.x * db, y: s.I.y + s.dirB.y * db };
  let next = applyCorner(layout, refA, refB, s, pa, pb);
  let created;
  if (refA.type === 'wall' && refB.type === 'wall') {
    const conn = { ...s.a, id: generateUniqueId(ID_PREFIX.wall), x1: round6(pa.x), y1: round6(pa.y), x2: round6(pb.x), y2: round6(pb.y) };
    next = appendElements(next, 'wall', [conn]);
    created = { type: 'wall', id: conn.id };
  } else {
    const conn = createLineEntity(pa, pb);
    next = appendElements(next, 'entity', [conn]);
    created = { type: 'entity', id: conn.id };
  }
  return result(next, { created: [created] });
}

// ---------------------------------------------------------------------------
// Stretch
// ---------------------------------------------------------------------------

/**
 * Stretch: points inside the box move by (dx, dy), points outside stay. An
 * object entirely inside simply moves. A room's edge moves when both of that
 * edge's corners are inside, through the room solver.
 */
export function stretchInBox(layout, box, dx, dy) {
  const minX = Math.min(box.x1, box.x2);
  const maxX = Math.max(box.x1, box.x2);
  const minY = Math.min(box.y1, box.y2);
  const maxY = Math.max(box.y1, box.y2);
  const inside = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const mv = (p) => (inside(p.x, p.y) ? { x: round6(p.x + dx), y: round6(p.y + dy) } : p);
  const skipped = [];
  let changed = 0;
  let next = layout;

  for (const r of layout.rooms || []) {
    if (r.isLocked) continue;
    const l = inside(r.x, r.y) && inside(r.x, r.y + r.length);
    const rt = inside(r.x + r.width, r.y) && inside(r.x + r.width, r.y + r.length);
    const t = inside(r.x, r.y) && inside(r.x + r.width, r.y);
    const b = inside(r.x, r.y + r.length) && inside(r.x + r.width, r.y + r.length);
    if (!l && !rt && !t && !b) continue;
    const cur = (next.rooms || []).find((e) => e.id === r.id);
    if (l && rt && t && b) {
      next = moveRoom(next, r.id, dx, dy).layout;
      changed += 1;
      continue;
    }
    const targets = {};
    if (l) targets.left = cur.x + dx;
    if (rt) targets.right = cur.x + cur.width + dx;
    if (t) targets.top = cur.y + dy;
    if (b) targets.bottom = cur.y + cur.length + dy;
    const res = resizeRoom(next, r.id, targets);
    next = res.layout;
    if (res.conflicts.length) skipped.push(res.conflicts[0]);
    changed += 1;
  }

  const before = next;
  const walls = (next.walls || []).map((w) => {
    if (w.isLocked) return w;
    const a = mv({ x: w.x1, y: w.y1 });
    const b = mv({ x: w.x2, y: w.y2 });
    if (a.x === w.x1 && a.y === w.y1 && b.x === w.x2 && b.y === w.y2) return w;
    changed += 1;
    return { ...w, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
  next = reattachOpenings(before, { ...next, walls });

  const entities = (next.cadEntities || []).map((e) => {
    if (e.isLocked) return e;
    if (e.kind === 'line') {
      const a = mv({ x: e.x1, y: e.y1 });
      const b = mv({ x: e.x2, y: e.y2 });
      if (a.x === e.x1 && a.y === e.y1 && b.x === e.x2 && b.y === e.y2) return e;
      changed += 1;
      return { ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    if (e.points) {
      if (!e.points.some((p) => inside(p.x, p.y))) return e;
      changed += 1;
      return { ...e, points: e.points.map(mv), shape: e.shape === 'rect' ? 'polygon' : e.shape };
    }
    if (inside(e.cx, e.cy)) {
      changed += 1;
      return { ...e, cx: round6(e.cx + dx), cy: round6(e.cy + dy) };
    }
    return e;
  });
  next = { ...next, cadEntities: entities };

  for (const [type, key] of [['column', 'columns'], ['annotation', 'annotations'], ['parking', 'parking'], ['utility', 'utilities']]) {
    next = {
      ...next,
      [key]: (next[key] || []).map((e) => {
        if (e.isLocked) return e;
        const fully = type === 'column' || type === 'annotation'
          ? inside(e.x, e.y)
          : inside(e.x, e.y) && inside(e.x + e.width, e.y + e.length);
        if (!fully) return e;
        changed += 1;
        return { ...e, x: round6(e.x + dx), y: round6(e.y + dy) };
      }),
    };
  }
  next = {
    ...next,
    staircases: (next.staircases || []).map((s) => {
      if (s.isLocked) return s;
      const sb = getStaircaseBounds(s);
      if (!inside(sb.x, sb.y) || !inside(sb.x + sb.width, sb.y + sb.length)) return s;
      changed += 1;
      return { ...s, x: round6(s.x + dx), y: round6(s.y + dy) };
    }),
    dimensions: (next.dimensions || []).map((d) => {
      if (d.isLocked || isPlotDimension(d.id)) return d;
      const a = mv({ x: d.x1, y: d.y1 });
      const b = mv({ x: d.x2, y: d.y2 });
      if (a.x === d.x1 && a.y === d.y1 && b.x === d.x2 && b.y === d.y2) return d;
      changed += 1;
      return { ...d, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }),
  };

  return result(changed ? next : layout, {
    skipped: [...new Set(skipped)],
    changed,
    reason: changed ? null : 'Nothing has a point inside the stretch box.',
  });
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

function samePoint(a, b, tol = 0.02) {
  return dist(a, b) <= tol;
}

/** Remove vertices that lie exactly on the straight line between their neighbours. */
function simplifyPoints(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Join the selected objects where their endpoints really meet.
 * Walls must be collinear and of equal thickness. Lines and polylines chain into
 * one object; arcs merge when they share a centre, radius and an endpoint.
 */
export function joinSelection(layout, items) {
  let next = layout;
  let joinedCount = 0;

  const wallIds = items.filter((r) => r.type === 'wall').map((r) => r.id);
  for (let i = 0; i < wallIds.length; i++) {
    for (let j = i + 1; j < wallIds.length; j++) {
      if (!wallIds[j]) continue;
      const res = joinWallPair(next, wallIds[i], wallIds[j]);
      if (res.wall) {
        next = res.layout;
        wallIds.splice(j, 1);
        joinedCount += 1;
        j = i; // the merged wall may now reach another one
      }
    }
  }

  const entityOf = (id) => (next.cadEntities || []).find((e) => e.id === id);
  const ids = items.filter((r) => r.type === 'entity').map((r) => r.id).filter((id) => entityOf(id));

  // Arcs on the same circle
  const arcIds = ids.filter((id) => entityOf(id).kind === 'arc');
  for (let i = 0; i < arcIds.length; i++) {
    for (let j = 0; j < arcIds.length; j++) {
      if (i === j || !arcIds[i] || !arcIds[j]) continue;
      const a = entityOf(arcIds[i]);
      const b = entityOf(arcIds[j]);
      if (!a || !b) continue;
      const same = Math.abs(a.cx - b.cx) < 1e-3 && Math.abs(a.cy - b.cy) < 1e-3 && Math.abs(a.r - b.r) < 1e-3;
      if (same && Math.abs(norm360(a.end - b.start)) < 1e-3) {
        const merged = { ...a, end: b.end };
        next = { ...next, cadEntities: next.cadEntities.filter((e) => e.id !== b.id).map((e) => (e.id === a.id ? merged : e)) };
        arcIds[j] = null;
        joinedCount += 1;
        j = -1;
      }
    }
  }

  // Lines and open polylines
  let open = ids.filter((id) => {
    const e = entityOf(id);
    return e && (e.kind === 'line' || (e.kind === 'polyline' && !e.closed));
  });
  const ptsOf = (e) => elementPath(e, 'entity').points;
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < open.length; i++) {
      for (let j = 0; j < open.length; j++) {
        if (i === j) continue;
        const a = entityOf(open[i]);
        const b = entityOf(open[j]);
        const pa = ptsOf(a);
        const pb = ptsOf(b);
        let chain = null;
        if (samePoint(pa[pa.length - 1], pb[0])) chain = [...pa, ...pb.slice(1)];
        else if (samePoint(pa[pa.length - 1], pb[pb.length - 1])) chain = [...pa, ...[...pb].reverse().slice(1)];
        else if (samePoint(pa[0], pb[0])) chain = [...[...pa].reverse(), ...pb.slice(1)];
        if (!chain) continue;
        const simple = simplifyPoints(chain);
        const entity = rebuildFromPoints(a, 'entity', simple, a.id);
        next = { ...next, cadEntities: next.cadEntities.filter((e) => e.id !== b.id).map((e) => (e.id === a.id ? entity : e)) };
        open = open.filter((id) => id !== b.id);
        joinedCount += 1;
        merged = true;
        break outer;
      }
    }
  }

  if (joinedCount === 0) {
    return result(layout, { reason: 'Nothing could be joined: objects must touch end to end (walls must also be collinear and equally thick).' });
  }
  return result(next, { joined: joinedCount });
}

// ---------------------------------------------------------------------------
// Queries for tools
// ---------------------------------------------------------------------------

/** Nearest straight or curved element to a point, for pick-based commands. */
export function pickOutline(layout, p, tolerance, types = ['entity', 'wall']) {
  let best = null;
  for (const type of types) {
    for (const el of layout[COLLECTIONS[type]] || []) {
      const d = distanceToOutline(p, el, type);
      if (d <= tolerance && (!best || d < best.distance)) best = { type, id: el.id, distance: d };
    }
  }
  return best;
}

export { pointAtAngle };

/** Break where the user clicked; `gap` > 0 removes that length centred on the click. */
export function breakAtClick(layout, ref, click, gap = 0) {
  const el = getElement(layout, ref);
  if (!el) return result(layout, { reason: 'Click the object to break.' });
  const curve = elementCurve(el, ref.type);
  if (curve) {
    const at = toDeg(Math.atan2(click.y - el.cy, click.x - el.cx));
    const half = gap > 0 ? toDeg(gap / (2 * el.r)) : (el.kind === 'circle' ? 1e-3 : 0);
    const p1 = pointAtAngle(el, at - half);
    const p2 = pointAtAngle(el, at + half);
    return breakElement(layout, ref, p1, half > 0 ? p2 : null);
  }
  const path = elementPath(el, ref.type);
  if (!path) return result(layout, { reason: `A ${ref.type} cannot be broken.` });
  const s = projectToPath(path, click).s;
  if (gap <= 0) return breakElement(layout, ref, pointAtLength(path, s));
  const L = pathLength(path);
  return breakElement(layout, ref, pointAtLength(path, Math.max(0, s - gap / 2)), pointAtLength(path, Math.min(L, s + gap / 2)));
}
