/**
 * AutoPlot Local Room Resize Solver
 *
 * Resizes a room (or drags a shared wall) while keeping the drawing
 * consistent. The outer site boundary is never touched here - site resizing
 * is a separate operation (constraintEngine.js).
 *
 * MODEL
 * -----
 * Moving a room edge moves a BOUNDARY LINE (x = c or y = c) over the span of
 * that edge. Every room touching that line within the span is affected:
 *   - the room being resized moves its edge (user intent);
 *   - a FLEXIBLE neighbour moves the same edge and keeps its opposite
 *     boundary, within its min / max limits;
 *   - a FIXED neighbour keeps its size and translates; its far edge then
 *     becomes a new boundary line that its own neighbours respond to;
 *   - a LOCKED room, an exterior wall or the plot boundary stops the move.
 * Rooms whose type is only *inferred* as fixed (bathrooms, pooja, store...)
 * first try to keep their size; if that is impossible they flex within their
 * type minimum. Rooms explicitly configured as fixed never flex.
 * When the full move is impossible, the largest valid move in the same
 * direction is used and the reason is reported. Nothing is deleted.
 *
 * Every call is a pure function of the layout passed in. Interactive drags
 * must pass the layout captured at pointer-down, never the live preview.
 */

import { inferObjectConstraints, inferRoomConstraintType, validateOpenings, findHostWall } from './constraintEngine.js';
import { getStaircaseBounds } from './staircaseGeometry.js';
import { getPlotRect } from './siteGeometry.js';

export const MIN_ROOM_SIZE = 2.5; // ft - absolute minimum for a room the user resizes directly
const TOL = 0.02;
const near = (a, b, tol = TOL) => Math.abs(a - b) <= tol;
const round4 = (v) => Math.round(v * 10000) / 10000;
const clone = (o) => JSON.parse(JSON.stringify(o));
const overlapLen = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

let wallSeq = 0;
const newWallId = () => `wall-r-${Date.now().toString(36)}-${(wallSeq++).toString(36)}`;

// ---------------------------------------------------------------------------
// Viewport maths (shared with the canvas so the drag model can be tested)
// ---------------------------------------------------------------------------

/** Screen pixel -> world feet. The ONLY conversion a drag should use. */
export function screenToWorldPoint(viewport, sx, sy) {
  return { x: (sx - viewport.panX) / viewport.scale, y: (sy - viewport.panY) / viewport.scale };
}

/** World feet -> screen pixel. */
export function worldToScreenPoint(viewport, wx, wy) {
  return { x: wx * viewport.scale + viewport.panX, y: wy * viewport.scale + viewport.panY };
}

// ---------------------------------------------------------------------------
// Geometry helpers (axis-generic: `a` runs along the move axis, `b` across it)
// ---------------------------------------------------------------------------

function rectOf(r, axis) {
  return axis === 'x'
    ? { a0: r.x, a1: r.x + r.width, b0: r.y, b1: r.y + r.length }
    : { a0: r.y, a1: r.y + r.length, b0: r.x, b1: r.x + r.width };
}

function wallAB(w, axis) {
  return axis === 'x'
    ? { a1: w.x1, b1: w.y1, a2: w.x2, b2: w.y2 }
    : { a1: w.y1, b1: w.x1, a2: w.y2, b2: w.x2 };
}

function setWallAB(w, axis, a1, b1, a2, b2) {
  return axis === 'x'
    ? { ...w, x1: round4(a1), y1: round4(b1), x2: round4(a2), y2: round4(b2) }
    : { ...w, y1: round4(a1), x1: round4(b1), y2: round4(a2), x2: round4(b2) };
}

/** Is the wall a segment of the line a = const (perpendicular to the move axis)? */
const isAcrossAxis = (w, axis) => (axis === 'x' ? Math.abs(w.x1 - w.x2) < TOL : Math.abs(w.y1 - w.y2) < TOL);

/**
 * Segments that must not move during a room edit: exterior walls and the
 * plot boundary. When a layout has no exterior walls, the outline of the
 * rooms at the start of the edit is used as the building envelope.
 */
