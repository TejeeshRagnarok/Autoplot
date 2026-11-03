/**
 * AutoPlot Constraint-Based Site Reflow Engine
 *
 * Deterministically updates the whole drawing when the site boundary or the
 * setbacks change.
 *
 * HOW IT WORKS (per axis, X then Y)
 * ---------------------------------
 * 1. The building extent is the bounding box of the rooms (or walls when
 *    there are no rooms). Every room edge, and every staircase edge inside the
 *    building, becomes a "grid line". The gaps between consecutive grid lines
 *    are intervals.
 * 2. An interval is RIGID when any room/staircase covering it is fixed,
 *    anchored, locked or has that dimension locked. Other intervals stretch.
 * 3. The required size change is distributed across stretchable intervals
 *    in proportion to their length ("water-filling"), never pushing a flexible
 *    room past its min/max along that axis.
 * 4. Every coordinate in the building (room edges, wall endpoints, door and
 *    window positions, staircase positions, linked dimensions, columns,
 *    annotations) is passed through the same monotone piecewise-linear map.
 *    Because one map moves everything, shared walls stay shared, corners stay
 *    connected, rooms never gain gaps or overlaps, and openings stay on their
 *    host walls. Entity IDs never change.
 * 5. Objects outside the building (in the setback zones - utilities, external
 *    staircase, parking) follow their anchor, or the nearest plot edge.
 * 6. Anything that cannot be satisfied is reported as a conflict. Nothing is
 *    deleted and step counts are never changed.
 *
 * Coordinates: feet, origin at the plot's north-west corner, +x east, +y south.
 * When the west (left) or north (top) edge is dragged, the opposite edge keeps
 * its physical position, which in plot coordinates means existing content is
 * shifted by the size change.
 */

import {
  getStaircaseBounds,
  normalizeStaircase,
  stairDimensionForAxis,
} from './staircaseGeometry.js';

export const CONSTRAINT_TYPES = {
  FIXED: 'fixed',
  ANCHORED: 'anchored',
  FLEXIBLE: 'flexible',
  LOCKED: 'locked',
};

export const ANCHOR_TYPES = {
  TOP_LEFT: 'top-left',
  TOP: 'top',
  TOP_RIGHT: 'top-right',
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM: 'bottom',
  BOTTOM_RIGHT: 'bottom-right',
  NONE: 'none',
};

export const MIN_PLOT_DIMENSION = 5;
const EPS = 1e-6;
const FILL_TOLERANCE = 0.6; // ft - building counts as "filling" the buildable area
const round4 = (v) => Math.round(v * 10000) / 10000;
const clone = (o) => JSON.parse(JSON.stringify(o));

// Typical minimum clear dimension by room type (ft). Used only when a room has
// no explicit minWidth / minLength. These are drafting defaults, not code rules.
const ROOM_TYPE_MINIMUMS = [
  [/master/, 10],
  [/bed/, 9],
  [/living|hall|drawing/, 10],
  [/dining/, 8],
  [/kitchen/, 7],
  [/study|office/, 7],
  [/bath|toilet|wc/, 4],
  [/pooja|puja|prayer/, 4],
  [/store|utility|wash/, 4],
  [/balcony|sit.?out|verandah|porch/, 3],
  [/parking|garage/, 8],
];

export function getRoomTypeMinimum(room) {
  const name = `${room?.roomType || ''} ${room?.name || ''} ${room?.label || ''}`.toLowerCase();
  for (const [re, min] of ROOM_TYPE_MINIMUMS) if (re.test(name)) return min;
  return 6;
}

/** Default constraint type for a room from its name/type. */
export function inferRoomConstraintType(room) {
  if (room?.isLocked) return CONSTRAINT_TYPES.LOCKED;
  const name = `${room?.roomType || ''} ${room?.name || ''} ${room?.label || ''}`.toLowerCase();
  if (/bath|toilet|wc|pooja|puja|store|utility|lift|stair/.test(name)) return CONSTRAINT_TYPES.FIXED;
  return CONSTRAINT_TYPES.FLEXIBLE;
}

