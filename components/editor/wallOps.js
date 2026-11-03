/**
 * AutoPlot Wall & Opening Operations
 *
 * Pure functions (layout in, new layout out) for every wall, door and window
 * edit. Interactive drags pass the layout captured at pointer-down, so nothing
 * accumulates between pointer moves.
 *
 * OPENING CONVENTION
 * ------------------
 * A door / window (x, y) is the CENTRE of the opening and lies on the host
 * wall's centreline. `wallId` names the host wall. Its orientation always comes
 * from the host wall; `rotation` only applies to an opening without a host.
 */

import {
  DEFAULT_WALL_THICKNESS_IN,
  WALL_THICKNESS_OPTIONS,
  cloneLayout,
  createWall,
  feetToInches,
  findElementsOutsidePlot,
  generateUniqueId,
  getWallOrientation,
  inchesToFeet,
  joinWalls,
  splitWallAtPoint,
} from './layoutModel.js';
import { findHostWall } from './constraintEngine.js';
import { moveWallBoundary } from './roomResize.js';

export const MIN_WALL_LENGTH = 0.25; // ft
export const MIN_OPENING_WIDTH = 1; // ft
const CONNECT_TOL = 0.05;
const OPENING_GAP = 0.25; // ft of wall kept between two openings
const KEEP_WALL_MARGIN = 0.5; // ft another wall must be closer by before a dragged opening changes wall
const round4 = (v) => Math.round(v * 10000) / 10000;

const wallLen = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
const collectionOf = (kind) => (kind === 'door' ? 'doors' : 'windows');

// ---------------------------------------------------------------------------
// Opening placement
// ---------------------------------------------------------------------------

/** The wall an opening belongs to: its wallId, else the wall it sits on. */
export function getOpeningHost(opening, walls, tol = 0.6) {
  if (opening?.wallId) {
    const own = (walls || []).find((w) => w.id === opening.wallId);
    if (own) {
      const hit = findHostWall(opening, [own], tol);
      if (hit) return hit;
    }
  }
  return findHostWall(opening, walls, tol);
}

/**
 * World-space drawing geometry of a door or window, derived from its host wall.
 * The canvas and the exporters both draw from this, so they always agree.
 */
export function getOpeningGeometry(opening, walls) {
  const host = getOpeningHost(opening, walls);
  const width = Number(opening.width) || 0;
  let ux;
  let uy;
  if (host) {
    const len = wallLen(host.wall) || 1;
    ux = (host.wall.x2 - host.wall.x1) / len;
    uy = (host.wall.y2 - host.wall.y1) / len;
  } else {
    const rad = ((Number(opening.rotation) || 0) * Math.PI) / 180;
    ux = Math.cos(rad);
    uy = Math.sin(rad);
  }
  const nx = -uy;
  const ny = ux;
  const half = width / 2;
  const a = { x: opening.x - ux * half, y: opening.y - uy * half };
  const b = { x: opening.x + ux * half, y: opening.y + uy * half };
  const thickness = host ? Number(host.wall.thickness) || 0.375 : 0.375;
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  const side = opening.swing === 'outward' ? -1 : 1;

  const leaf = (hinge, free, leafWidth) => ({
    hinge,
    tip: { x: hinge.x + nx * side * leafWidth, y: hinge.y + ny * side * leafWidth },
    free,
    radius: leafWidth,
  });
  const leaves = [];
  if (opening.type === 'double') {
    const mid = { x: opening.x, y: opening.y };
    leaves.push(leaf(a, mid, half), leaf(b, mid, half));
  } else if (opening.type !== 'sliding') {
    leaves.push(opening.hinge === 'right' ? leaf(b, a, width) : leaf(a, b, width));
  }
  return { a, b, ux, uy, nx: nx * side, ny: ny * side, thickness, angle, width, leaves, hostId: host ? host.wall.id : null };
}

/** Occupied [start, end] spans (ft along the wall) of the other openings on a wall. */
function occupiedSpans(layout, wall, excludeId, ignoreIds = null) {
  const len = wallLen(wall);
  const spans = [];
  for (const o of [...(layout.doors || []), ...(layout.windows || [])]) {
    if (o.id === excludeId || ignoreIds?.has(o.id)) continue;
    const host = getOpeningHost(o, [wall], 0.05);
    if (!host) continue;
    const c = host.t * len;
    const h = (Number(o.width) || 0) / 2;
    spans.push([c - h, c + h]);
  }
  return spans.sort((p, q) => p[0] - q[0]);
}