function buildEnvelope(layout, ignoreWallIds) {
  const segs = [];
  const site = getPlotRect(layout, { width: 0, length: 0 });
  segs.push(
    { x1: site.x0, y1: site.y0, x2: site.x1, y2: site.y0 },
    { x1: site.x1, y1: site.y0, x2: site.x1, y2: site.y1 },
    { x1: site.x0, y1: site.y1, x2: site.x1, y2: site.y1 },
    { x1: site.x0, y1: site.y0, x2: site.x0, y2: site.y1 },
  );
  const ext = (layout.walls || []).filter((w) => w.type === 'exterior');
  for (const w of ext) if (!ignoreWallIds.has(w.id)) segs.push(w);
  for (const w of layout.walls || []) if (w.isLocked && w.type !== 'exterior') segs.push(w);
  if (ext.length === 0 && (layout.rooms || []).length > 0) {
    const rs = layout.rooms;
    const x0 = Math.min(...rs.map((r) => r.x));
    const x1 = Math.max(...rs.map((r) => r.x + r.width));
    const y0 = Math.min(...rs.map((r) => r.y));
    const y1 = Math.max(...rs.map((r) => r.y + r.length));
    segs.push({ x1: x0, y1: y0, x2: x1, y2: y0 }, { x1, y1: y0, x2: x1, y2: y1 }, { x1: x0, y1, x2: x1, y2: y1 }, { x1: x0, y1: y0, x2: x0, y2: y1 });
  }
  return segs;
}

function envelopeBlocks(envelope, axis, c, b0, b1) {
  return envelope.some((s) => {
    if (!isAcrossAxis(s, axis)) return false;
    const { a1, b1: sb1, b2: sb2 } = wallAB(s, axis);
    return near(a1, c) && overlapLen(Math.min(sb1, sb2), Math.max(sb1, sb2), b0, b1) > 0.01;
  });
}

function roomBehaviour(room, axis, relax, direct) {
  const lockDim = axis === 'x' ? room.lockWidth : room.lockLength;
  if (room.isLocked || room.constraintType === 'locked') return 'locked';
  if (direct) return lockDim ? 'locked' : 'direct';
  if (lockDim) return 'fixed';
  const t = room.constraintType;
  if (t === 'fixed' || t === 'anchored') return 'fixed';
  if (t === 'flexible') return 'flexible';
  if (inferRoomConstraintType(room) === 'fixed') return relax ? 'flexible' : 'fixed';
  return 'flexible';
}

function sizeLimits(room, axis, behaviour) {
  const dim = axis === 'x' ? 'width' : 'length';
  const pick = (v) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const exMin = pick(axis === 'x' ? room.minWidth : room.minLength);
  const exMax = pick(axis === 'x' ? room.maxWidth : room.maxLength);
  if (behaviour === 'direct') return { min: exMin ?? MIN_ROOM_SIZE, max: exMax ?? Infinity };
  const c = inferObjectConstraints(room);
  const size = Number(room[dim]) || 0;
  return {
    min: Math.max(MIN_ROOM_SIZE, Math.min(size, exMin ?? (axis === 'x' ? c.minWidth : c.minLength))),
    max: exMax ?? Infinity,
  };
}

const conflictKey = (c) => `${c.code}:${c.id || ''}:${c.otherId || ''}`;