/**
 * Resolve the effective constraints of a room.
 * @returns {{constraintType, anchor, minWidth, maxWidth, minLength, maxLength, lockWidth, lockLength}}
 */
export function inferObjectConstraints(obj) {
  const constraintType = obj?.isLocked ? CONSTRAINT_TYPES.LOCKED : (obj?.constraintType || inferRoomConstraintType(obj));
  const typeMin = getRoomTypeMinimum(obj);
  const w = Number(obj?.width) || 0;
  const l = Number(obj?.length) || 0;
  const pick = (v, d) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    constraintType,
    anchor: obj?.anchor || ANCHOR_TYPES.NONE,
    minWidth: pick(obj?.minWidth, Math.min(w, typeMin)),
    maxWidth: pick(obj?.maxWidth, Infinity),
    minLength: pick(obj?.minLength, Math.min(l, typeMin)),
    maxLength: pick(obj?.maxLength, Infinity),
    lockWidth: !!obj?.lockWidth,
    lockLength: !!obj?.lockLength,
  };
}

/** Interpret the legacy `edge` option into per-axis behaviour. */
function resolveEdges(options) {
  const edge = options.edge || 'right';
  if (options.isSymmetric || edge === 'symmetric') return { ex: 'both', ey: 'both' };
  let ex = options.edgeX || 'right';
  let ey = options.edgeY || 'bottom';
  if (edge === 'left') ex = 'left';
  if (edge === 'right') ex = 'right';
  if (edge === 'top') ey = 'top';
  if (edge === 'bottom') ey = 'bottom';
  if (edge.startsWith('corner-')) {
    const c = edge.slice(7);
    ex = c.includes('w') ? 'left' : 'right';
    ey = c.includes('n') ? 'top' : 'bottom';
  }
  return { ex, ey };
}

function readSetbacks(sb) {
  return {
    north: Number(sb?.north) || 0,
    south: Number(sb?.south) || 0,
    east: Number(sb?.east) || 0,
    west: Number(sb?.west) || 0,
  };
}

/**
 * Water-filling distribution of `total` (signed) over intervals.
 * caps[i] is the maximum absolute change for interval i (0 = rigid).
 * Returns the per-interval signed deltas.
 */
function distribute(total, lengths, caps) {
  const n = lengths.length;
  const deltas = new Array(n).fill(0);
  let remaining = Math.abs(total);
  const sign = total < 0 ? -1 : 1;
  let active = [];
  for (let i = 0; i < n; i++) if (caps[i] > EPS) active.push(i);

  for (let iter = 0; iter < 100 && remaining > EPS && active.length > 0; iter++) {
    // Weight by length so long spaces absorb more; zero-length intervals get a tiny weight.
    const weights = active.map((i) => Math.max(lengths[i], 1e-3));
    const wsum = weights.reduce((a, b) => a + b, 0);
    let overflowed = false;
    const nextActive = [];
    let used = 0;
    active.forEach((i, k) => {
      const want = (remaining * weights[k]) / wsum;
      const room = caps[i] - deltas[i];
      if (want >= room - EPS) {
        deltas[i] += room;
        used += room;
        overflowed = true;
      } else {
        nextActive.push(i);
      }
    });
    if (!overflowed) {
      active.forEach((i, k) => {
        const want = (remaining * weights[k]) / wsum;
        deltas[i] += want;
        used += want;
      });
      remaining -= used;
      break;
    }
    remaining -= used;
    active = nextActive;
  }
  return deltas.map((d) => d * sign);
}

/**
 * Build the members (things with extent) along one axis.
 */