/** Closest centre to `wanted` where an opening fits on the wall, or null. */
function resolveCentreOnWall(layout, wall, wanted, width, excludeId, ignoreIds = null) {
  const len = wallLen(wall);
  if (width > len + 1e-6) return null;
  const half = width / 2;
  const lo = half;
  const hi = len - half;
  const spans = occupiedSpans(layout, wall, excludeId, ignoreIds);
  // Free intervals for the centre point
  const free = [];
  let cursor = lo;
  for (const [s, e] of spans) {
    const end = s - OPENING_GAP - half;
    if (end >= cursor - 1e-9) free.push([cursor, end]);
    cursor = Math.max(cursor, e + OPENING_GAP + half);
  }
  if (cursor <= hi + 1e-9) free.push([cursor, hi]);
  let best = null;
  for (const [s, e] of free) {
    const c = Math.max(s, Math.min(e, wanted));
    if (best === null || Math.abs(c - wanted) < Math.abs(best - wanted)) best = c;
  }
  return best;
}

/**
 * Where an opening goes when the pointer is at `point`: the nearest wall within
 * `maxDist`, clamped inside the wall and clear of other openings.
 * @param {boolean} [options.nearestOnly] use only the closest wall, so a drag never
 *   jumps to some other wall just because the closest one has no room
 * @param {Set<string>} [options.ignoreIds] openings that do not count as obstacles
 * @param {string} [options.preferWallId] stay on this wall unless another is clearly closer
 * @returns {{x,y,wallId,rotation}|null}
 */
export function placeOpeningOnWall(layout, opening, point, { maxDist = 1.5, onlyWallId = null, nearestOnly = false, ignoreIds = null, preferWallId = null } = {}) {
  const width = Number(opening.width) || 0;
  const candidates = [];
  for (const w of layout.walls || []) {
    if (onlyWallId && w.id !== onlyWallId) continue;
    const len = wallLen(w);
    if (len < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((point.x - w.x1) * (w.x2 - w.x1) + (point.y - w.y1) * (w.y2 - w.y1)) / (len * len)));
    const px = w.x1 + t * (w.x2 - w.x1);
    const py = w.y1 + t * (w.y2 - w.y1);
    const d = Math.hypot(point.x - px, point.y - py);
    if (d <= maxDist) candidates.push({ w, d, along: t * len, len });
  }
  // Grid snapping moves the pointer slightly, which must not hop an opening onto
  // a neighbouring wall a fraction of an inch away.
  const rank = (c) => (c.w.id === preferWallId ? Math.max(0, c.d - KEEP_WALL_MARGIN) : c.d);
  candidates.sort((p, q) => rank(p) - rank(q));
  for (const { w, along, len } of nearestOnly ? candidates.slice(0, 1) : candidates) {
    const c = resolveCentreOnWall(layout, w, along, width, opening.id, ignoreIds);
    if (c === null) continue;
    const t = c / len;
    return {
      x: round4(w.x1 + t * (w.x2 - w.x1)),
      y: round4(w.y1 + t * (w.y2 - w.y1)),
      wallId: w.id,
      rotation: Math.round((Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI),
    };
  }
  return null;
}

function replaceOpening(layout, kind, id, patch) {
  const key = collectionOf(kind);
  return { ...layout, [key]: (layout[key] || []).map((o) => (o.id === id ? { ...o, ...patch } : o)) };
}

/** Openings already overlapping this one, on the wall it sits on. */
function openingsOverlapping(layout, o) {
  const host = getOpeningHost(o, layout.walls);
  if (!host) return new Set();
  const halfWidth = (Number(o.width) || 0) / 2;
  const centre = host.t * wallLen(host.wall);
  const ids = new Set();
  for (const other of [...(layout.doors || []), ...(layout.windows || [])]) {
    if (other.id === o.id) continue;
    const onWall = getOpeningHost(other, [host.wall], 0.05);
    if (!onWall) continue;
    const reach = halfWidth + (Number(other.width) || 0) / 2;
    if (Math.abs(onWall.t * wallLen(host.wall) - centre) < reach) ids.add(other.id);
  }
  return ids;
}