function roomOverlaps(rooms) {
  const out = new Set();
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (overlapLen(a.x, a.x + a.width, b.x, b.x + b.width) > 0.01 && overlapLen(a.y, a.y + a.length, b.y, b.y + b.length) > 0.01) {
        out.add(`${a.id}|${b.id}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core: one attempt to move a boundary line by exactly d
// ---------------------------------------------------------------------------

function attemptLineMove(layout, seed, d, relax, envelope, baseline) {
  const { axis } = seed;
  const rooms = layout.rooms || [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const rects = new Map(rooms.map((r) => [r.id, rectOf(r, axis)]));
  const actions = new Map(); // id -> 'low' | 'high' | 'translate'
  const lineMoves = [];
  const queue = [{ c: seed.c, b0: seed.b0, b1: seed.b1 }];
  const seen = new Set();
  const fail = (reason) => ({ ok: false, reason });

  while (queue.length) {
    const ev = queue.shift();
    const key = `${ev.c.toFixed(3)}:${ev.b0.toFixed(3)}:${ev.b1.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Rooms touching this line, grown transitively along the line
    let b0 = ev.b0;
    let b1 = ev.b1;
    const members = new Set();
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rooms) {
        if (members.has(r.id)) continue;
        const R = rects.get(r.id);
        if (!near(R.a0, ev.c) && !near(R.a1, ev.c)) continue;
        if (overlapLen(R.b0, R.b1, b0, b1) <= 0.01) continue;
        members.add(r.id);
        if (R.b0 < b0) { b0 = R.b0; grew = true; }
        if (R.b1 > b1) { b1 = R.b1; grew = true; }
      }
    }
    if (envelopeBlocks(envelope, axis, ev.c, b0, b1)) {
      return fail('This boundary is on an exterior wall or the site boundary, which a room edit cannot move. Resize the site instead.');
    }
    lineMoves.push({ c: ev.c, b0, b1 });

    for (const id of members) {
      const R = rects.get(id);
      const side = near(R.a1, ev.c) ? 'high' : 'low';
      const prev = actions.get(id);
      if (prev === 'translate' || prev === side) continue;
      if (prev) { actions.set(id, 'translate'); continue; } // both edges moved by d
      const room = byId.get(id);
      const name = room.name || room.label || 'Room';
      const direct = seed.directIds.has(id) && overlapLen(R.b0, R.b1, seed.b0, seed.b1) > 0.01;
      const beh = roomBehaviour(room, axis, relax, direct);
      if (beh === 'locked') return fail(`"${name}" is locked.`);
      if (beh === 'fixed') {
        actions.set(id, 'translate');
        queue.push({ c: side === 'high' ? R.a0 : R.a1, b0: R.b0, b1: R.b1 });
        continue;
      }
      const size = R.a1 - R.a0;
      const next = side === 'high' ? size + d : size - d;
      const lim = sizeLimits(room, axis, beh);
      const dimName = axis === 'x' ? 'width' : 'length';
      if (next < lim.min - 1e-6) return fail(`"${name}" cannot be narrower than ${lim.min.toFixed(2)}' (${dimName}).`);
      if (next > lim.max + 1e-6) return fail(`"${name}" cannot be wider than ${lim.max.toFixed(2)}' (${dimName}).`);
      actions.set(id, side);
    }
  }

  // Apply room changes
  const next = clone(layout);
  const pos = axis === 'x' ? 'x' : 'y';
  const dim = axis === 'x' ? 'width' : 'length';
  const translated = [];
  for (const r of next.rooms) {
    const act = actions.get(r.id);
    if (!act) continue;
    const R = rects.get(r.id);
    let a0 = R.a0;
    let a1 = R.a1;
    if (act === 'low') a0 += d;
    else if (act === 'high') a1 += d;
    else { a0 += d; a1 += d; translated.push({ ...R }); }
    r[pos] = round4(a0);
    r[dim] = round4(a1 - a0);
  }

  // Validate against the fixed site and the rest of the layout
  const site = getPlotRect(next, { width: Infinity, length: Infinity });
  for (const r of next.rooms) {
    if (!actions.has(r.id)) continue;
    if (r.x < site.x0 - 1e-6 || r.y < site.y0 - 1e-6 || r.x + r.width > site.x1 + 1e-6 || r.y + r.length > site.y1 + 1e-6) {
      return fail(`"${r.name || 'Room'}" would leave the site boundary.`);
    }
  }
  for (const k of roomOverlaps(next.rooms)) {
    if (!baseline.overlaps.has(k)) {
      const [a, b] = k.split('|').map((id) => byId.get(id)?.name || id);
      return fail(`"${a}" would overlap "${b}".`);
    }
  }

  // Walls, openings, staircases
  next.walls = moveWalls(layout.walls || [], axis, lineMoves, d, translated);
  moveOpenings(next, layout, axis, lineMoves, d, translated);
  moveStaircases(next, axis, d, translated);
  fillRoomEdgeWalls(next, [...actions.keys()]);

  const openingIssues = validateOpenings(next).filter((c) => !baseline.openings.has(conflictKey(c)));
  if (openingIssues.length) return fail(openingIssues[0].message);

  return { ok: true, layout: next, actions, lineMoves };
}

