import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultLayout, createRoom, createWall, createDoor, createWindow,
  createRoomBoundaryWalls, syncPlotDimensions, cloneLayout, WALL_THICKNESS,
} from '../components/editor/layoutModel.js';
import {
  resizeRoom, setRoomDimension, moveWallBoundary, moveRoom,
  edgeTargetsForHandle, screenToWorldPoint, worldToScreenPoint,
} from '../components/editor/roomResize.js';
import { validateOpenings } from '../components/editor/constraintEngine.js';
import { HistoryManager } from '../components/editor/historyManager.js';
import { saveProject, loadProject } from '../components/editor/projectStorage.js';
import { byId, near, sharedEdges, wallJunctions, distanceToWall } from './fixtures.mjs';

/**
 * 30' x 40' plot, footprint x 2..28, y 4..36
 *
 *   y=4   +-----------+-------+-------------+
 *         | Master    | Bath  | Guest Room  |
 *   y=16  +-----------+-------+------+------+
 *         | Living Room       | Kitchen     |
 *   y=28  +-----------+-------+-------------+
 *         | Dining    | Toilet| Utility     |
 *   y=36  +-----------+-------+-------------+
 *        x=2        13      18            28
 */
function buildHouse() {
  const layout = createDefaultLayout({ siteWidth: 30, siteLength: 40, eastOpen: 2, westOpen: 2, northOpen: 4, southOpen: 4 });
  layout.id = 'house';
  const R = (id, name, x0, x1, y0, y1) => createRoom({ id, name, x: x0, y: y0, width: x1 - x0, length: y1 - y0, color: '#fff' });
  layout.rooms = [
    R('master', 'Master Bedroom', 2, 13, 4, 16),
    R('bath', 'Bathroom', 13, 18, 4, 16),
    R('guest', 'Guest Room', 18, 28, 4, 16),
    R('living', 'Living Room', 2, 18, 16, 28),
    R('kitchen', 'Kitchen', 18, 28, 16, 28),
    R('dining', 'Dining', 2, 13, 28, 36),
    R('toilet', 'Toilet', 13, 18, 28, 36),
    R('utility', 'Utility', 18, 28, 28, 36),
  ];
  layout.walls = [
    createWall({ id: 'ext-n', type: 'exterior', x1: 2, y1: 4, x2: 28, y2: 4, thickness: WALL_THICKNESS.EXTERIOR }),
    createWall({ id: 'ext-e', type: 'exterior', x1: 28, y1: 4, x2: 28, y2: 36, thickness: WALL_THICKNESS.EXTERIOR }),
    createWall({ id: 'ext-s', type: 'exterior', x1: 28, y1: 36, x2: 2, y2: 36, thickness: WALL_THICKNESS.EXTERIOR }),
    createWall({ id: 'ext-w', type: 'exterior', x1: 2, y1: 36, x2: 2, y2: 4, thickness: WALL_THICKNESS.EXTERIOR }),
  ];
  for (const r of layout.rooms) layout.walls = createRoomBoundaryWalls(layout, r);
  layout.doors = [
    createDoor({ id: 'd-master', x: 7, y: 16, width: 2.8 }),
    createDoor({ id: 'd-bath', x: 13, y: 10, width: 2.3 }), // on the shared master | bath wall
    createDoor({ id: 'd-guest', x: 23, y: 16, width: 2.8 }),
    createDoor({ id: 'd-main', x: 8, y: 36, width: 3.5 }),
  ];
  layout.windows = [
    createWindow({ id: 'w-master', x: 7, y: 4, width: 4 }),
    createWindow({ id: 'w-bath', x: 15.5, y: 4, width: 2 }),
  ];
  syncPlotDimensions(layout);
  return layout;
}

const siteSignature = (l) => JSON.stringify({
  plot: l.plot,
  footprint: l.footprint,
  exterior: l.walls.filter((w) => w.type === 'exterior'),
});

const rect = (l, id) => {
  const r = byId(l.rooms, id);
  return [r.x, r.y, r.width, r.length].map((v) => Math.round(v * 1000) / 1000);
};