function collectAxisMembers(layout, axis, relaxFixed) {
  const isX = axis === 'x';
  const pos = isX ? 'x' : 'y';
  const dim = isX ? 'width' : 'length';
  const members = [];

  for (const r of layout.rooms || []) {
    const c = inferObjectConstraints(r);
    const size = Number(r[dim]) || 0;
    const lockedAxis = isX ? c.lockWidth : c.lockLength;
    let rigid = c.constraintType === CONSTRAINT_TYPES.LOCKED || lockedAxis ||
      ((c.constraintType === CONSTRAINT_TYPES.FIXED || c.constraintType === CONSTRAINT_TYPES.ANCHORED) && !relaxFixed);
    let min = isX ? c.minWidth : c.minLength;
    if (relaxFixed && !rigid && c.constraintType !== CONSTRAINT_TYPES.FLEXIBLE) {
      // Relaxed: fixed rooms may shrink down to the type minimum.
      min = Math.min(size, getRoomTypeMinimum(r));
    }
    members.push({
      kind: 'room',
      id: r.id,
      name: r.name || r.label || 'Room',
      start: Number(r[pos]) || 0,
      end: (Number(r[pos]) || 0) + size,
      rigid,
      min: Math.max(0, Math.min(min, size)),
      max: Math.max(size, isX ? c.maxWidth : c.maxLength),
    });
  }
  return members;
}

function stairMember(s, axis) {
  const b = getStaircaseBounds(s);
  const isX = axis === 'x';
  const start = isX ? b.x : b.y;
  const size = isX ? b.width : b.length;
  const localDim = stairDimensionForAxis(s, axis);
  const flexible = s.constraintType === CONSTRAINT_TYPES.FLEXIBLE && !s.isLocked;
  const min = Number(s[localDim === 'width' ? 'minWidth' : 'minLength']);
  const max = Number(s[localDim === 'width' ? 'maxWidth' : 'maxLength']);
  return {
    kind: 'staircase',
    id: s.id,
    name: s.label || 'Staircase',
    start,
    end: start + size,
    rigid: !flexible,
    min: Number.isFinite(min) && min > 0 ? Math.min(min, size) : size,
    max: Number.isFinite(max) && max > 0 ? Math.max(max, size) : size,
  };
}

function rectsOverlap(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0) > 0.01;
}

/**
 * Solve one axis. Returns the coordinate map and any conflicts.
 */