function inMove(lineMoves, a, b) {
  return lineMoves.some((m) => near(m.c, a) && b >= m.b0 - TOL && b <= m.b1 + TOL);
}

function insideRect(R, a, b) {
  return a >= R.a0 - TOL && a <= R.a1 + TOL && b >= R.b0 - TOL && b <= R.b1 + TOL;
}

/**
 * Move walls that lie on moved boundary lines (splitting a wall when only
 * part of it moves), stretch walls whose endpoints sit on a moved line, and
 * translate walls inside translated rooms. Exterior walls never reach here
 * because the envelope check rejects any move that would touch them.
 */
function moveWalls(walls, axis, lineMoves, d, translated) {
  const out = [];
  for (const w of walls) {
    const { a1, b1, a2, b2 } = wallAB(w, axis);
    if (isAcrossAxis(w, axis)) {
      const moves = lineMoves.filter((m) => near(m.c, a1));
      const lo = Math.min(b1, b2);
      const hi = Math.max(b1, b2);
      if (moves.length === 0) {
        const inT = translated.some((R) => insideRect(R, a1, b1) && insideRect(R, a2, b2));
        out.push(inT ? setWallAB(w, axis, a1 + d, b1, a2 + d, b2) : w);
        continue;
      }
      // Split [lo, hi] into moving and static pieces
      const cuts = new Set([lo, hi]);
      for (const m of moves) {
        if (m.b0 > lo && m.b0 < hi) cuts.add(m.b0);
        if (m.b1 > lo && m.b1 < hi) cuts.add(m.b1);
      }
      const pts = [...cuts].sort((p, q) => p - q);
      const pieces = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        if (p1 - p0 < 0.01) continue;
        const mid = (p0 + p1) / 2;
        const moving = moves.some((m) => mid >= m.b0 - TOL && mid <= m.b1 + TOL);
        const last = pieces[pieces.length - 1];
        if (last && last.moving === moving) last.p1 = p1; else pieces.push({ p0, p1, moving });
      }
      const forward = b2 >= b1;
      pieces.forEach((pc, i) => {
        const a = pc.moving ? a1 + d : a1;
        const [s, e] = forward ? [pc.p0, pc.p1] : [pc.p1, pc.p0];
        out.push(setWallAB({ ...w, id: i === 0 ? w.id : newWallId() }, axis, a, s, a, e));
      });
      continue;
    }
    // Wall along the move axis: stretch endpoints on moved lines, or translate with a room
    const inT = translated.some((R) => insideRect(R, a1, b1) && insideRect(R, a2, b2));
    if (inT) { out.push(setWallAB(w, axis, a1 + d, b1, a2 + d, b2)); continue; }
    const na1 = inMove(lineMoves, a1, b1) ? a1 + d : a1;
    const na2 = inMove(lineMoves, a2, b2) ? a2 + d : a2;
    out.push(na1 !== a1 || na2 !== a2 ? setWallAB(w, axis, na1, b1, na2, b2) : w);
  }
  return out;
}

function moveOpenings(next, before, axis, lineMoves, d, translated) {
  const hosts = clone({ walls: before.walls || [], doors: before.doors || [], windows: before.windows || [] });
  validateOpenings(hosts); // records each opening's host wall before the move
  const shift = (o) => {
    const a = axis === 'x' ? o.x : o.y;
    const b = axis === 'x' ? o.y : o.x;
    const moves = inMove(lineMoves, a, b) || translated.some((R) => insideRect(R, a, b));
    if (moves) {
      if (axis === 'x') o.x = round4(o.x + d); else o.y = round4(o.y + d);
    }
  };
  for (const key of ['doors', 'windows']) {
    (next[key] || []).forEach((o, i) => {
      shift(o);
      // Re-host on the (possibly split) wall it now sits on
      const prevHost = hosts[key][i]?.wallId;
      const hit = findHostWall(o, next.walls, 0.05);
      if (hit) o.wallId = hit.wall.id;
      else if (prevHost) o.wallId = prevHost;
    });
  }
}