function assertConsistent(before, after) {
  assert.equal(siteSignature(after), siteSignature(before), 'outer site boundary and exterior walls never move');
  // Every room that touched a neighbour still touches it (no gaps / detached
  // rooms). New contacts can appear, e.g. a shifted bathroom now borders the kitchen.
  const afterEdges = sharedEdges(after);
  for (const e of sharedEdges(before)) assert.ok(afterEdges.has(e), `adjacency ${e} kept`);
  // Every wall endpoint that met another wall still meets one (a corner may
  // become a T-junction when one wall slides along the other).
  for (const j of wallJunctions(before)) {
    for (const end of j.split('|')) {
      const [id, which] = end.split('.');
      const w = byId(after.walls, id);
      if (!w) continue;
      const p = which === '1' ? { x: w.x1, y: w.y1 } : { x: w.x2, y: w.y2 };
      assert.ok(after.walls.some((o) => o.id !== id && distanceToWall(p, o) < 1e-3), `wall end ${end} stays connected`);
    }
  }
  for (const k of ['rooms', 'doors', 'windows', 'staircases']) {
    assert.deepEqual(after[k].map((e) => e.id).sort(), before[k].map((e) => e.id).sort(), `no ${k} created or deleted`);
  }
  const check = cloneLayout(after);
  assert.deepEqual(validateOpenings(check).filter((c) => c.code !== 'opening-detached'), [], 'openings fit their walls');
  for (const o of [...after.doors, ...after.windows]) {
    const w = byId(after.walls, o.wallId);
    assert.ok(w && distanceToWall(o, w) < 1e-3, `${o.id} is on its host wall`);
  }
  // Every room edge is still drawn by walls
  for (const r of after.rooms) {
    for (const [x1, y1, x2, y2] of [[r.x, r.y, r.x + r.width, r.y], [r.x, r.y + r.length, r.x + r.width, r.y + r.length], [r.x, r.y, r.x, r.y + r.length], [r.x + r.width, r.y, r.x + r.width, r.y + r.length]]) {
      const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      assert.ok(after.walls.some((w) => distanceToWall(mid, w) < 1e-3), `edge of ${r.id} has a wall`);
    }
  }
}

const UNRELATED = ['living', 'kitchen', 'dining', 'toilet', 'utility'];

test('Test 1: increasing the Master Bedroom width moves the shared wall and the bathroom follows', () => {
  const before = buildHouse();
  const res = resizeRoom(before, 'master', { right: 14 });
  const after = res.layout;
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual(rect(after, 'master'), [2, 4, 12, 12], 'bedroom 1 ft wider');
  // Bathroom is (inferred) fixed: it keeps its size and the flexible guest room absorbs the change
  assert.deepEqual(rect(after, 'bath'), [14, 4, 5, 12]);
  assert.deepEqual(rect(after, 'guest'), [19, 4, 9, 12]);
  for (const id of UNRELATED) assert.deepEqual(rect(after, id), rect(before, id), `${id} untouched`);
  // The shared wall moved by exactly 1 ft and carries its door
  assert.ok(after.walls.some((w) => near(w.x1, 14) && near(w.x2, 14) && near(Math.min(w.y1, w.y2), 4) && near(Math.max(w.y1, w.y2), 16)));
  assert.equal(byId(after.doors, 'd-bath').x, 14);
  assert.equal(byId(after.windows, 'w-bath').x, 16.5, 'bathroom window moves with the bathroom');
  assert.equal(byId(after.windows, 'w-master').x, 7, 'bedroom window stays put');
  assertConsistent(before, after);
});

test('Test 2: decreasing the Master Bedroom width leaves no gap', () => {
  const before = buildHouse();
  const res = resizeRoom(before, 'master', { right: 12 });
  const after = res.layout;
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual(rect(after, 'master'), [2, 4, 10, 12]);
  assert.deepEqual(rect(after, 'bath'), [12, 4, 5, 12]);
  assert.deepEqual(rect(after, 'guest'), [17, 4, 11, 12]);
  for (const id of UNRELATED) assert.deepEqual(rect(after, id), rect(before, id));
  assertConsistent(before, after);
});

test('Test 3: other rooms resize against their neighbours too', () => {
  const before = buildHouse();
  // Living room east edge -> kitchen shrinks, kitchen east (exterior) side stays
  const a = resizeRoom(before, 'living', { right: 19 }).layout;
  assert.deepEqual(rect(a, 'living'), [2, 16, 17, 12]);
  assert.deepEqual(rect(a, 'kitchen'), [19, 16, 9, 12]);
  assertConsistent(before, a);
  // Kitchen north edge -> guest room above gets shorter; bathroom is not on that span
  const b = resizeRoom(before, 'kitchen', { top: 15 }).layout;
  assert.deepEqual(rect(b, 'kitchen'), [18, 15, 10, 13]);
  assert.deepEqual(rect(b, 'guest'), [18, 4, 10, 11]);
  assert.deepEqual(rect(b, 'bath'), rect(before, 'bath'));
  assertConsistent(before, b);
  // Guest room width numerically: its west wall moves (east is exterior)
  const c = resizeRoom(before, 'guest', { left: 17 });
  assert.deepEqual(rect(c.layout, 'guest'), [17, 4, 11, 12]);
  assert.deepEqual(rect(c.layout, 'bath'), [12, 4, 5, 12], 'fixed bath shifts, master absorbs');
  assert.deepEqual(rect(c.layout, 'master'), [2, 4, 10, 12]);
  assertConsistent(before, c.layout);
  // Dining room
  const d = resizeRoom(before, 'dining', { right: 12 }).layout;
  assert.deepEqual(rect(d, 'dining'), [2, 28, 10, 8]);
  assertConsistent(before, d);
});