function solveAxis(layout, axis, ctx) {
  const isX = axis === 'x';
  const { P0, P1, lo0, hi0, lo1, hi1, edge, relaxFixed } = ctx;
  const conflicts = [];
  const warnings = [];
  const dP = P1 - P0;
  const shift = edge === 'left' || edge === 'top' ? dP : (edge === 'both' ? dP / 2 : 0);
  const F0 = [lo0, P0 - hi0];
  const F1 = [lo1, P1 - hi1];
  const axisName = isX ? 'width' : 'length';

  // Plot-edge attachment for things outside the building.
  const outsideMap = (p, b0, b1) => {
    if (p <= b0) return p; // follows the low (west / north) plot edge
    if (p >= b1) return p + dP; // follows the high (east / south) plot edge
    return p + shift;
  };

  const members = collectAxisMembers(layout, axis, relaxFixed);
  let b0;
  let b1;
  if (members.length > 0) {
    b0 = Math.min(...members.map((m) => m.start));
    b1 = Math.max(...members.map((m) => m.end));
  } else {
    const pts = [];
    for (const w of layout.walls || []) pts.push(isX ? w.x1 : w.y1, isX ? w.x2 : w.y2);
    if (pts.length === 0) {
      // Nothing structural: every point simply follows the nearest plot edge.
      const map = (p) => round4(p < P0 / 2 ? p : p + dP);
      return { map, building: null, conflicts, warnings, shift, dP, outsideMap: (p) => map(p) };
    }
    b0 = Math.min(...pts);
    b1 = Math.max(...pts);
  }

  // Staircases inside the building take part in the solve (rigid by default).
  for (const s of layout.staircases || []) {
    if (stairInsideRooms(layout, s)) members.push(stairMember(s, axis));
  }

  const size0 = b1 - b0;
  const fills = Math.abs(b0 - F0[0]) <= FILL_TOLERANCE && Math.abs(b1 - F0[1]) <= FILL_TOLERANCE;
  const F1size = F1[1] - F1[0];
  const F0size = F0[1] - F0[0];
  const target = fills ? (F1size - F0size) : Math.min(0, F1size - size0);

  // Grid lines
  const raw = [b0, b1];
  for (const m of members) raw.push(m.start, m.end);
  raw.sort((a, b) => a - b);
  const grid = [];
  for (const v of raw) {
    if (v < b0 - EPS || v > b1 + EPS) continue;
    if (grid.length === 0 || v - grid[grid.length - 1] > 0.005) grid.push(v);
  }
  const n = grid.length - 1;
  const lengths = [];
  for (let i = 0; i < n; i++) lengths.push(grid[i + 1] - grid[i]);

  const covering = (i) => members.filter((m) => m.start <= grid[i] + 0.005 && m.end >= grid[i + 1] - 0.005);
  const rigid = [];
  for (let i = 0; i < n; i++) rigid.push(covering(i).some((m) => m.rigid));

  // Per-member stretchable length
  const stretchLen = new Map();
  for (const m of members) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (!rigid[i] && m.start <= grid[i] + 0.005 && m.end >= grid[i + 1] - 0.005) s += lengths[i];
    }
    stretchLen.set(m, s);
  }

  const growing = target > 0;
  const caps = [];
  for (let i = 0; i < n; i++) {
    if (rigid[i]) { caps.push(0); continue; }
    const cov = covering(i);
    let cap = growing ? Infinity : lengths[i];
    for (const m of cov) {
      const size = m.end - m.start;
      const slack = growing ? m.max - size : size - m.min;
      const share = stretchLen.get(m) > EPS ? lengths[i] / stretchLen.get(m) : 0;
      cap = Math.min(cap, Math.max(0, slack) * share);
    }
    caps.push(cap);
  }

  const deltas = Math.abs(target) > EPS ? distribute(target, lengths, caps) : new Array(n).fill(0);
  const achieved = deltas.reduce((a, b) => a + b, 0);
  const newSize = size0 + achieved;

  // Place the resized building inside the new buildable area.
  let newB0;
  if (fills) {
    const inset0 = b0 - F0[0];
    const inset1 = F0[1] - b1;
    if (edge === 'left' || edge === 'top') newB0 = F1[1] - inset1 - newSize;
    else if (edge === 'both') newB0 = (F1[0] + F1[1]) / 2 - newSize / 2 + (inset0 - inset1) / 2;
    else newB0 = F1[0] + inset0;
  } else {
    newB0 = b0 + shift;
  }
  if (newSize <= F1size + 0.01) {
    newB0 = Math.max(F1[0], Math.min(newB0, F1[1] - newSize));
  } else {
    newB0 = edge === 'left' || edge === 'top' ? F1[1] - newSize : (edge === 'both' ? (F1[0] + F1[1] - newSize) / 2 : F1[0]);
    const excess = newSize - F1size;
    const rigidNames = [...new Set(members.filter((m) => m.rigid).map((m) => m.name))];
    conflicts.push({
      code: `building-${axisName}`,
      axis: axisName,
      excess: round4(excess),
      message: `The building needs ${newSize.toFixed(2)}' of buildable ${axisName} but only ${F1size.toFixed(2)}' is available (${excess.toFixed(2)}' short).` +
        (rigidNames.length ? ` Fixed along this axis: ${rigidNames.slice(0, 5).join(', ')}${rigidNames.length > 5 ? '…' : ''}.` : ''),
    });
  }
  if (fills && Math.abs(target - achieved) > 0.01 && target > 0) {
    warnings.push(`Rooms reached their maximum ${axisName}; the building no longer fills the buildable ${axisName} (${(target - achieved).toFixed(2)}' spare).`);
  }

  const newGrid = [newB0];
  for (let i = 0; i < n; i++) newGrid.push(newGrid[i] + lengths[i] + deltas[i]);

  const map = (p) => {
    if (p < b0 - 0.005 || p > b1 + 0.005) return round4(outsideMap(p, b0, b1));
    if (n <= 0) return round4(newB0 + (p - b0));
    let i = 0;
    while (i < n - 1 && p > grid[i + 1] + 0.005) i++;
    const L = lengths[i];
    const t = L > EPS ? (p - grid[i]) / L : 0;
    return round4(newGrid[i] + Math.max(0, Math.min(1, t)) * (newGrid[i + 1] - newGrid[i]));
  };

  return {
    map,
    building: { b0, b1, newB0, newSize },
    conflicts,
    warnings,
    shift,
    dP,
    outsideMap: (p) => round4(outsideMap(p, b0, b1)),
  };
}