/**
 * Drag / reposition an opening; it can only sit on a wall. Openings it already
 * overlaps don't block it, or stacked openings could never be pulled apart.
 */
export function moveOpening(layout, kind, id, point, options = {}) {
  const o = (layout[collectionOf(kind)] || []).find((e) => e.id === id);
  if (!o) return { layout, moved: false, reason: 'Opening not found.' };
  if (o.isLocked) return { layout, moved: false, reason: 'This opening is locked.' };
  const place = placeOpeningOnWall(layout, o, point, {
    preferWallId: getOpeningHost(o, layout.walls)?.wall.id ?? null,
    ...options,
    ignoreIds: openingsOverlapping(layout, o),
  });
  if (!place) return { layout, moved: false, reason: 'A door or window must sit on a wall with enough free length.' };
  return { layout: replaceOpening(layout, kind, id, place), moved: true, reason: null };
}

/** Set the distance (ft) from the host wall's start to the opening's centre. */
export function setOpeningPosition(layout, kind, id, distance) {
  const o = (layout[collectionOf(kind)] || []).find((e) => e.id === id);
  const host = o && getOpeningHost(o, layout.walls);
  if (!host) return { layout, moved: false, reason: 'This opening has no host wall.' };
  const w = host.wall;
  const len = wallLen(w);
  const t = Math.max(0, Math.min(1, distance / len));
  return moveOpening(layout, kind, id, { x: w.x1 + t * (w.x2 - w.x1), y: w.y1 + t * (w.y2 - w.y1) }, { onlyWallId: w.id, maxDist: Infinity });
}

/** Distance from the host wall's start to the opening's centre. */
export function getOpeningPosition(opening, walls) {
  const host = getOpeningHost(opening, walls);
  return host ? host.t * wallLen(host.wall) : 0;
}

/**
 * Change an opening's width. `fixedEnd` keeps one jamb still ('a' = towards the
 * wall start, 'b' = towards the wall end); otherwise the centre stays.
 * Stops at the wall ends and at neighbouring openings.
 */
export function resizeOpening(layout, kind, id, newWidth, fixedEnd = null) {
  const o = (layout[collectionOf(kind)] || []).find((e) => e.id === id);
  if (!o) return { layout, reason: 'Opening not found.' };
  if (o.isLocked) return { layout, reason: 'This opening is locked.' };
  let width = Math.max(MIN_OPENING_WIDTH, Number(newWidth) || 0);
  const host = getOpeningHost(o, layout.walls);
  if (!host) return { layout: replaceOpening(layout, kind, id, { width: round4(width) }), reason: null };
  const w = host.wall;
  const len = wallLen(w);
  const centre = host.t * len;
  const half = (Number(o.width) || 0) / 2;
  const startJamb = centre - half;
  const endJamb = centre + half;
  const spans = occupiedSpans(layout, w, id);
  const limitLo = Math.max(0, ...spans.filter((s) => s[1] <= startJamb + 1e-6).map((s) => s[1] + OPENING_GAP));
  const hiCandidates = spans.filter((s) => s[0] >= endJamb - 1e-6).map((s) => s[0] - OPENING_GAP);
  const limitHi = Math.min(len, ...hiCandidates);

  let reason = null;
  let c;
  if (fixedEnd === 'a') {
    const allowed = limitHi - startJamb;
    if (width > allowed) { width = allowed; reason = 'Stopped at the end of the wall or the next opening.'; }
    c = startJamb + width / 2;
  } else if (fixedEnd === 'b') {
    const allowed = endJamb - limitLo;
    if (width > allowed) { width = allowed; reason = 'Stopped at the end of the wall or the next opening.'; }
    c = endJamb - width / 2;
  } else {
    const allowed = limitHi - limitLo;
    if (width > allowed) { width = allowed; reason = 'Stopped at the end of the wall or the next opening.'; }
    c = Math.max(limitLo + width / 2, Math.min(limitHi - width / 2, centre));
  }
  const t = c / len;
  return {
    layout: replaceOpening(layout, kind, id, {
      width: round4(width),
      x: round4(w.x1 + t * (w.x2 - w.x1)),
      y: round4(w.y1 + t * (w.y2 - w.y1)),
      wallId: w.id,
    }),
    reason,
  };
}

/**
 * Keep openings on their host walls after walls changed. An opening keeps its
 * distance from the wall end that did not move (from the start when both moved)
 * and is slid back inside the wall when the wall got shorter.
 */