test('Test 6: an edge on the exterior wall cannot move the outer boundary', () => {
  const before = buildHouse();
  const res = resizeRoom(before, 'guest', { right: 29.5 });
  assert.equal(res.clamped, true);
  assert.match(res.conflicts[0], /exterior wall|site boundary/);
  assert.equal(siteSignature(res.layout), siteSignature(before));
  assert.deepEqual(rect(res.layout, 'guest'), rect(before, 'guest'));
});

test('Test 5: fixed vs flexible neighbours', () => {
  // Explicitly flexible bathroom: it shrinks and keeps its east wall; guest room untouched
  const flex = buildHouse();
  byId(flex.rooms, 'bath').constraintType = 'flexible';
  byId(flex.rooms, 'bath').minWidth = 3;
  const a = resizeRoom(flex, 'master', { right: 14 }).layout;
  assert.deepEqual(rect(a, 'bath'), [14, 4, 4, 12]);
  assert.deepEqual(rect(a, 'guest'), rect(flex, 'guest'));
  assertConsistent(flex, a);

  // Fixed bathroom + guest at its minimum: stop at the valid limit, report why
  const fixed = buildHouse();
  byId(fixed.rooms, 'bath').constraintType = 'fixed';
  byId(fixed.rooms, 'guest').minWidth = 9.5;
  const b = resizeRoom(fixed, 'master', { right: 15 });
  assert.equal(b.clamped, true);
  assert.deepEqual(rect(b.layout, 'master'), [2, 4, 11.5, 12], 'stops where the guest room reaches 9.5 ft');
  assert.deepEqual(rect(b.layout, 'bath'), [13.5, 4, 5, 12], 'fixed bathroom keeps its size');
  assert.match(b.conflicts[0], /Guest Room/);
  assertConsistent(fixed, b.layout);

  // Inferred-fixed bathroom when the guest room cannot shrink: bath flexes within its 4 ft minimum
  const inferred = buildHouse();
  byId(inferred.rooms, 'guest').minWidth = 10;
  const c = resizeRoom(inferred, 'master', { right: 14 });
  assert.deepEqual(c.conflicts, []);
  assert.deepEqual(rect(c.layout, 'bath'), [14, 4, 4, 12]);
  assert.deepEqual(rect(c.layout, 'guest'), [18, 4, 10, 12]);

  // Locked neighbour blocks the move entirely
  const locked = buildHouse();
  byId(locked.rooms, 'bath').isLocked = true;
  const d = resizeRoom(locked, 'master', { right: 14 });
  assert.equal(d.clamped, true);
  assert.deepEqual(rect(d.layout, 'master'), rect(locked, 'master'));
  assert.match(d.conflicts[0], /locked/);
});

test('Test 4: the same physical drag gives the same result at every zoom and pan', () => {
  const before = buildHouse();
  const master = byId(before.rooms, 'master');
  const results = [];
  for (const viewport of [{ scale: 6, panX: 0, panY: 0 }, { scale: 18, panX: 120, panY: 80 }, { scale: 47.3, panX: -900, panY: 333 }, { scale: 80, panX: 15, panY: -2000 }]) {
    // Pointer goes down on the east edge and moves 1.5 ft worth of pixels at this zoom
    const down = worldToScreenPoint(viewport, master.x + master.width, master.y + 6);
    const up = { x: down.x + 1.5 * viewport.scale, y: down.y };
    const w0 = screenToWorldPoint(viewport, down.x, down.y);
    const w1 = screenToWorldPoint(viewport, up.x, up.y);
    const targets = edgeTargetsForHandle(master, 'e', w1.x - w0.x, w1.y - w0.y);
    results.push(rect(resizeRoom(before, 'master', targets).layout, 'master'));
  }
  for (const r of results) assert.deepEqual(r, [2, 4, 12.5, 12]);
});

test('drag regression: many pointer moves never accumulate (outer wall stays put)', () => {
  const snapshot = buildHouse();
  const master = byId(snapshot.rooms, 'master');
  let preview;
  // Each move is computed from the pointer-down snapshot, exactly as the canvas does
  for (let i = 1; i <= 20; i++) preview = resizeRoom(snapshot, 'master', edgeTargetsForHandle(master, 'e', 0.05 * i, 0)).layout;
  const direct = resizeRoom(snapshot, 'master', { right: 14 }).layout;
  assert.deepEqual(rect(preview, 'master'), rect(direct, 'master'));
  assert.equal(siteSignature(preview), siteSignature(snapshot));
  assert.deepEqual(byId(preview.walls, 'ext-n'), byId(snapshot.walls, 'ext-n'));
});