/** Find the wall an opening sits on (distance < tol, projection inside wall). */
export function findHostWall(opening, walls, tol = 0.6) {
  let best = null;
  for (const w of walls || []) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const l2 = dx * dx + dy * dy;
    if (l2 < EPS) continue;
    const t = ((opening.x - w.x1) * dx + (opening.y - w.y1) * dy) / l2;
    if (t < -0.02 || t > 1.02) continue;
    const px = w.x1 + t * dx;
    const py = w.y1 + t * dy;
    const d = Math.hypot(opening.x - px, opening.y - py);
    if (d <= tol && (!best || d < best.d)) best = { wall: w, d, t };
  }
  return best;
}

/**
 * Check every door/window against its host wall. Assigns `wallId` where
 * missing. Openings are never deleted; problems are reported.
 */
export function validateOpenings(layout) {
  const conflicts = [];
  const walls = layout.walls || [];
  const check = (o, kind) => {
    let host = o.wallId ? walls.find((w) => w.id === o.wallId) : null;
    let hit = host ? findHostWall(o, [host], 0.6) : null;
    if (!hit) {
      hit = findHostWall(o, walls, 0.6);
      if (hit) o.wallId = hit.wall.id;
    }
    if (!hit) {
      conflicts.push({ code: 'opening-detached', id: o.id, message: `${kind} ${o.id} is not on a wall.` });
      return;
    }
    const w = hit.wall;
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const width = Number(o.width) || 0;
    if (width > len + 0.01) {
      conflicts.push({
        code: 'opening-too-wide',
        id: o.id,
        message: `${kind} (${width.toFixed(2)}') is wider than its host wall (${len.toFixed(2)}').`,
      });
      return;
    }
    // Keep the opening fully on its wall, sliding it inward if needed.
    const half = width / 2 / len;
    const t = Math.max(half, Math.min(1 - half, hit.t));
    if (Math.abs(t - hit.t) > 1e-6) {
      o.x = round4(w.x1 + t * (w.x2 - w.x1));
      o.y = round4(w.y1 + t * (w.y2 - w.y1));
    }
  };
  (layout.doors || []).forEach((d) => check(d, 'Door'));
  (layout.windows || []).forEach((w) => check(w, 'Window'));
  return conflicts;
}

/**
 * Report rooms/staircases/objects outside the plot or the buildable area and
 * overlapping rooms. Purely diagnostic.
 */
export function validateSiteFit(layout) {
  const conflicts = [];
  const W = Number(layout.plot?.width) || 0;
  const L = Number(layout.plot?.length) || 0;
  const sb = readSetbacks(layout.plot?.setbacks);
  const bx0 = sb.west;
  const bx1 = W - sb.east;
  const by0 = sb.north;
  const by1 = L - sb.south;
  const e = 0.02;

  const rects = [];
  for (const r of layout.rooms || []) rects.push({ kind: 'Room', id: r.id, name: r.name || 'Room', x: r.x, y: r.y, w: r.width, l: r.length, buildable: true });
  for (const s of layout.staircases || []) {
    const b = getStaircaseBounds(s);
    rects.push({ kind: 'Staircase', id: s.id, name: s.label || 'Staircase', x: b.x, y: b.y, w: b.width, l: b.length, buildable: false });
  }
  for (const u of layout.utilities || []) rects.push({ kind: 'Utility', id: u.id, name: u.name || 'Utility', x: u.x, y: u.y, w: u.width, l: u.length, buildable: false });
  for (const p of layout.parking || []) rects.push({ kind: 'Parking', id: p.id, name: p.label || 'Parking', x: p.x, y: p.y, w: p.width, l: p.length, buildable: false });

  for (const r of rects) {
    if (r.x < -e || r.y < -e || r.x + r.w > W + e || r.y + r.l > L + e) {
      conflicts.push({ code: 'outside-plot', id: r.id, message: `${r.kind} "${r.name}" extends beyond the plot boundary.` });
    } else if (r.buildable && (r.x < bx0 - e || r.y < by0 - e || r.x + r.w > bx1 + e || r.y + r.l > by1 + e)) {
      conflicts.push({ code: 'outside-buildable', id: r.id, message: `${r.kind} "${r.name}" extends into the setback zone.` });
    }
  }

  const rooms = layout.rooms || [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (rectsOverlap(a.x, a.x + a.width, b.x, b.x + b.width) && rectsOverlap(a.y, a.y + a.length, b.y, b.y + b.length)) {
        conflicts.push({ code: 'room-overlap', id: a.id, otherId: b.id, message: `Rooms "${a.name}" and "${b.name}" overlap.` });
      }
    }
  }
  return conflicts;
}