function moveStaircases(next, axis, d, translated) {
  for (const s of next.staircases || []) {
    const b = getStaircaseBounds(s);
    const ca = axis === 'x' ? b.x + b.width / 2 : b.y + b.length / 2;
    const cb = axis === 'x' ? b.y + b.length / 2 : b.x + b.width / 2;
    if (translated.some((R) => insideRect(R, ca, cb))) {
      if (axis === 'x') s.x = round4(s.x + d); else s.y = round4(s.y + d);
    }
  }
}

/** Add interior walls for any part of an affected room's edges left uncovered. */
export function fillRoomEdgeWalls(layout, roomIds) {
  const ids = new Set(roomIds);
  for (const r of layout.rooms || []) {
    if (!ids.has(r.id)) continue;
    const edges = [
      { horiz: true, c: r.y, s: r.x, e: r.x + r.width },
      { horiz: true, c: r.y + r.length, s: r.x, e: r.x + r.width },
      { horiz: false, c: r.x, s: r.y, e: r.y + r.length },
      { horiz: false, c: r.x + r.width, s: r.y, e: r.y + r.length },
    ];
    for (const edge of edges) {
      const covered = [];
      for (const w of layout.walls) {
        const horiz = Math.abs(w.y1 - w.y2) < TOL;
        const vert = Math.abs(w.x1 - w.x2) < TOL;
        if (edge.horiz && horiz && near(w.y1, edge.c)) covered.push([Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)]);
        if (!edge.horiz && vert && near(w.x1, edge.c)) covered.push([Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)]);
      }
      covered.sort((p, q) => p[0] - q[0]);
      let cursor = edge.s;
      const gaps = [];
      for (const [s, e] of covered) {
        if (e <= cursor + TOL) continue;
        if (s > cursor + 0.05) gaps.push([cursor, Math.min(s, edge.e)]);
        cursor = Math.max(cursor, e);
        if (cursor >= edge.e - TOL) break;
      }
      if (cursor < edge.e - 0.05) gaps.push([cursor, edge.e]);
      for (const [s, e] of gaps) {
        if (e - s < 0.05) continue;
        layout.walls.push(edge.horiz
          ? { id: newWallId(), type: 'interior', x1: round4(s), y1: round4(edge.c), x2: round4(e), y2: round4(edge.c), thickness: 0.375, isLocked: false, color: '#0F172A' }
          : { id: newWallId(), type: 'interior', x1: round4(edge.c), y1: round4(s), x2: round4(edge.c), y2: round4(e), thickness: 0.375, isLocked: false, color: '#0F172A' });
      }
    }
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Move a boundary line by `dRequested`, resolving neighbours by their
 * constraints. Falls back to the largest valid move in the same direction.
 * @param {object} layout  layout at the START of the edit (never mutated)
 * @param {{axis:'x'|'y', c:number, b0:number, b1:number, directIds:Set<string>, ignoreWallIds?:Set<string>}} seed
 * @returns {{layout, achieved:number, requested:number, clamped:boolean, reason:string|null, relaxed:boolean}}
 */
export function moveBoundary(layout, seed, dRequested) {
  const req = Number(dRequested) || 0;
  const base = { layout, achieved: 0, requested: req, clamped: false, reason: null, relaxed: false };
  if (Math.abs(req) < 1e-6) return base;
  const envelope = buildEnvelope(layout, seed.ignoreWallIds || new Set());
  const baseline = {
    overlaps: roomOverlaps(layout.rooms || []),
    openings: new Set(validateOpenings(clone({ walls: layout.walls || [], doors: layout.doors || [], windows: layout.windows || [] })).map(conflictKey)),
  };

  const passes = [false, true];
  const firstReason = {};
  for (const relax of passes) {
    const res = attemptLineMove(layout, seed, req, relax, envelope, baseline);
    if (res.ok) return { layout: res.layout, achieved: req, requested: req, clamped: false, reason: null, relaxed: relax };
    firstReason[relax] = res.reason;
  }

  // Largest valid fraction of the request, per pass (bisection)
  let best = null;
  for (const relax of passes) {
    let lo = 0;
    let hi = 1;
    let bestRes = null;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const res = attemptLineMove(layout, seed, req * mid, relax, envelope, baseline);
      if (res.ok) { lo = mid; bestRes = res; } else hi = mid;
    }
    // Round down to 1/100 ft so the stop position is a clean value
    const d = Math.trunc(req * lo * 100) / 100;
    if (bestRes && Math.abs(d) > 0) {
      const res = attemptLineMove(layout, seed, d, relax, envelope, baseline);
      if (res.ok && (!best || Math.abs(d) > Math.abs(best.achieved) + 1e-6)) {
        best = { layout: res.layout, achieved: d, relaxed: relax };
      }
    }
  }
  const reason = firstReason[true] || firstReason[false];
  if (!best) return { ...base, clamped: true, reason };
  return { ...best, requested: req, clamped: true, reason };
}