export function reattachOpenings(before, after) {
  const beforeWalls = before.walls || [];
  const afterById = new Map((after.walls || []).map((w) => [w.id, w]));
  const update = (list) => (list || []).map((o) => {
    if (o.isLocked) return o;
    const host = getOpeningHost(o, beforeWalls);
    if (!host) return o;
    const was = host.wall;
    const now = afterById.get(was.id);
    if (!now) return o;
    const lenNow = wallLen(now);
    if (lenNow < 1e-6) return o;
    const startStill = Math.hypot(was.x1 - now.x1, was.y1 - now.y1) < 1e-6;
    const endStill = Math.hypot(was.x2 - now.x2, was.y2 - now.y2) < 1e-6;
    if (startStill && endStill && o.wallId === was.id) return o;
    const along = host.t * wallLen(was);
    let c = endStill && !startStill ? lenNow - (wallLen(was) - along) : along;
    const half = (Number(o.width) || 0) / 2;
    if (half * 2 <= lenNow) c = Math.max(half, Math.min(lenNow - half, c));
    const t = c / lenNow;
    return { ...o, wallId: was.id, x: round4(now.x1 + t * (now.x2 - now.x1)), y: round4(now.y1 + t * (now.y2 - now.y1)) };
  });
  return { ...after, doors: update(after.doors), windows: update(after.windows) };
}

// ---------------------------------------------------------------------------
// Wall edits
// ---------------------------------------------------------------------------

/**
 * Move every wall end joined at `from` to `to`, except where that would tilt an
 * axis-aligned wall while diagonal walls are off: a perpendicular neighbour then
 * keeps its position rather than silently becoming diagonal.
 */
function followConnected(walls, from, to, excludeId, allowDiagonal) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return walls.map((w) => {
    if (w.id === excludeId) return w;
    const atStart = Math.hypot(w.x1 - from.x, w.y1 - from.y) <= CONNECT_TOL;
    const atEnd = Math.hypot(w.x2 - from.x, w.y2 - from.y) <= CONNECT_TOL;
    if (!atStart && !atEnd) return w;
    if (!allowDiagonal) {
      const o = getWallOrientation(w, 0.02);
      if (o === 'horizontal' && Math.abs(dy) > 1e-6) return w;
      if (o === 'vertical' && Math.abs(dx) > 1e-6) return w;
    }
    return atStart ? { ...w, x1: round4(to.x), y1: round4(to.y) } : { ...w, x2: round4(to.x), y2: round4(to.y) };
  });
}

/**
 * Move one wall endpoint to a world point. The opposite endpoint never moves.
 * With diagonal walls off, an axis-aligned wall keeps its axis.
 * @param {'p1'|'p2'} which
 */
export function moveWallEndpointTo(layout, wallId, which, point, { allowDiagonal = false } = {}) {
  const wall = (layout.walls || []).find((w) => w.id === wallId);
  if (!wall) return { layout, reason: 'Wall not found.' };
  if (wall.isLocked) return { layout, reason: 'This wall is locked.' };
  const orient = getWallOrientation(wall, 0.02);
  const orig = which === 'p1' ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
  const fixed = which === 'p1' ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
  const target = { x: Number(point.x), y: Number(point.y) };
  if (!allowDiagonal) {
    if (orient === 'horizontal') target.y = orig.y;
    if (orient === 'vertical') target.x = orig.x;
  }
  if (Math.hypot(target.x - fixed.x, target.y - fixed.y) < MIN_WALL_LENGTH) {
    return { layout, reason: `A wall must be at least ${MIN_WALL_LENGTH}' long.` };
  }
  const moved = which === 'p1'
    ? { ...wall, x1: round4(target.x), y1: round4(target.y) }
    : { ...wall, x2: round4(target.x), y2: round4(target.y) };
  const others = followConnected(layout.walls, orig, target, wallId, allowDiagonal);
  const next = { ...layout, walls: others.map((w) => (w.id === wallId ? moved : w)) };
  return { layout: reattachOpenings(layout, next), reason: null };
}

