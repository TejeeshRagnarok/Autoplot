/**
 * Editing accuracy: units, numeric entry, rooms, walls, openings, staircases,
 * selection, snapping, undo/redo and persistence. Everything asserts on the real
 * geometry model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWall, createDoor, createWindow, createColumn, createParking, cloneLayout,
  applySiteChange, createStaircase, calculateStaircaseGeometry, normalizeStaircase,
  getStaircaseBounds, rotateStaircase, resizeStaircaseWorld, validateStaircaseFit,
  findRoomSnapping, createDefaultLayout,
} from '../components/editor/layoutModel.js';
import { formatMeasurement, parseToFeet, resolveMeasurementCommit, formatArea } from '../components/editor/units.js';
import { resizeRoom, moveRoom, setRoomDimension, edgeTargetsForHandle, screenToWorldPoint, worldToScreenPoint } from '../components/editor/roomResize.js';
import {
  getOpeningGeometry, getOpeningHost, getOpeningPosition, joinWallPair, moveOpening, moveWallBody,
  moveWallEndpointTo, placeOpeningOnWall, reattachOpenings, resizeOpening, setOpeningPosition,
  setWallLength, setWallProps, splitWall, buildWall, orthoPoint,
} from '../components/editor/wallOps.js';
import { hitTestAll, boxSelect, nextOverlappingHit, toggleInSelection, selectionFromItems, selectionItems, isItemSelected } from '../components/editor/selectionModel.js';
import { findPointSnap } from '../components/editor/snapEngine.js';
import { HistoryManager } from '../components/editor/historyManager.js';
import { saveProject, loadProject, normalizeLoadedLayout } from '../components/editor/projectStorage.js';
import { validateLayout } from '../components/editor/layoutValidation.js';
import { generateStructuredLayoutFromState } from '../components/editor/layoutBridge.js';
import { generateLayoutSVG } from '../components/editor/exportUtils.js';
import { buildFixture, byId, near } from './fixtures.mjs';

const almost = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

/** Bare plot with one free-standing wall, for tests about walls and openings. */
function plotWithWall(extra = {}) {
  const l = createDefaultLayout({ siteWidth: 40, siteLength: 40 });
  l.walls = [createWall({ id: 'w', x1: 5, y1: 10, x2: 25, y2: 10, thickness: 0.5, ...extra })];
  return l;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

test('a plain number means the active unit, never inches', () => {
  assert.equal(parseToFeet('12', 'ft-in'), 12);
  assert.equal(parseToFeet('12.5', 'ft'), 12.5);
  assert.equal(parseToFeet('150', 'in'), 12.5);
  almost(parseToFeet('3.5', 'm'), 11.48294);
});

test('explicit units win over the active unit', () => {
  assert.equal(parseToFeet(`12' 6"`, 'm'), 12.5);
  assert.equal(parseToFeet('12ft 6in', 'ft'), 12.5);
  assert.equal(parseToFeet('12-6', 'ft-in'), 12.5);
  assert.equal(parseToFeet(`6"`, 'ft'), 0.5);
  assert.equal(parseToFeet('6 in', 'ft'), 0.5);
  almost(parseToFeet('1m', 'ft'), 3.28084);
  almost(parseToFeet('100cm', 'ft'), 3.28084);
  almost(parseToFeet('1000 mm', 'ft'), 3.28084);
});

test('feet and inches accept fractions and negatives; junk is rejected', () => {
  almost(parseToFeet(`10' 6 1/2"`, 'ft-in'), 10 + 6.5 / 12);
  almost(parseToFeet(`4 1/2"`, 'ft-in'), 0.375);
  assert.equal(parseToFeet('-2', 'ft'), -2);
  assert.equal(parseToFeet(`-2' 6"`, 'ft-in'), -2.5);
  for (const bad of ['abc', '', '12x', '1/0', `5' abc`]) assert.equal(parseToFeet(bad, 'ft-in'), null, bad);
});

test('format then parse round-trips to the display precision in every unit', () => {
  for (const unit of ['ft-in', 'ft', 'in', 'm']) {
    for (const v of [0.375, 2.5, 12, 12.5, 13.3333, 33.75]) {
      const back = parseToFeet(formatMeasurement(v, unit), unit);
      assert.ok(Math.abs(back - v) < 0.02, `${unit} ${v} -> ${formatMeasurement(v, unit)} -> ${back}`);
    }
  }
});

test('thin dimensions are displayed accurately', () => {
  assert.equal(formatMeasurement(0.375, 'ft-in'), `0' 4 1/2"`);
  assert.equal(formatMeasurement(12.5, 'ft-in'), `12' 6"`);
  assert.equal(formatMeasurement(11.999, 'ft-in'), `12' 0"`);
  assert.equal(formatMeasurement(-2.5, 'ft-in'), `-2' 6"`);
  assert.equal(formatMeasurement(0, 'ft-in'), `0' 0"`);
  assert.equal(formatMeasurement(10, 'm'), '3.05 m');
  assert.equal(formatArea(100, 'm').startsWith('9.3 sq.m'), true);
});

test('leaving a field untouched never changes the geometry', () => {
  // 13.3333 displays as a rounded value: re-parsing it would move the wall.
  const shown = formatMeasurement(13.3333, 'ft');
  assert.deepEqual(resolveMeasurementCommit(shown, 13.3333, 'ft'), { action: 'none' });
  assert.deepEqual(resolveMeasurementCommit(formatMeasurement(9.123, 'm'), 9.123, 'm'), { action: 'none' });
  assert.equal(resolveMeasurementCommit('14', 13.3333, 'ft').value, 14);
  assert.equal(resolveMeasurementCommit('abc', 10, 'ft').action, 'revert');
  assert.equal(resolveMeasurementCommit('1', 10, 'ft', { min: 2.5 }).action, 'revert');
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const SITE = (l) => JSON.stringify({ plot: l.plot, ext: l.walls.filter((w) => w.type === 'exterior') });

test('every room edge and corner moves by the exact amount, with the opposite side fixed', () => {
  const base = buildFixture();
  const r0 = byId(base.rooms, 'living'); // 2..17 x 16..28
  const cases = [
    { handle: 'e', dx: 1, dy: 0, want: { x: 2, y: 16, width: 16, length: 12 } },
    { handle: 's', dx: 0, dy: -1, want: { x: 2, y: 16, width: 15, length: 11 } },
    { handle: 'n', dx: 0, dy: -1, want: { x: 2, y: 15, width: 15, length: 13 } },
    { handle: 'se', dx: 1, dy: -1, want: { x: 2, y: 16, width: 16, length: 11 } },
    { handle: 'ne', dx: 1, dy: -1, want: { x: 2, y: 15, width: 16, length: 13 } },
  ];
  for (const c of cases) {
    const res = resizeRoom(base, 'living', edgeTargetsForHandle(r0, c.handle, c.dx, c.dy));
    assert.deepEqual(res.conflicts, [], c.handle);
    for (const k of Object.keys(c.want)) almost(res.room[k], c.want[k]);
    assert.equal(SITE(res.layout), SITE(base), `${c.handle}: site never moves`);
  }
  // West edge and its corners lie on the exterior wall on this fixture, so test
  // them on a room whose west edge is interior.
  const t0 = byId(base.rooms, 'store'); // 22..28 x 4..16
  const west = resizeRoom(base, 'store', edgeTargetsForHandle(t0, 'w', -1, 0));
  almost(west.room.x + west.room.width, 28);
  almost(west.room.width, 7);
  const sw = resizeRoom(base, 'store', edgeTargetsForHandle(t0, 'sw', -1, 1));
  almost(sw.room.width, 7);
  almost(sw.room.length, 13);
  const k0 = byId(base.rooms, 'kitchen'); // 22..28 x 16..28
  const nw = resizeRoom(base, 'kitchen', edgeTargetsForHandle(k0, 'nw', -1, -1));
  almost(nw.room.width, 7);
  almost(nw.room.length, 13);
  almost(nw.room.y + nw.room.length, 28);
});

test('a numeric size moves the free edge when the usual edge is on the exterior wall', () => {
  const base = buildFixture();
  const res = setRoomDimension(base, 'bed3', 'length', 10); // south edge is on the exterior wall
  assert.deepEqual(res.conflicts, []);
  almost(res.room.length, 10);
  almost(res.room.y + res.room.length, 36, 1e-6);
  assert.equal(SITE(res.layout), SITE(base), 'the site never moves');
  const east = setRoomDimension(base, 'store', 'width', 7); // east edge is on the exterior wall
  almost(east.room.width, 7);
  almost(east.room.x + east.room.width, 28, 1e-6);
});

test('numeric width and length, and area, match the geometry', () => {
  const res = setRoomDimension(buildFixture(), 'living', 'width', 16.5);
  almost(res.room.width, 16.5);
  almost(res.room.x, 2);
  almost(res.room.width * res.room.length, 198);
});

test('moving a room preserves its size and stays inside the site', () => {
  const base = buildFixture();
  const moved = moveRoom(base, 'bath', 0.5, 0);
  const b0 = byId(base.rooms, 'bath');
  almost(moved.room.width, b0.width);
  almost(moved.room.length, b0.length);
  almost(moved.room.x, b0.x + 0.5);
  const far = moveRoom(base, 'bath', 500, 500);
  almost(far.room.x, base.plot.width - b0.width);
  almost(far.room.y, base.plot.length - b0.length);
  const back = moveRoom(base, 'bath', -500, -500);
  almost(back.room.x, 0);
  almost(back.room.y, 0);
});

test('a staircase inside a moved room travels with it; a locked room does not move', () => {
  const base = buildFixture();
  base.staircases = [createStaircase({ id: 'in', stairType: 'straight', x: 4, y: 18, width: 3.5, risers: 7 })];
  const res = moveRoom(base, 'living', 0, 0.5);
  almost(byId(res.layout.staircases, 'in').y, 18.5);
  const locked = cloneLayout(base);
  byId(locked.rooms, 'living').isLocked = true;
  assert.equal(moveRoom(locked, 'living', 1, 1).layout, locked);
});

test('lock width stops a direct resize along that axis only', () => {
  const base = buildFixture();
  byId(base.rooms, 'living').lockWidth = true;
  const w = setRoomDimension(base, 'living', 'width', 20);
  almost(w.room.width, 15);
  assert.ok(w.conflicts.length > 0);
  const l = setRoomDimension(base, 'living', 'length', 11);
  almost(l.room.length, 11);
});

test('a locked wall stops a room edge that lies on it', () => {
  const base = buildFixture();
  const shared = base.walls.find((w) => w.type !== 'exterior' && Math.abs(w.x1 - 17) < 0.01 && Math.abs(w.x2 - 17) < 0.01 && Math.max(w.y1, w.y2) > 16 && Math.min(w.y1, w.y2) < 28);
  shared.isLocked = true;
  const res = resizeRoom(base, 'living', { right: 18 });
  assert.equal(res.clamped, true);
  almost(res.room.width, 15);
});

test('room snapping stays on centrelines and can be switched off', () => {
  const base = buildFixture();
  const r = byId(base.rooms, 'bath');
  // Near the x=17 wall line: lands on it exactly rather than on a wall face.
  const on = findRoomSnapping({ ...r, x: 16.9 }, base, { excludeRoomId: 'bath', handle: 'body', viewportScale: 18 });
  almost(on.snappedRoom.x, 17);
  const off = findRoomSnapping({ ...r, x: 16.83 }, base, { excludeRoomId: 'bath', handle: 'body', viewportScale: 18, snapEnabled: false });
  almost(off.snappedRoom.x, 16.83);
  assert.deepEqual(off.guides, []);
});

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

test('moving one wall endpoint never moves the other', () => {
  const l = plotWithWall();
  const res = moveWallEndpointTo(l, 'w', 'p2', { x: 30, y: 10 });
  const w = byId(res.layout.walls, 'w');
  assert.deepEqual([w.x1, w.y1, w.x2, w.y2], [5, 10, 30, 10]);
  const start = moveWallEndpointTo(l, 'w', 'p1', { x: 2, y: 10 });
  const s = byId(start.layout.walls, 'w');
  assert.deepEqual([s.x1, s.y1, s.x2, s.y2], [2, 10, 25, 10]);
});

test('an axis-aligned wall keeps its axis unless diagonals are allowed', () => {
  const l = plotWithWall();
  const locked = byId(moveWallEndpointTo(l, 'w', 'p2', { x: 30, y: 15 }).layout.walls, 'w');
  assert.deepEqual([locked.x2, locked.y2], [30, 10]);
  const free = byId(moveWallEndpointTo(l, 'w', 'p2', { x: 30, y: 15 }, { allowDiagonal: true }).layout.walls, 'w');
  assert.deepEqual([free.x2, free.y2], [30, 15]);
});

test('a perpendicular neighbour stays straight; a collinear neighbour stays connected', () => {
  const l = plotWithWall();
  l.walls.push(createWall({ id: 'perp', x1: 25, y1: 10, x2: 25, y2: 20 }));
  l.walls.push(createWall({ id: 'col', x1: 25, y1: 10, x2: 35, y2: 10 }));
  const res = moveWallEndpointTo(l, 'w', 'p2', { x: 27, y: 10 });
  const perp = byId(res.layout.walls, 'perp');
  assert.deepEqual([perp.x1, perp.y1, perp.x2], [25, 10, 25], 'perpendicular wall did not become diagonal');
  const col = byId(res.layout.walls, 'col');
  assert.deepEqual([col.x1, col.y1], [27, 10], 'collinear neighbour follows');
  const diag = moveWallEndpointTo(l, 'w', 'p2', { x: 27, y: 12 }, { allowDiagonal: true });
  const p2 = byId(diag.layout.walls, 'perp');
  assert.deepEqual([p2.x1, p2.y1], [27, 12], 'with diagonals on, the corner stays joined');
});

test('wall length edits give the exact length along the same direction', () => {
  const l = plotWithWall();
  const w = byId(setWallLength(l, 'w', 12.5).layout.walls, 'w');
  assert.deepEqual([w.x1, w.y1, w.x2, w.y2], [5, 10, 17.5, 10]);
  const e = byId(setWallLength(l, 'w', 12.5, 'end').layout.walls, 'w');
  assert.deepEqual([e.x1, e.x2], [12.5, 25]);
  const d = cloneLayout(l);
  Object.assign(d.walls[0], { x2: 8, y2: 14 }); // 3-4-5 triangle, length 5
  const dw = byId(setWallLength(d, 'w', 10).layout.walls, 'w');
  almost(dw.x2, 11);
  almost(dw.y2, 18);
  assert.ok(setWallLength(l, 'w', 0.01).reason);
});

test('a wall too short to exist is rejected', () => {
  const res = moveWallEndpointTo(plotWithWall(), 'w', 'p2', { x: 5.1, y: 10 });
  assert.ok(res.reason);
  almost(byId(res.layout.walls, 'w').x2, 25);
  assert.equal(buildWall({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
});

test('changing wall type and thickness is one edit', () => {
  const l = plotWithWall();
  const w = byId(setWallProps(l, 'w', { type: 'exterior', thickness: 0.75 }).walls, 'w');
  assert.equal(w.type, 'exterior');
  assert.equal(w.thickness, 0.75);
});

test('dragging a wall with no rooms translates it exactly and neighbours stretch', () => {
  const l = plotWithWall();
  l.walls.push(createWall({ id: 'perp', x1: 25, y1: 10, x2: 25, y2: 20 }));
  const res = moveWallBody(l, 'w', 3, 2); // joined and horizontal: only y moves
  const w = byId(res.layout.walls, 'w');
  assert.deepEqual([w.x1, w.y1, w.x2, w.y2], [5, 12, 25, 12]);
  const perp = byId(res.layout.walls, 'perp');
  assert.deepEqual([perp.x1, perp.y1, perp.x2, perp.y2], [25, 12, 25, 20]);
  const free = byId(moveWallBody(plotWithWall(), 'w', 3, 2).layout.walls, 'w');
  assert.deepEqual([free.x1, free.y1, free.x2, free.y2], [8, 12, 28, 12]);
});

test('dragging a shared wall resizes the rooms beside it, and the site stays put', () => {
  const base = buildFixture();
  const wall = base.walls.find((w) => w.type !== 'exterior' && Math.abs(w.y1 - 28) < 0.01 && Math.abs(w.y2 - 28) < 0.01 && Math.min(w.x1, w.x2) < 10);
  const res = moveWallBody(base, wall.id, 0, -1);
  assert.equal(SITE(res.layout), SITE(base));
  almost(byId(res.layout.rooms, 'living').length, 11);
});

test('a locked wall does not move', () => {
  const l = plotWithWall({ isLocked: true });
  assert.equal(moveWallBody(l, 'w', 1, 1).layout, l);
  assert.equal(moveWallEndpointTo(l, 'w', 'p2', { x: 30, y: 10 }).layout, l);
});

test('split and join restore the wall and keep openings hosted', () => {
  const l = plotWithWall();
  l.doors = [createDoor({ id: 'd', x: 20, y: 10, width: 3, wallId: 'w' })];
  const split = splitWall(l, 'w', { x: 15, y: 10 });
  assert.equal(split.layout.walls.length, 2);
  const door = byId(split.layout.doors, 'd');
  assert.equal(door.wallId, split.segments[1].id, 'door moved to its segment');
  almost(door.x, 20);
  const [a, b] = split.segments;
  const joined = joinWallPair(split.layout, a.id, b.id);
  assert.equal(joined.layout.walls.length, 1);
  const j = joined.layout.walls[0];
  assert.deepEqual([j.x1, j.y1, j.x2, j.y2], [5, 10, 25, 10]);
  assert.equal(byId(joined.layout.doors, 'd').wallId, a.id);
});

test('join refuses incompatible walls', () => {
  const l = plotWithWall();
  l.walls.push(createWall({ id: 'perp', x1: 25, y1: 10, x2: 25, y2: 20, thickness: 0.5 }));
  l.walls.push(createWall({ id: 'thick', x1: 25, y1: 10, x2: 35, y2: 10, thickness: 1 }));
  l.walls.push(createWall({ id: 'far', x1: 30, y1: 10, x2: 35, y2: 10, thickness: 0.5 }));
  assert.ok(joinWallPair(l, 'w', 'perp').reason, 'not collinear');
  assert.ok(joinWallPair(l, 'w', 'thick').reason, 'different thickness');
  assert.ok(joinWallPair(l, 'w', 'far').reason, 'not touching');
});

test('ortho helper picks the dominant axis', () => {
  assert.deepEqual(orthoPoint({ x: 0, y: 0 }, { x: 5, y: 1 }), { x: 5, y: 0 });
  assert.deepEqual(orthoPoint({ x: 0, y: 0 }, { x: 1, y: 5 }), { x: 0, y: 5 });
});

// ---------------------------------------------------------------------------
// Doors and windows
// ---------------------------------------------------------------------------

test('adding an opening attaches it to the nearest wall, on the centreline', () => {
  const l = plotWithWall();
  const place = placeOpeningOnWall(l, createDoor({ width: 3 }), { x: 12, y: 10.8 });
  assert.equal(place.wallId, 'w');
  assert.deepEqual([place.x, place.y], [12, 10]);
  assert.equal(placeOpeningOnWall(l, createDoor({ width: 3 }), { x: 12, y: 20 }), null, 'no wall nearby');
});

test('openings cannot extend past the wall ends or overlap each other', () => {
  const l = plotWithWall(); // 5..25
  const p = placeOpeningOnWall(l, createDoor({ width: 4 }), { x: 5.5, y: 10 });
  assert.equal(p.x, 7, 'clamped so the whole opening is on the wall');
  l.doors = [createDoor({ id: 'd1', x: 15, y: 10, width: 4, wallId: 'w' })];
  const win = placeOpeningOnWall(l, createWindow({ id: 'n', width: 4 }), { x: 15, y: 10 });
  const gap = Math.abs(win.x - 15) - 4;
  assert.ok(gap >= 0.25 - 1e-6, `clear of the door, gap ${gap}`);
  const long = placeOpeningOnWall(l, createWindow({ id: 'n', width: 30 }), { x: 15, y: 10 });
  assert.equal(long, null, 'wider than the wall');
});

test('dragging an opening slides along the wall; off-wall it is refused', () => {
  const l = plotWithWall();
  l.doors = [createDoor({ id: 'd', x: 10, y: 10, width: 3, wallId: 'w' })];
  const res = moveOpening(l, 'door', 'd', { x: 20, y: 10.5 });
  assert.deepEqual([byId(res.layout.doors, 'd').x, byId(res.layout.doors, 'd').y], [20, 10]);
  const off = moveOpening(l, 'door', 'd', { x: 20, y: 30 });
  assert.equal(off.moved, false);
  assert.equal(off.layout, l);
});

test('an opening can move to another wall and takes its orientation', () => {
  const l = plotWithWall();
  l.walls.push(createWall({ id: 'v', x1: 30, y1: 5, x2: 30, y2: 25 }));
  l.doors = [createDoor({ id: 'd', x: 10, y: 10, width: 3, wallId: 'w' })];
  const res = moveOpening(l, 'door', 'd', { x: 30.5, y: 15 });
  const d = byId(res.layout.doors, 'd');
  assert.equal(d.wallId, 'v');
  assert.deepEqual([d.x, d.y], [30, 15]);
  const g = getOpeningGeometry(d, res.layout.walls);
  almost(Math.abs(g.uy), 1);
  almost(g.ux, 0);
});

test('opening width and position inputs use the real wall', () => {
  const l = plotWithWall();
  l.doors = [createDoor({ id: 'd', x: 10, y: 10, width: 3, wallId: 'w' })];
  assert.equal(getOpeningPosition(l.doors[0], l.walls), 5);
  const at = setOpeningPosition(l, 'door', 'd', 12);
  assert.equal(byId(at.layout.doors, 'd').x, 17);
  const wide = resizeOpening(l, 'door', 'd', 5);
  assert.equal(byId(wide.layout.doors, 'd').width, 5);
  assert.equal(byId(wide.layout.doors, 'd').x, 10, 'the centre stays');
  // Jamb handle: the far jamb stays put.
  const jamb = resizeOpening(l, 'door', 'd', 5, 'a');
  assert.equal(byId(jamb.layout.doors, 'd').x, 11);
  // Stops at the wall end.
  const huge = resizeOpening(l, 'door', 'd', 100);
  assert.equal(byId(huge.layout.doors, 'd').width, 20);
  assert.ok(huge.reason);
});

test('door geometry honours type, hinge and swing', () => {
  const l = plotWithWall();
  const d = createDoor({ id: 'd', x: 10, y: 10, width: 3, wallId: 'w', hinge: 'left', swing: 'inward' });
  const g = getOpeningGeometry(d, l.walls);
  assert.deepEqual(g.a, { x: 8.5, y: 10 });
  assert.deepEqual(g.b, { x: 11.5, y: 10 });
  assert.deepEqual(g.leaves[0].hinge, g.a);
  almost(g.leaves[0].tip.y, 13, 1e-9);
  const right = getOpeningGeometry({ ...d, hinge: 'right' }, l.walls);
  assert.deepEqual(right.leaves[0].hinge, g.b);
  const out = getOpeningGeometry({ ...d, swing: 'outward' }, l.walls);
  almost(out.leaves[0].tip.y, 7, 1e-9);
  const dbl = getOpeningGeometry({ ...d, type: 'double' }, l.walls);
  assert.equal(dbl.leaves.length, 2);
  assert.equal(dbl.leaves[0].radius, 1.5);
  assert.equal(getOpeningGeometry({ ...d, type: 'sliding' }, l.walls).leaves.length, 0);
});

test('changing the host wall carries its openings', () => {
  const l = plotWithWall();
  l.doors = [createDoor({ id: 'd', x: 20, y: 10, width: 3, wallId: 'w' })];
  // Body move
  const moved = moveWallBody(l, 'w', 0, 3);
  assert.deepEqual([byId(moved.layout.doors, 'd').x, byId(moved.layout.doors, 'd').y], [20, 13]);
  // Shortening from the far end slides the door back on
  const short = moveWallEndpointTo(l, 'w', 'p2', { x: 18, y: 10 });
  const d = byId(short.layout.doors, 'd');
  assert.equal(d.x, 16.5);
  // Moving the near end keeps its distance from the far end
  const near1 = moveWallEndpointTo(l, 'w', 'p1', { x: 2, y: 10 });
  assert.equal(byId(near1.layout.doors, 'd').x, 20);
  // Tilting keeps it on the wall
  const tilt = moveWallEndpointTo(l, 'w', 'p2', { x: 25, y: 30 }, { allowDiagonal: true });
  assert.ok(getOpeningHost(byId(tilt.layout.doors, 'd'), tilt.layout.walls, 1e-3));
  // Nothing changed: same objects
  const same = reattachOpenings(l, { ...l });
  assert.deepEqual(same.doors, l.doors);
});

test('room resize keeps openings attached and exactly on their walls', () => {
  const base = buildFixture();
  const res = setRoomDimension(base, 'master', 'length', 13);
  for (const o of [...res.layout.doors, ...res.layout.windows]) {
    assert.ok(getOpeningHost(o, res.layout.walls, 1e-3), `${o.id} on a wall`);
  }
});

test('a detached opening is reported by validation; a hosted one is not', () => {
  const l = plotWithWall();
  l.doors = [createDoor({ id: 'good', x: 10, y: 10, width: 3 }), createDoor({ id: 'bad', x: 30, y: 30, width: 3 })];
  const ids = validateLayout(l).filter((i) => i.title === 'Detached Door').map((i) => i.elementId);
  assert.deepEqual(ids, ['bad']);
});

test('generated plans attach every opening to a wall', () => {
  const state = {
    ownerName: 'T', siteLength: '40', siteWidth: '30', eastOpen: '2', westOpen: '2', northOpen: '4', southOpen: '4',
    mainDoorDirection: 'North', customRooms: [{ id: '1', name: 'Kitchen', width: '8', length: '10' }, { id: '2', name: 'Master Bedroom', width: '9', length: '12' }],
  };
  const l = generateStructuredLayoutFromState(state);
  for (const o of [...l.doors, ...l.windows]) assert.ok(getOpeningHost(o, l.walls), `${o.id} has a host`);
});

// ---------------------------------------------------------------------------
// Staircase
// ---------------------------------------------------------------------------

test('width and length change the real footprint; step count is preserved', () => {
  const s = createStaircase({ id: 's', stairType: 'straight', x: 1, y: 1, width: 3.5, risers: 13 });
  const wider = normalizeStaircase({ ...s, width: 4 }, 'width');
  assert.equal(calculateStaircaseGeometry(wider).bounds.width, 4);
  assert.equal(wider.risers, 13);
  const longer = normalizeStaircase({ ...s, length: 12 }, 'length');
  assert.equal(longer.length, 12);
  almost(longer.treadDepth, 1);
  assert.equal(longer.risers, 13);
  assert.equal(calculateStaircaseGeometry(longer).flights[0].treads.length, 11, 'lines between 12 treads');
});

test('step count and tread depth regenerate the steps', () => {
  const s = createStaircase({ id: 's', stairType: 'straight', width: 3.5, risers: 11, treadDepth: 1 });
  assert.equal(s.length, 10);
  const more = normalizeStaircase({ ...s, risers: 21 }, 'risers');
  assert.equal(more.length, 20);
  const geo = calculateStaircaseGeometry(more);
  almost(Math.abs(geo.flights[0].treads[0].y1 - geo.flights[0].treads[1].y1), 1);
  const deep = normalizeStaircase({ ...s, treadDepth: 1.25 }, 'treadDepth');
  assert.equal(deep.length, 12.5);
  const fromTreads = normalizeStaircase({ ...s, treads: 15 }, 'treads');
  assert.equal(fromTreads.risers, 16);
  assert.equal(fromTreads.treads, 15);
});

test('riser height comes from floor height and riser count, in both directions', () => {
  const s = createStaircase({ id: 's', width: 6, floorHeight: 10, risers: 20 });
  assert.equal(s.riserHeight, 0.5);
  const tall = normalizeStaircase({ ...s, floorHeight: 12 }, 'floorHeight');
  assert.equal(tall.riserHeight, 0.6);
  assert.equal(tall.risers, 20);
  const set = normalizeStaircase({ ...s, riserHeight: 0.625 }, 'riserHeight');
  assert.equal(set.risers, 16, '10 ft / 7.5 in');
  assert.equal(set.riserHeight, 0.625);
});

test('steps per flight can be set; landing size changes real geometry', () => {
  const s = createStaircase({ id: 's', stairType: 'dog-legged', width: 6, risers: 18, landingDepth: 3 });
  assert.deepEqual(s.stepsPerFlight, [8, 8]);
  const uneven = normalizeStaircase({ ...s, firstFlightRisers: 11 }, 'firstFlightRisers');
  assert.deepEqual(uneven.stepsPerFlight, [10, 6]);
  assert.equal(uneven.risers, 18);
  const g = calculateStaircaseGeometry(uneven);
  assert.equal(g.flights[0].treads.length, 9);
  assert.equal(g.flights[1].treads.length, 5);
  almost(uneven.length, 10 * uneven.treadDepth + 3);
  // Landing length
  const landing = normalizeStaircase({ ...s, landingDepth: 4 }, 'landingDepth');
  almost(landing.length, s.length + 1);
  const poly = calculateStaircaseGeometry(landing).landings[0].polygon;
  almost(Math.abs(poly[0].y - poly[3].y), 4);
  // Landing width is the width of the two flights and the well
  const wide = normalizeStaircase({ ...s, width: 8 }, 'width');
  const wpoly = calculateStaircaseGeometry(wide).landings[0].polygon;
  almost(Math.abs(wpoly[0].x - wpoly[1].x), 8);
});

test('a riser edit resets a custom split that no longer fits', () => {
  const s = normalizeStaircase({ ...createStaircase({ id: 's', stairType: 'dog-legged', width: 6, risers: 18 }), firstFlightRisers: 15 }, 'firstFlightRisers');
  const fewer = normalizeStaircase({ ...s, risers: 12 }, 'risers');
  assert.equal(fewer.firstFlightRisers, undefined);
  assert.deepEqual(fewer.stepsPerFlight, [5, 5]);
});

test('rotation keeps dimensions and centre at every quarter turn', () => {
  const s = createStaircase({ id: 's', stairType: 'straight', x: 10, y: 10, width: 4, risers: 13 });
  let cur = s;
  const b0 = getStaircaseBounds(s);
  const cx = b0.x + b0.width / 2;
  const cy = b0.y + b0.length / 2;
  for (let i = 0; i < 4; i++) {
    cur = rotateStaircase(cur, 90);
    const b = getStaircaseBounds(cur);
    almost(b.x + b.width / 2, cx);
    almost(b.y + b.length / 2, cy);
    assert.equal(cur.width, s.width);
    assert.equal(cur.length, s.length);
  }
  assert.equal(cur.rotation, 0);
});

test('mirroring flips the plan without changing the footprint', () => {
  const s = createStaircase({ id: 's', stairType: 'dog-legged', x: 0, y: 0, width: 6, risers: 18 });
  const a = calculateStaircaseGeometry(s);
  const b = calculateStaircaseGeometry({ ...s, mirrored: true });
  assert.deepEqual(a.bounds, b.bounds);
  almost(a.arrow.points[0].x, 6 - b.arrow.points[0].x);
});

test('resize handles work after rotation; moving keeps the internal geometry', () => {
  const s = rotateStaircase(createStaircase({ id: 's', stairType: 'straight', x: 0, y: 0, width: 4, risers: 13 }), 90);
  const b = getStaircaseBounds(s);
  const longer = resizeStaircaseWorld(s, 'x', b.width + 2);
  assert.equal(getStaircaseBounds(longer).width, b.width + 2, 'x is the run at 90 degrees');
  assert.equal(longer.width, s.width);
  const moved = { ...s, x: s.x + 3, y: s.y + 4 };
  const g0 = calculateStaircaseGeometry(s);
  const g1 = calculateStaircaseGeometry(moved);
  almost(g1.flights[0].treads[2].x1 - g0.flights[0].treads[2].x1, 3);
  almost(g1.flights[0].treads[2].y1 - g0.flights[0].treads[2].y1, 4);
});

test('insufficient space produces a clear warning', () => {
  const l = createDefaultLayout({ siteWidth: 20, siteLength: 20 });
  const s = createStaircase({ id: 's', stairType: 'straight', x: 5, y: 5, width: 4, risers: 31 });
  const check = validateStaircaseFit(s, l);
  assert.ok(check.warnings.some((w) => /beyond the plot/.test(w)), JSON.stringify(check.warnings));
});

test('site resize respects staircase size', () => {
  const base = buildFixture();
  const stair0 = byId(base.staircases, 'stair');
  const res = applySiteChange(base, { width: 32, edge: 'right' });
  const stair1 = byId(res.nextLayout.staircases, 'stair');
  assert.equal(stair1.width, stair0.width);
  assert.equal(stair1.length, stair0.length);
  assert.equal(stair1.risers, stair0.risers);
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test('selection picks the intended object at each zoom, not its neighbour', () => {
  const base = buildFixture();
  for (const scale of [6, 18, 40, 80]) {
    // Middle of a room, far from any wall
    assert.equal(hitTestAll(base, 9, 22, scale)[0].type, 'room', `room at ${scale}`);
    assert.equal(hitTestAll(base, 9, 22, scale)[0].data.id, 'living');
    // Exactly on a wall
    assert.equal(hitTestAll(base, 17, 22, scale)[0].type, 'wall', `wall at ${scale}`);
    // On a door
    assert.equal(hitTestAll(base, 9.5, 16, scale)[0].data.id, 'd-master', `door at ${scale}`);
    // On a window
    assert.equal(hitTestAll(base, 9.5, 4, scale)[0].data.id, 'w-master', `window at ${scale}`);
    // Outside the plot: nothing
    assert.equal(hitTestAll(base, -5, -5, scale).length, 0);
  }
});

test('pick tolerance is constant in pixels, not feet', () => {
  const base = buildFixture();
  // 0.4 ft beside the interior wall centreline (half thickness 0.1875 ft)
  const atLowZoom = hitTestAll(base, 17.4, 22, 6)[0]; // 2.4 px away
  const atHighZoom = hitTestAll(base, 17.4, 22, 80)[0]; // 32 px away
  assert.equal(atLowZoom.type, 'wall');
  assert.notEqual(atHighZoom.type, 'wall');
});

test('a click near but not on a door does not select the door', () => {
  const base = buildFixture();
  // Previously anything within 2 ft of a door selected the door.
  const hit = hitTestAll(base, 9.5, 17.5, 18)[0];
  assert.equal(hit.type, 'room');
  assert.equal(hit.data.id, 'living');
});

test('every object type can be selected', () => {
  const base = buildFixture();
  base.columns = [createColumn({ id: 'c', x: 1, y: 1, size: 1 })];
  base.parking = [createParking({ id: 'pk', x: 0.2, y: 37, width: 1.5, length: 2.5 })];
  base.annotations = [{ id: 'a', x: 5, y: 2, text: 'Hello', fontSize: 12 }];
  base.dimensions.push({ id: 'dm', x1: 3, y1: 2, x2: 8, y2: 2, offset: 0 });
  base.cadEntities = [{ id: 'e', kind: 'line', x1: 20, y1: 1, x2: 25, y2: 1 }];
  base.utilities = [{ id: 'u', x: 25, y: 37, width: 2, length: 2, name: 'Sump' }];
  const type = (x, y) => hitTestAll(base, x, y, 18)[0]?.type;
  assert.equal(type(1, 1), 'column');
  assert.equal(type(1, 38), 'parking');
  assert.equal(type(5.3, 1.8), 'annotation');
  assert.equal(type(4, 2), 'dimension');
  assert.equal(type(22, 1), 'entity');
  assert.equal(type(26, 38), 'utility');
  assert.equal(type(19, 18), 'staircase');
});

test('clicks cycle through overlapping objects predictably', () => {
  const base = buildFixture();
  const hits = hitTestAll(base, 18.5, 18, 18, { includePlot: false }); // staircase inside the gap, above nothing else
  base.rooms.push({ ...byId(base.rooms, 'living'), id: 'over', x: 17.5, y: 17, width: 4, length: 4, name: 'Over' });
  const over = hitTestAll(base, 18.5, 18, 18, { includePlot: false });
  assert.ok(hits.length >= 1);
  assert.deepEqual(over.map((h) => h.type), ['staircase', 'room']);
  const second = nextOverlappingHit(over, { type: over[0].type, data: over[0].data });
  assert.equal(second.type, 'room');
  const wrapped = nextOverlappingHit(over, { type: second.type, data: second.data });
  assert.equal(wrapped.type, 'staircase');
});

test('of two overlapping rooms the smaller is picked first', () => {
  const base = buildFixture();
  base.rooms.push({ ...byId(base.rooms, 'living'), id: 'small', x: 5, y: 20, width: 3, length: 3 });
  assert.equal(hitTestAll(base, 6, 21, 18)[0].data.id, 'small');
});

test('box selection: window takes what is inside, crossing what it touches', () => {
  const base = buildFixture();
  const win = boxSelect(base, { x: 1, y: 15 }, { x: 18, y: 29 }, 18).filter((r) => r.type === 'room').map((r) => r.id);
  assert.deepEqual(win, ['living']);
  const cross = boxSelect(base, { x: 18, y: 29 }, { x: 16, y: 27 }, 18).filter((r) => r.type === 'room').map((r) => r.id).sort();
  assert.ok(cross.includes('living') && cross.includes('bath') && cross.includes('bed3'), JSON.stringify(cross));
});

test('shift-toggling builds and shrinks a multi-selection', () => {
  const base = buildFixture();
  const room = { type: 'room', data: byId(base.rooms, 'living') };
  const door = { type: 'door', data: byId(base.doors, 'd-master') };
  let sel = toggleInSelection(base, null, room);
  assert.equal(sel.type, 'room');
  sel = toggleInSelection(base, sel, door);
  assert.equal(sel.type, 'multi');
  assert.equal(selectionItems(sel).length, 2);
  assert.ok(isItemSelected(sel, 'door', 'd-master'));
  sel = toggleInSelection(base, sel, room);
  assert.equal(sel.type, 'door');
  sel = toggleInSelection(base, sel, door);
  assert.equal(sel, null);
});

test('stale selection entries are dropped', () => {
  const base = buildFixture();
  const sel = selectionFromItems(base, [{ type: 'room', id: 'living' }, { type: 'room', id: 'gone' }]);
  assert.equal(sel.type, 'room');
  assert.equal(selectionFromItems(base, [{ type: 'room', id: 'gone' }]), null);
});

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

test('each snap kind lands on the right geometric point', () => {
  const l = plotWithWall(); // wall 5..25 at y=10
  l.walls.push(createWall({ id: 'x', x1: 15, y1: 5, x2: 15, y2: 15 })); // crosses at (15, 10)
  l.rooms = [{ id: 'r', x: 30, y: 30, width: 6, length: 4, name: 'R' }];
  const at = (x, y, opts = {}) => findPointSnap({ x, y }, l, { scale: 20, pixelTolerance: 12, ...opts });

  let s = at(5.2, 10.2);
  assert.equal(s.kind, 'endpoint');
  assert.deepEqual([s.x, s.y], [5, 10]);

  s = at(15.3, 10.2);
  assert.equal(s.kind, 'intersection');
  assert.deepEqual([s.x, s.y], [15, 10]);

  s = at(10.1, 10.2);
  assert.equal(s.kind, 'wall', 'away from any special point it lands on the wall');
  assert.deepEqual([s.x, s.y], [10, 10]);
});

test('midpoint, centre, wall, room edge, site and perpendicular snaps', () => {
  const l = plotWithWall(); // midpoint at 15,10
  l.rooms = [{ id: 'r', x: 30, y: 30, width: 6, length: 4, name: 'R' }];
  const at = (x, y, opts = {}) => findPointSnap({ x, y }, l, { scale: 20, pixelTolerance: 12, ...opts });

  let s = at(15.2, 10.1);
  assert.equal(s.kind, 'midpoint');
  assert.deepEqual([s.x, s.y], [15, 10]);

  s = at(33.1, 32.2);
  assert.equal(s.kind, 'center');
  assert.deepEqual([s.x, s.y], [33, 32]);

  s = at(20.3, 10.3);
  assert.equal(s.kind, 'wall');
  assert.deepEqual([s.x, s.y], [20.5, 10], 'on the wall, and on the grid along it');

  s = at(31.2, 30.2);
  assert.equal(s.kind, 'room-edge');
  assert.deepEqual([s.x, s.y], [31, 30]);

  s = at(7.3, 0.2);
  assert.equal(s.kind, 'site');
  assert.deepEqual([s.x, s.y], [7.5, 0]);

  s = at(12.1, 10.4, { from: { x: 12, y: 3 } });
  assert.equal(s.kind, 'perpendicular');
  assert.deepEqual([s.x, s.y], [12, 10]);

  s = at(12.2, 20.2);
  assert.equal(s.kind, 'grid');
  assert.deepEqual([s.x, s.y], [12, 20]);
});

test('snap tolerance is the same in pixels at every zoom', () => {
  const l = plotWithWall();
  // 10 px from the endpoint at each scale, tolerance 12 px.
  for (const scale of [6, 18, 40, 80]) {
    const off = 10 / scale;
    const s = findPointSnap({ x: 5 + off, y: 10 }, l, { scale, pixelTolerance: 12 });
    assert.equal(s.kind, 'endpoint', `scale ${scale}`);
  }
  // 20 px away is out of range at every scale.
  for (const scale of [18, 40, 80]) {
    const off = 20 / scale;
    const s = findPointSnap({ x: 5 - off * 0.6, y: 10 + off * 0.8 }, l, { scale, pixelTolerance: 12 });
    assert.notEqual(s.kind, 'endpoint', `scale ${scale}`);
  }
});

test('an oblique wall keeps the exact projection, not a grid value', () => {
  const l = plotWithWall();
  l.walls = [createWall({ id: 'd', x1: 0, y1: 0, x2: 30, y2: 30 })];
  const s = findPointSnap({ x: 10.3, y: 10.1 }, l, { scale: 20, pixelTolerance: 12 });
  assert.equal(s.kind, 'wall');
  almost(s.x, 10.2);
  almost(s.y, 10.2);
});

test('snapping can be disabled, and an edited wall does not snap to itself', () => {
  const l = plotWithWall();
  const raw = findPointSnap({ x: 5.13, y: 10.07 }, l, { scale: 20, snapEnabled: false });
  assert.deepEqual([raw.x, raw.y, raw.kind], [5.13, 10.07, null]);
  const s = findPointSnap({ x: 5.1, y: 10.1 }, l, { scale: 20, excludeWallId: 'w' });
  assert.notEqual(s.kind, 'endpoint');
});

// ---------------------------------------------------------------------------
// Precision: zoom, pan, repeated edits
// ---------------------------------------------------------------------------

test('the same physical drag gives the same geometry at every zoom and pan', () => {
  const base = buildFixture();
  const results = [];
  for (const vp of [{ scale: 6, panX: 10, panY: 0 }, { scale: 18, panX: 120, panY: 80 }, { scale: 57.3, panX: -300, panY: 900 }, { scale: 80, panX: 33, panY: 77 }]) {
    const a = worldToScreenPoint(vp, 17, 22);
    const b = worldToScreenPoint(vp, 18.5, 22);
    const start = screenToWorldPoint(vp, a.x, a.y);
    const end = screenToWorldPoint(vp, b.x, b.y);
    const r0 = byId(base.rooms, 'living');
    const res = resizeRoom(base, 'living', edgeTargetsForHandle(r0, 'e', end.x - start.x, end.y - start.y));
    results.push(JSON.stringify(res.layout.rooms));
  }
  for (const r of results) assert.equal(r, results[0]);
});

test('screen and world conversions are exact inverses', () => {
  const vp = { scale: 37.31, panX: -412.7, panY: 88.3 };
  for (const [x, y] of [[0, 0], [12.345, 67.89], [-3, 100]]) {
    const s = worldToScreenPoint(vp, x, y);
    const w = screenToWorldPoint(vp, s.x, s.y);
    almost(w.x, x, 1e-9);
    almost(w.y, y, 1e-9);
  }
});

test('repeated edits do not accumulate floating-point error', () => {
  let l = buildFixture();
  for (let i = 0; i < 200; i++) {
    l = setRoomDimension(l, 'living', 'width', i % 2 ? 15 : 15.1).layout;
  }
  const r = byId(l.rooms, 'living');
  assert.equal(r.width, 15);
  assert.equal(r.x, 2);
  const w = moveWallBody(plotWithWall(), 'w', 0.1, 0.2).layout;
  let cur = w;
  for (let i = 0; i < 100; i++) cur = moveWallBody(cur, 'w', 0.1, 0).layout;
  const final = byId(cur.walls, 'w');
  assert.equal(final.x1, 15.1);
});

// ---------------------------------------------------------------------------
// Undo / redo / persistence
// ---------------------------------------------------------------------------

test('a whole drag is one undo step; redo restores it exactly', () => {
  const base = buildFixture();
  const h = new HistoryManager(base);
  h.beginDrag();
  let after = base;
  for (let i = 1; i <= 30; i++) {
    after = resizeRoom(base, 'living', { right: 17 + i * 0.05 }).layout;
    h.updateDuringDrag(after);
  }
  h.endDrag(h.getCurrent());
  assert.equal(h.undoStack.length, 1);
  assert.deepEqual(h.undo(), cloneLayout(base));
  assert.deepEqual(h.redo(), cloneLayout(after));
});

test('undo and redo do nothing while a drag is active', () => {
  const base = buildFixture();
  const h = new HistoryManager(base);
  h.pushState({ ...base, title: 'one' });
  h.beginDrag();
  h.updateDuringDrag({ ...base, title: 'dragging' });
  assert.equal(h.undo().title, 'dragging');
  assert.equal(h.undoStack.length, 1);
  h.cancelDrag();
  assert.equal(h.getCurrent().title, 'one');
});

test('an edit committed during a drag still undoes to before the drag', () => {
  const base = buildFixture();
  const h = new HistoryManager(base);
  h.beginDrag();
  h.updateDuringDrag({ ...base, title: 'preview' });
  h.pushState({ ...base, title: 'typed' });
  assert.equal(h.undo().title, base.title);
});

test('save and reopen keeps every kind of geometry, including CAD entities', async () => {
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  try {
    const l = buildFixture();
    l.cadEntities = [
      { id: 'a', kind: 'line', x1: 1, y1: 2, x2: 3, y2: 4 },
      { id: 'b', kind: 'circle', cx: 5, cy: 5, r: 2 },
      { id: 'c', kind: 'arc', cx: 5, cy: 5, r: 2, start: 0, end: 90 },
      { id: 'd', kind: 'polygon', closed: true, shape: 'rect', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
    ];
    l.annotations = [{ id: 'n', x: 1, y: 1, text: 'Note', fontSize: 12 }];
    l.columns = [createColumn({ id: 'co', x: 3, y: 3 })];
    const ok = await saveProject(l);
    assert.equal(ok, true);
    const back = loadProject('fixture');
    for (const k of ['rooms', 'walls', 'doors', 'windows', 'staircases', 'columns', 'cadEntities', 'annotations', 'dimensions']) {
      assert.deepEqual(back[k], l[k], k);
    }
    assert.deepEqual(back.plot, l.plot);
  } finally {
    delete globalThis.window;
  }
});

test('old saved projects open with the new collections present', () => {
  const old = { plot: { width: 10, length: 10 }, rooms: [{ id: 'r' }] };
  const back = normalizeLoadedLayout(old);
  assert.deepEqual(back.cadEntities, []);
  assert.deepEqual(back.rooms, [{ id: 'r' }]);
  assert.equal(normalizeLoadedLayout({}), null);
});

test('the exported drawing contains the same geometry as the model', () => {
  const l = plotWithWall();
  l.doors = [createDoor({ id: 'd', x: 10, y: 10, width: 3, wallId: 'w' })];
  l.cadEntities = [{ id: 'e', kind: 'circle', cx: 5, cy: 5, r: 2 }];
  l.annotations = [{ id: 'n', x: 1, y: 1, text: 'A & B <1>', fontSize: 12 }];
  const svg = generateLayoutSVG(l, 'ft-in');
  assert.ok(svg.includes('A &amp; B &lt;1&gt;'), 'text is escaped');
  assert.ok(svg.includes(`r="${2 * 20}"`), 'circle radius');
  assert.ok(svg.includes(`x1="${100 + 8.5 * 20}"`), 'door jamb at its real position');
});