const EDGE_AXIS = { left: 'x', right: 'x', top: 'y', bottom: 'y' };

/**
 * Resize a room by moving any of its edges to absolute positions.
 * Edges are processed one axis at a time; each step is solved against the
 * result of the previous one.
 * @param {object} layout  layout at the start of the edit
 * @param {string} roomId
 * @param {{left?:number,right?:number,top?:number,bottom?:number}} targets
 * @returns {{layout, room, conflicts:string[], clamped:boolean}}
 */
export function resizeRoom(layout, roomId, targets = {}) {
  let cur = layout;
  const conflicts = [];
  let clamped = false;
  for (const side of ['left', 'right', 'top', 'bottom']) {
    if (targets[side] === undefined || targets[side] === null || !Number.isFinite(Number(targets[side]))) continue;
    const room = (cur.rooms || []).find((r) => r.id === roomId);
    if (!room) break;
    const axis = EDGE_AXIS[side];
    const R = rectOf(room, axis);
    const c = side === 'left' || side === 'top' ? R.a0 : R.a1;
    const d = Number(targets[side]) - c;
    if (Math.abs(d) < 1e-6) continue;
    const res = moveBoundary(cur, { axis, c, b0: R.b0, b1: R.b1, directIds: new Set([roomId]) }, d);
    cur = res.layout;
    if (res.clamped) { clamped = true; if (res.reason) conflicts.push(res.reason); }
  }
  return { layout: cur, room: (cur.rooms || []).find((r) => r.id === roomId), conflicts, clamped };
}

/**
 * Set a room's width or length numerically. The west / north edge stays fixed
 * while the east / south edge can move; when that edge is blocked (on an exterior
 * wall, say), the opposite edge takes up whatever is left of the change.
 */
export function setRoomDimension(layout, roomId, field, value) {
  const room = (layout.rooms || []).find((r) => r.id === roomId);
  if (!room) return { layout, room: null, conflicts: ['Room not found.'], clamped: true };
  const target = Number(value);
  const isWidth = field === 'width';
  const first = resizeRoom(layout, roomId, isWidth ? { right: room.x + target } : { bottom: room.y + target });
  const got = isWidth ? first.room.width : first.room.length;
  if (!first.clamped || Math.abs(got - target) < 1e-4) return first;
  const second = resizeRoom(first.layout, roomId, isWidth
    ? { left: first.room.x + first.room.width - target }
    : { top: first.room.y + first.room.length - target });
  const finalSize = isWidth ? second.room.width : second.room.length;
  if (Math.abs(finalSize - target) >= Math.abs(got - target)) return first;
  return { ...second, conflicts: Math.abs(finalSize - target) < 1e-4 ? [] : (second.conflicts.length ? second.conflicts : first.conflicts) };
}

/**
 * Drag a wall perpendicular to itself. Rooms on both sides of the wall are
 * resized directly; rooms further away follow their constraints. Returns
 * null when the wall is not an axis-aligned room boundary (callers then use
 * plain wall movement).
 */