/** Numeric length: keeps the start ('start') or end ('end') of the wall fixed. */
export function setWallLength(layout, wallId, length, anchor = 'start') {
  const wall = (layout.walls || []).find((w) => w.id === wallId);
  if (!wall) return { layout, reason: 'Wall not found.' };
  const len = wallLen(wall);
  if (len < 1e-6) return { layout, reason: 'This wall has no direction.' };
  if (!(length >= MIN_WALL_LENGTH)) return { layout, reason: `A wall must be at least ${MIN_WALL_LENGTH}' long.` };
  const ux = (wall.x2 - wall.x1) / len;
  const uy = (wall.y2 - wall.y1) / len;
  if (anchor === 'end') {
    return moveWallEndpointTo(layout, wallId, 'p1', { x: wall.x2 - ux * length, y: wall.y2 - uy * length }, { allowDiagonal: true });
  }
  return moveWallEndpointTo(layout, wallId, 'p2', { x: wall.x1 + ux * length, y: wall.y1 + uy * length }, { allowDiagonal: true });
}

/**
 * Drag a wall body by a world delta. A room boundary goes through the room
 * solver (rooms follow, constraints apply). A free-standing wall translates;
 * while it is joined to other walls and diagonals are off, an axis-aligned wall
 * only moves perpendicular to itself so its neighbours stay straight.
 */
export function moveWallBody(layout, wallId, dx, dy, { allowDiagonal = false } = {}) {
  const wall = (layout.walls || []).find((w) => w.id === wallId);
  if (!wall) return { layout, reason: 'Wall not found.', clamped: false };
  if (wall.isLocked) return { layout, reason: 'This wall is locked.', clamped: true };
  const orient = getWallOrientation(wall, 0.02);
  if (orient !== 'diagonal') {
    const res = moveWallBoundary(layout, wallId, orient === 'vertical' ? dx : dy);
    if (res) return { layout: res.layout, reason: res.clamped ? res.reason : null, clamped: !!res.clamped };
  }
  let mx = dx;
  let my = dy;
  const joined = (p) => (layout.walls || []).some((w) => w.id !== wallId && (
    Math.hypot(w.x1 - p.x, w.y1 - p.y) <= CONNECT_TOL || Math.hypot(w.x2 - p.x, w.y2 - p.y) <= CONNECT_TOL));
  const a = { x: wall.x1, y: wall.y1 };
  const b = { x: wall.x2, y: wall.y2 };
  if (!allowDiagonal && (joined(a) || joined(b))) {
    if (orient === 'horizontal') mx = 0;
    if (orient === 'vertical') my = 0;
  }
  const na = { x: a.x + mx, y: a.y + my };
  const nb = { x: b.x + mx, y: b.y + my };
  let walls = followConnected(layout.walls, a, na, wallId, allowDiagonal);
  walls = followConnected(walls, b, nb, wallId, allowDiagonal);
  walls = walls.map((w) => (w.id === wallId
    ? { ...w, x1: round4(na.x), y1: round4(na.y), x2: round4(nb.x), y2: round4(nb.y) } : w));
  return { layout: reattachOpenings(layout, { ...layout, walls }), reason: null, clamped: false };
}

/** Patch wall properties (type, thickness in feet) as a single edit. */
export function setWallProps(layout, wallId, patch) {
  const full = patch.thickness !== undefined ? { ...patch, thicknessInches: feetToInches(patch.thickness) } : patch;
  return { ...layout, walls: (layout.walls || []).map((w) => (w.id === wallId ? { ...w, ...full } : w)) };
}

/** Do two walls lie along the same line and overlap, making them one physical wall? */
function wallsOverlap(a, b) {
  const len = wallLen(a);
  if (len < 1e-6) return false;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const offLine = (x, y) => Math.abs((x - a.x1) * uy - (y - a.y1) * ux);
  if (offLine(b.x1, b.y1) > CONNECT_TOL || offLine(b.x2, b.y2) > CONNECT_TOL) return false;
  const along = (x, y) => (x - a.x1) * ux + (y - a.y1) * uy;
  const s1 = along(b.x1, b.y1);
  const s2 = along(b.x2, b.y2);
  return Math.min(len, Math.max(s1, s2)) - Math.max(0, Math.min(s1, s2)) > CONNECT_TOL;
}

/**
 * Set a wall's thickness. The centreline stays where it is, so length, direction,
 * connections, hosted openings and room dimensions are all preserved. Generated
 * layouts can hold several segments along one physical wall; those overlapping
 * segments change together, or the wall would keep its old thickness on screen.
 * @param {number} inches one of WALL_THICKNESS_OPTIONS
 * @returns {{layout:object, updatedIds:string[], outside:boolean, reason:string|null}}
 */