/**
 * Apply one axis map to every entity of the layout (mutates `next`).
 */
function applyAxis(next, axis, solved) {
  const isX = axis === 'x';
  const m = solved.map;
  const pos = isX ? 'x' : 'y';
  const dim = isX ? 'width' : 'length';
  const conflicts = [];

  for (const r of next.rooms || []) {
    const a = m(r[pos]);
    const b = m(r[pos] + r[dim]);
    r[pos] = a;
    r[dim] = round4(b - a);
  }

  for (const w of next.walls || []) {
    if (isX) { w.x1 = m(w.x1); w.x2 = m(w.x2); } else { w.y1 = m(w.y1); w.y2 = m(w.y2); }
  }

  for (const o of [...(next.doors || []), ...(next.windows || []), ...(next.columns || []), ...(next.annotations || [])]) {
    o[pos] = m(o[pos]);
  }

  for (const d of next.dimensions || []) {
    if (d.id === 'dim-plot-width' || d.id === 'dim-plot-length') continue;
    if (isX) { d.x1 = m(d.x1); d.x2 = m(d.x2); } else { d.y1 = m(d.y1); d.y2 = m(d.y2); }
  }

  // CAD entities follow the same map, so they stay registered to the building.
  for (const e of next.cadEntities || []) {
    if (e.kind === 'line') {
      if (isX) { e.x1 = m(e.x1); e.x2 = m(e.x2); } else { e.y1 = m(e.y1); e.y2 = m(e.y2); }
    } else if (e.points) {
      for (const p of e.points) p[pos] = m(p[pos]);
    } else if (isX) {
      e.cx = m(e.cx);
    } else {
      e.cy = m(e.cy);
    }
  }

  const P1 = isX ? next.plot.width : next.plot.length;
  const b = solved.building;

  // Rigid rectangles outside the building follow an anchor / the nearest plot edge.
  const placeRigid = (start, size, anchor, inside) => {
    if (inside) return m(start);
    const lowKey = isX ? 'left' : 'top';
    const highKey = isX ? 'right' : 'bottom';
    const a = anchor || 'none';
    if (a.includes(lowKey)) return round4(start);
    if (a.includes(highKey)) return round4(start + solved.dP);
    if (a === 'center') return round4(start + solved.dP / 2);
    if (b) {
      if (start + size <= b.b0 + 0.005) return round4(start);
      if (start >= b.b1 - 0.005) return round4(start + solved.dP);
      return round4(m(start + size / 2) - size / 2);
    }
    return round4(start + size / 2 < (P1 - solved.dP) / 2 ? start : start + solved.dP);
  };

  const fitIntoPlot = (start, size, name, kind, id) => {
    if (size > P1 + 0.01) {
      conflicts.push({ code: `${kind}-too-large`, id, message: `${name} (${size.toFixed(2)}') is larger than the plot ${dim} (${P1.toFixed(2)}').` });
      return start;
    }
    return round4(Math.max(0, Math.min(start, P1 - size)));
  };

  for (const s of next.staircases || []) {
    const bb = getStaircaseBounds(s);
    const start = isX ? bb.x : bb.y;
    const size = isX ? bb.width : bb.length;
    const inside = solved.insideStairs?.has(s.id);
    if (inside && s.constraintType === CONSTRAINT_TYPES.FLEXIBLE && !s.isLocked) {
      const a = m(start);
      const e = m(start + size);
      const localDim = stairDimensionForAxis(s, axis);
      const resized = normalizeStaircase({ ...s, [localDim]: e - a }, localDim);
      Object.assign(s, resized, { [pos]: a });
      continue;
    }
    let ns = placeRigid(start, size, s.anchor, inside);
    if (!inside) {
      const before = ns;
      ns = fitIntoPlot(ns, size, `Staircase "${s.label || s.id}"`, 'staircase', s.id);
      if (Math.abs(before - ns) > 0.01) {
        conflicts.push({ code: 'staircase-moved', id: s.id, severity: 'info', message: `Staircase "${s.label || s.id}" was moved ${Math.abs(before - ns).toFixed(2)}' to stay inside the plot.` });
      }
    }
    s[pos] = ns;
  }

  for (const list of ['utilities', 'parking']) {
    for (const u of next[list] || []) {
      const size = Number(u[dim]) || 0;
      const ns = placeRigid(u[pos], size, u.anchor, false);
      u[pos] = fitIntoPlot(ns, size, `${u.name || u.label || 'Object'}`, list, u.id);
    }
  }

  return conflicts;
}