export function moveWallBoundary(layout, wallId, delta) {
  const w = (layout.walls || []).find((x) => x.id === wallId);
  if (!w) return null;
  const axis = Math.abs(w.x1 - w.x2) < TOL ? 'x' : (Math.abs(w.y1 - w.y2) < TOL ? 'y' : null);
  if (!axis) return null;
  const { a1, b1, b2 } = wallAB(w, axis);
  const lo = Math.min(b1, b2);
  const hi = Math.max(b1, b2);
  const direct = new Set((layout.rooms || []).filter((r) => {
    const R = rectOf(r, axis);
    return (near(R.a0, a1) || near(R.a1, a1)) && overlapLen(R.b0, R.b1, lo, hi) > 0.01;
  }).map((r) => r.id));
  if (direct.size === 0) return null;
  return moveBoundary(layout, { axis, c: a1, b0: lo, b1: hi, directIds: direct, ignoreWallIds: new Set([w.id]) }, delta);
}

/** Map a resize handle id ('n','ne','e',...) and a pointer delta to edge targets. */
export function edgeTargetsForHandle(room, handle, dx, dy) {
  const t = {};
  if (handle.includes('w')) t.left = room.x + dx;
  if (handle.includes('e')) t.right = room.x + room.width + dx;
  if (handle.includes('n')) t.top = room.y + dy;
  if (handle.includes('s')) t.bottom = room.y + room.length + dy;
  return t;
}

/**
 * Move a room as a whole (interior drag). Walls used only by this room move
 * with it; shared and exterior walls stay for the neighbours, and missing
 * boundary walls are added at the new position. Openings on the room's own
 * walls move with it.
 */
export function moveRoom(layout, roomId, dx, dy) {
  const next = clone(layout);
  const room = next.rooms.find((r) => r.id === roomId);
  if (!room || room.isLocked) return { layout, room };
  const old = { ...room };
  // The site boundary is a hard limit for a move (a room already outside it may come back in).
  const site = getPlotRect(next, { width: Infinity, length: Infinity });
  const clampMove = (pos, size, low, high, d) => {
    const lo = Math.min(low, pos);
    const hi = Math.max(high - size, pos);
    return Math.max(lo, Math.min(hi, pos + d)) - pos;
  };
  dx = clampMove(old.x, old.width, site.x0, site.x1, dx);
  dy = clampMove(old.y, old.length, site.y0, site.y1, dy);
  const onEdge = (r, w) => {
    const h = Math.abs(w.y1 - w.y2) < TOL;
    const v = Math.abs(w.x1 - w.x2) < TOL;
    const lo = h ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2);
    const hi = h ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
    if (h && (near(w.y1, r.y) || near(w.y1, r.y + r.length))) return overlapLen(lo, hi, r.x, r.x + r.width) > 0.01;
    if (v && (near(w.x1, r.x) || near(w.x1, r.x + r.width))) return overlapLen(lo, hi, r.y, r.y + r.length) > 0.01;
    return false;
  };
  const exclusive = new Set(next.walls.filter((w) => w.type !== 'exterior' && !w.isLocked && onEdge(old, w) &&
    !next.rooms.some((r) => r.id !== roomId && onEdge(r, w))).map((w) => w.id));

  const hosts = clone({ walls: next.walls, doors: next.doors || [], windows: next.windows || [] });
  validateOpenings(hosts);

  room.x = round4(old.x + dx);
  room.y = round4(old.y + dy);
  next.walls = next.walls.map((w) => (exclusive.has(w.id)
    ? { ...w, x1: round4(w.x1 + dx), y1: round4(w.y1 + dy), x2: round4(w.x2 + dx), y2: round4(w.y2 + dy) } : w));
  for (const key of ['doors', 'windows']) {
    (next[key] || []).forEach((o, i) => {
      if (exclusive.has(hosts[key][i]?.wallId)) { o.x = round4(o.x + dx); o.y = round4(o.y + dy); }
    });
  }
  // A staircase standing inside the room travels with it.
  for (const s of next.staircases || []) {
    if (s.isLocked) continue;
    const b = getStaircaseBounds(s);
    if (b.x >= old.x - TOL && b.y >= old.y - TOL && b.x + b.width <= old.x + old.width + TOL && b.y + b.length <= old.y + old.length + TOL) {
      s.x = round4(s.x + dx);
      s.y = round4(s.y + dy);
    }
  }
  fillRoomEdgeWalls(next, [roomId]);
  return { layout: next, room };
}