test('corner handle resizes both axes and keeps every boundary connected', () => {
  const before = buildHouse();
  const master = byId(before.rooms, 'master');
  const res = resizeRoom(before, 'master', edgeTargetsForHandle(master, 'se', 1, 1));
  assert.deepEqual(res.conflicts, []);
  assert.deepEqual(rect(res.layout, 'master'), [2, 4, 12, 13]);
  assert.deepEqual(rect(res.layout, 'living'), [2, 17, 16, 11], 'living room gives up 1 ft of length');
  assertConsistent(before, res.layout);
});

test('numeric width/length edits use the same solver', () => {
  const before = buildHouse();
  const res = setRoomDimension(before, 'master', 'width', 12);
  assert.deepEqual(rect(res.layout, 'master'), [2, 4, 12, 12]);
  assert.deepEqual(rect(res.layout, 'bath'), [14, 4, 5, 12]);
  const len = setRoomDimension(before, 'dining', 'length', 9);
  assert.equal(len.clamped, true, 'dining south edge is the exterior wall');
});

test('dragging a shared wall resizes the rooms on both sides only', () => {
  const before = buildHouse();
  const wall = before.walls.find((w) => near(w.x1, 13) && near(w.x2, 13) && Math.min(w.y1, w.y2) < 5);
  const res = moveWallBoundary(before, wall.id, 1);
  assert.equal(res.clamped, false);
  assert.deepEqual(rect(res.layout, 'master'), [2, 4, 12, 12]);
  assert.deepEqual(rect(res.layout, 'bath'), [14, 4, 4, 12]);
  assert.deepEqual(rect(res.layout, 'guest'), rect(before, 'guest'));
  assert.equal(byId(res.layout.walls, wall.id).x1, 14, 'the same wall entity moved (ID preserved)');
  assertConsistent(before, res.layout);
});

test('moving a room interior keeps shared walls for the neighbours', () => {
  const layout = createDefaultLayout({ siteWidth: 40, siteLength: 40 });
  layout.rooms = [createRoom({ id: 'a', name: 'Study', x: 5, y: 5, width: 10, length: 10 }), createRoom({ id: 'b', name: 'Store', x: 15, y: 5, width: 6, length: 10 })];
  layout.walls = [];
  for (const r of layout.rooms) layout.walls = createRoomBoundaryWalls(layout, r);
  const res = moveRoom(layout, 'b', 5, 0);
  const b = byId(res.layout.rooms, 'b');
  assert.equal(b.x, 20);
  // Study keeps its east wall even though it was shared
  assert.ok(res.layout.walls.some((w) => near(w.x1, 15) && near(w.x2, 15)));
  assert.ok(res.layout.walls.some((w) => near(w.x1, 26) && near(w.x2, 26)), 'store has walls at its new position');
  assert.equal(res.layout.plot.width, 40);
});

test('Test 7: undo and redo restore the whole resize as one step', () => {
  const before = buildHouse();
  const h = new HistoryManager(before);
  const master = byId(before.rooms, 'master');
  h.beginDrag();
  let preview;
  for (let i = 1; i <= 5; i++) {
    preview = resizeRoom(before, 'master', edgeTargetsForHandle(master, 'e', 0.2 * i, 0)).layout;
    h.updateDuringDrag(preview);
  }
  h.endDrag(preview);
  assert.equal(h.undoStack.length, 1);
  assert.deepEqual(h.undo(), before);
  const redone = h.redo();
  assert.deepEqual(rect(redone, 'master'), [2, 4, 12, 12]);
  assert.deepEqual(rect(redone, 'bath'), [14, 4, 5, 12]);
});

test('a drag that changes nothing does not add an undo step', () => {
  const before = buildHouse();
  const h = new HistoryManager(before);
  h.beginDrag();
  h.updateDuringDrag(before);
  h.endDrag(before);
  assert.equal(h.undoStack.length, 0);
});

test('Test 8: save and reopen preserves dimensions and shared walls', async () => {
  const store = new Map();
  globalThis.window = { localStorage: { setItem: (k, v) => store.set(k, String(v)), getItem: (k) => (store.has(k) ? store.get(k) : null) } };
  try {
    const after = resizeRoom(buildHouse(), 'master', { right: 14 }).layout;
    assert.equal(await saveProject(after, 'u1'), true);
    const reopened = loadProject('house', 'u1');
    for (const r of after.rooms) assert.deepEqual(rect(reopened, r.id), rect(after, r.id));
    assert.deepEqual(reopened.walls, after.walls);
    assert.deepEqual([...sharedEdges(reopened)].sort(), [...sharedEdges(after)].sort());
    assert.deepEqual(reopened.doors.map((d) => d.wallId), after.doors.map((d) => d.wallId));
  } finally {
    delete globalThis.window;
  }
});