/**
 * Re-derive the outer plot dimension annotations from the plot size.
 */
export function syncPlotDimensionAnnotations(layout) {
  const W = Number(layout?.plot?.width) || 30;
  const L = Number(layout?.plot?.length) || 40;
  if (!Array.isArray(layout.dimensions)) layout.dimensions = [];
  const upsert = (id, fields) => {
    const idx = layout.dimensions.findIndex((d) => d.id === id);
    const prev = idx >= 0 ? layout.dimensions[idx] : { id };
    const off = Number(prev.offset) ? Math.abs(Number(prev.offset)) : 2.5;
    const value = fields.axis === 'width' ? W : L;
    const geom = fields.axis === 'width'
      ? { x1: 0, y1: -off, x2: W, y2: -off }
      : { x1: -off, y1: 0, x2: -off, y2: L };
    const merged = { ...prev, ...fields, ...geom, offset: off, value, label: `${value}' (Plot ${fields.axis === 'width' ? 'Width' : 'Length'})` };
    if (idx >= 0) layout.dimensions[idx] = merged; else layout.dimensions.push(merged);
  };
  upsert('dim-plot-width', { axis: 'width' });
  upsert('dim-plot-length', { axis: 'length' });
  return layout;
}

/**
 * Intelligent site reflow.
 *
 * @param {object} layout current (valid) layout - never mutated
 * @param {object} options
 *   newWidth / newLength  target plot size (ft)
 *   setbacks              optional new {north, south, east, west}
 *   edge                  'right'|'left'|'top'|'bottom'|'corner-ne'|'corner-nw'|'corner-se'|'corner-sw'|'symmetric'
 *   edgeX / edgeY         explicit per-axis edge ('left'|'right'|'both' / 'top'|'bottom'|'both')
 *   isSymmetric           resize about the centre
 *   relaxFixed            allow fixed (non-locked) rooms to shrink to their type minimum
 * @returns {{ nextLayout, conflicts: object[], warnings: string[], success: boolean, shift: {x,y} }}
 */