export function setWallThickness(layout, wallId, inches) {
  const walls = layout.walls || [];
  const target = walls.find((w) => w.id === wallId);
  if (!target) return { layout, updatedIds: [], outside: false, reason: 'Wall not found.' };
  if (target.isLocked) return { layout, updatedIds: [], outside: false, reason: 'This wall is locked.' };
  if (!WALL_THICKNESS_OPTIONS.includes(inches)) {
    return { layout, updatedIds: [], outside: false, reason: `Wall thickness must be one of ${WALL_THICKNESS_OPTIONS.join(', ')} inches.` };
  }

  const ids = new Set([wallId]);
  const queue = [target];
  while (queue.length) {
    const current = queue.pop();
    for (const w of walls) {
      if (!ids.has(w.id) && !w.isLocked && wallsOverlap(current, w)) {
        ids.add(w.id);
        queue.push(w);
      }
    }
  }

  const feet = inchesToFeet(inches);
  const needsChange = (w) => ids.has(w.id) && (w.thickness !== feet || w.thicknessInches !== inches);
  if (!walls.some(needsChange)) return { layout, updatedIds: [], outside: false, reason: null };

  const next = { ...layout, walls: walls.map((w) => (needsChange(w) ? { ...w, thickness: feet, thicknessInches: inches } : w)) };
  const outside = findElementsOutsidePlot(next).some((o) => o.type === 'wall' && ids.has(o.id));
  return { layout: next, updatedIds: [...ids], outside, reason: null };
}

const PERPENDICULAR_DOT = 0.2; // within about 11.5 degrees of square
const COLLINEAR_DOT = 0.98;

/**
 * The real outline of a wall: a rectangle around its centreline, with its true
 * thickness and length. At a square corner each wall runs on to the other's
 * outer face, so the outside corner is closed with no notch or overlap. An angled
 * junction gets a round joint for the same reason.
 * @returns {{polygon:{x:number,y:number}[], joints:{x:number,y:number,r:number}[]}}
 */
export function getWallShape(wall, walls = []) {
  const len = wallLen(wall);
  if (len < 1e-6) return { polygon: [], joints: [] };
  const ux = (wall.x2 - wall.x1) / len;
  const uy = (wall.y2 - wall.y1) / len;
  const half = (Number(wall.thickness) || 0) / 2;
  const joints = [];

  // How far the wall runs past this end to meet a square corner's outer face.
  const endExtension = (px, py, outX, outY) => {
    const square = [];
    let continues = false;
    let angled = false;
    for (const other of walls) {
      if (other.id === wall.id) continue;
      const atStart = Math.hypot(other.x1 - px, other.y1 - py) <= CONNECT_TOL;
      const atEnd = Math.hypot(other.x2 - px, other.y2 - py) <= CONNECT_TOL;
      if (!atStart && !atEnd) continue;
      const otherLen = wallLen(other);
      if (otherLen < 1e-6) continue;
      const sign = atStart ? 1 : -1;
      const vx = (sign * (other.x2 - other.x1)) / otherLen;
      const vy = (sign * (other.y2 - other.y1)) / otherLen;
      const dot = vx * outX + vy * outY;
      if (dot > COLLINEAR_DOT) continues = true;
      else if (Math.abs(dot) < PERPENDICULAR_DOT) square.push({ vx, vy, half: (Number(other.thickness) || 0) / 2 });
      else if (dot >= -COLLINEAR_DOT) angled = true;
    }
    if (angled) joints.push({ x: px, y: py, r: half });
    if (continues || square.length === 0) return 0;
    // Square walls on both sides form a T that this wall butts into.
    const throughWall = square.some((a) => square.some((b) => a.vx * b.vx + a.vy * b.vy < 0));
    return throughWall ? 0 : Math.max(...square.map((s) => s.half));
  };

  const extStart = endExtension(wall.x1, wall.y1, -ux, -uy);
  const extEnd = endExtension(wall.x2, wall.y2, ux, uy);
  const sx = wall.x1 - ux * extStart;
  const sy = wall.y1 - uy * extStart;
  const ex = wall.x2 + ux * extEnd;
  const ey = wall.y2 + uy * extEnd;
  const nx = -uy * half;
  const ny = ux * half;
  return {
    polygon: [
      { x: sx + nx, y: sy + ny },
      { x: ex + nx, y: ey + ny },
      { x: ex - nx, y: ey - ny },
      { x: sx - nx, y: sy - ny },
    ],
    joints,
  };
}