export function reflowLayoutOnPlotResize(layout, options = {}) {
  if (!layout || !layout.plot) {
    return { nextLayout: layout, conflicts: [{ code: 'invalid', message: 'Invalid layout object' }], warnings: [], success: false, shift: { x: 0, y: 0 } };
  }
  const next = clone(layout);
  const P0w = Number(layout.plot.width) || 30;
  const P0l = Number(layout.plot.length) || 40;
  const reqW = options.newWidth !== undefined ? Number(options.newWidth) : P0w;
  const reqL = options.newLength !== undefined ? Number(options.newLength) : P0l;
  const conflicts = [];
  const warnings = [];

  if (!Number.isFinite(reqW) || !Number.isFinite(reqL)) {
    return { nextLayout: clone(layout), conflicts: [{ code: 'invalid', message: 'Plot dimensions must be numbers.' }], warnings, success: false, shift: { x: 0, y: 0 } };
  }
  const P1w = round4(Math.max(MIN_PLOT_DIMENSION, reqW));
  const P1l = round4(Math.max(MIN_PLOT_DIMENSION, reqL));
  if (reqW < MIN_PLOT_DIMENSION || reqL < MIN_PLOT_DIMENSION) {
    warnings.push(`Plot dimensions are limited to a minimum of ${MIN_PLOT_DIMENSION}'.`);
  }

  const sb0 = readSetbacks(layout.plot.setbacks);
  const sb1 = options.setbacks ? { ...sb0, ...readSetbacks({ ...sb0, ...options.setbacks }) } : { ...sb0 };
  for (const k of Object.keys(sb1)) sb1[k] = Math.max(0, sb1[k]);
  if (sb1.west + sb1.east >= P1w - 1 || sb1.north + sb1.south >= P1l - 1) {
    conflicts.push({ code: 'no-buildable-area', message: `Setbacks leave no buildable area on a ${P1w}' x ${P1l}' plot.` });
  }

  const { ex, ey } = resolveEdges(options);
  const relaxFixed = !!options.relaxFixed;

  // Record openings' host walls before anything moves.
  validateOpenings(next);

  // Staircases inside the building are solved with the rooms; the set is
  // taken from the same geometry the axis was solved on.
  const insideStairs = () => new Set((next.staircases || []).filter((s) => stairInsideRooms(next, s)).map((s) => s.id));
  const solveX = solveAxis(next, 'x', { P0: P0w, P1: P1w, lo0: sb0.west, hi0: sb0.east, lo1: sb1.west, hi1: sb1.east, edge: ex, relaxFixed });
  solveX.insideStairs = insideStairs();

  next.plot.width = P1w;
  next.plot.setbacks = { ...sb1 };
  conflicts.push(...solveX.conflicts);
  warnings.push(...solveX.warnings);
  conflicts.push(...applyAxis(next, 'x', solveX));

  const solveY = solveAxis(next, 'y', { P0: P0l, P1: P1l, lo0: sb0.north, hi0: sb0.south, lo1: sb1.north, hi1: sb1.south, edge: ey === 'top' ? 'top' : (ey === 'both' ? 'both' : 'bottom'), relaxFixed });
  solveY.insideStairs = insideStairs();
  next.plot.length = P1l;
  conflicts.push(...solveY.conflicts);
  warnings.push(...solveY.warnings);
  conflicts.push(...applyAxis(next, 'y', solveY));

  next.footprint = {
    x: sb1.west,
    y: sb1.north,
    width: round4(Math.max(0, P1w - sb1.west - sb1.east)),
    length: round4(Math.max(0, P1l - sb1.north - sb1.south)),
  };

  conflicts.push(...validateOpenings(next));
  // Only report fit problems the resize introduced or that block the result.
  const before = new Set(validateSiteFit(layout).map((c) => `${c.code}:${c.id}:${c.otherId || ''}`));
  for (const c of validateSiteFit(next)) {
    if (!before.has(`${c.code}:${c.id}:${c.otherId || ''}`)) conflicts.push(c);
  }

  syncPlotDimensionAnnotations(next);
  next.updatedAt = new Date().toISOString();

  const blocking = conflicts.filter((c) => c.severity !== 'info');
  return {
    nextLayout: next,
    conflicts,
    warnings,
    success: blocking.length === 0,
    shift: { x: solveX.shift, y: solveY.shift },
  };
}

function stairInsideRooms(layout, s) {
  const rooms = layout.rooms || [];
  if (rooms.length === 0) return false;
  const b = getStaircaseBounds(s);
  const x0 = Math.min(...rooms.map((r) => r.x));
  const x1 = Math.max(...rooms.map((r) => r.x + r.width));
  const y0 = Math.min(...rooms.map((r) => r.y));
  const y1 = Math.max(...rooms.map((r) => r.y + r.length));
  return rectsOverlap(b.x, b.x + b.width, x0, x1) && rectsOverlap(b.y, b.y + b.length, y0, y1);
}