/** Outline of every wall, keyed by wall id. */
export function getWallShapes(walls = []) {
  const shapes = new Map();
  for (const w of walls) shapes.set(w.id, getWallShape(w, walls));
  return shapes;
}

/** Split a wall at a point on it. Hosted openings move to the segment they sit on. */
export function splitWall(layout, wallId, point) {
  const wall = (layout.walls || []).find((w) => w.id === wallId);
  if (!wall) return { layout, segments: null, reason: 'Wall not found.' };
  const len = wallLen(wall);
  const raw = point || { x: (wall.x1 + wall.x2) / 2, y: (wall.y1 + wall.y2) / 2 };
  const t = len > 0 ? ((raw.x - wall.x1) * (wall.x2 - wall.x1) + (raw.y - wall.y1) * (wall.y2 - wall.y1)) / (len * len) : 0;
  const along = t * len;
  if (along < MIN_WALL_LENGTH || len - along < MIN_WALL_LENGTH) {
    return { layout, segments: null, reason: `Both pieces must be at least ${MIN_WALL_LENGTH}' long.` };
  }
  const split = { x: round4(wall.x1 + t * (wall.x2 - wall.x1)), y: round4(wall.y1 + t * (wall.y2 - wall.y1)) };
  const segments = splitWallAtPoint(wall, split);
  const nextWalls = (layout.walls || []).flatMap((w) => (w.id === wallId ? segments : [w]));
  const rehome = (list) => (list || []).map((o) => {
    const host = getOpeningHost(o, [wall]);
    if (!host) return o;
    const c = host.t * len;
    const seg = c <= along ? segments[0] : segments[1];
    const segStart = c <= along ? 0 : along;
    const segLen = wallLen(seg);
    const half = (Number(o.width) || 0) / 2;
    const local = half * 2 <= segLen ? Math.max(half, Math.min(segLen - half, c - segStart)) : (c - segStart);
    const st = local / segLen;
    return { ...o, wallId: seg.id, x: round4(seg.x1 + st * (seg.x2 - seg.x1)), y: round4(seg.y1 + st * (seg.y2 - seg.y1)) };
  });
  return {
    layout: { ...layout, walls: nextWalls, doors: rehome(layout.doors), windows: rehome(layout.windows) },
    segments,
    reason: null,
  };
}

/** Join two compatible walls (same thickness, collinear, touching). */
export function joinWallPair(layout, idA, idB) {
  const a = (layout.walls || []).find((w) => w.id === idA);
  const b = (layout.walls || []).find((w) => w.id === idB);
  if (!a || !b) return { layout, wall: null, reason: 'Wall not found.' };
  const joined = joinWalls(a, b);
  if (!joined) return { layout, wall: null, reason: 'These walls cannot be joined: they must be collinear, share an endpoint and have the same thickness.' };
  const walls = (layout.walls || []).filter((w) => w.id !== idB).map((w) => (w.id === idA ? joined : w));
  const rehome = (list) => (list || []).map((o) => (o.wallId === idB || o.wallId === idA ? { ...o, wallId: idA } : o));
  return { layout: { ...layout, walls, doors: rehome(layout.doors), windows: rehome(layout.windows) }, wall: joined, reason: null };
}

/** New wall between two points, or null when the points coincide. */
export function buildWall(start, end, params = {}) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_WALL_LENGTH) return null;
  const thickness = params.thickness === undefined && params.thicknessInches === undefined ? { thicknessInches: DEFAULT_WALL_THICKNESS_IN } : {};
  return createWall({ id: generateUniqueId('wall'), type: 'interior', ...thickness, ...params, x1: round4(start.x), y1: round4(start.y), x2: round4(end.x), y2: round4(end.y) });
}

/** Constrain a draw / drag point to horizontal or vertical from `from`. */
export function orthoPoint(from, point) {
  return Math.abs(point.x - from.x) >= Math.abs(point.y - from.y)
    ? { x: point.x, y: from.y }
    : { x: from.x, y: point.y };
}

export { cloneLayout };
