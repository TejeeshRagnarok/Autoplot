import test from 'node:test';
import assert from 'node:assert/strict';

import { applySiteChange, cloneLayout, createStaircase, createRoom, createDefaultLayout } from '../components/editor/layoutModel.js';
import { validateOpenings } from '../components/editor/constraintEngine.js';
import { HistoryManager } from '../components/editor/historyManager.js';
import {
  buildFixture, FIXED_ROOM_IDS, FLEX_ROOM_IDS, byId, near,
  sharedEdges, wallJunctions, distanceToWall,
} from './fixtures.mjs';

const ids = (list) => list.map((e) => e.id).sort();

function assertStructuralIntegrity(before, after) {
  // Nothing created or deleted, IDs stable
  for (const k of ['rooms', 'walls', 'doors', 'windows', 'staircases']) {
    assert.deepEqual(ids(after[k]), ids(before[k]), `${k} IDs must be unchanged`);
  }
  // Shared room boundaries preserved
  assert.deepEqual([...sharedEdges(after)].sort(), [...sharedEdges(before)].sort(), 'room adjacency must be preserved');
  // Wall corners stay connected
  for (const j of wallJunctions(before)) assert.ok(wallJunctions(after).has(j), `wall junction ${j} must stay connected`);
  // Openings stay on the same host wall
  const hostBefore = cloneLayout(before);
  validateOpenings(hostBefore);
  for (const o of [...after.doors, ...after.windows]) {
    const prev = [...hostBefore.doors, ...hostBefore.windows].find((p) => p.id === o.id);
    assert.equal(o.wallId, prev.wallId, `${o.id} keeps its host wall`);
    const w = byId(after.walls, o.wallId);
    assert.ok(distanceToWall(o, w) < 1e-3, `${o.id} sits on its host wall`);
  }
}

test('acceptance: 30x40 plot reduced to 25 ft wide', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { width: 25, edge: 'right' });
  const after = res.nextLayout;

  assert.equal(res.success, true, JSON.stringify(res.conflicts));
  // Site boundary and buildable area really change
  assert.equal(after.plot.width, 25);
  assert.equal(after.plot.length, 40);
  assert.deepEqual(after.footprint, { x: 2, y: 4, width: 21, length: 32 });
  assert.deepEqual(after.plot.setbacks, before.plot.setbacks);
  // Plot dimension annotation follows the geometry
  const dimW = byId(after.dimensions, 'dim-plot-width');
  assert.equal(dimW.value, 25);
  assert.equal(dimW.x2, 25);

  // Fixed rooms keep both dimensions
  for (const id of FIXED_ROOM_IDS) {
    const a = byId(after.rooms, id);
    const b = byId(before.rooms, id);
    assert.ok(near(a.width, b.width) && near(a.length, b.length), `${id} keeps its size`);
  }
  // Flexible rooms in the flexible column absorb the 5 ft, within their minimums
  for (const id of ['master', 'living', 'bed3']) {
    assert.ok(near(byId(after.rooms, id).width, 10), `${id} width -> 10`);
  }
  // Everything is still inside the buildable area
  for (const r of after.rooms) {
    assert.ok(r.x >= 2 - 1e-3 && r.x + r.width <= 23 + 1e-3, `${r.id} inside buildable width`);
  }
  // Staircase keeps its geometry and step count, and moved with its column
  const s0 = byId(before.staircases, 'stair');
  const s1 = byId(after.staircases, 'stair');
  for (const k of ['width', 'length', 'risers', 'treads', 'treadDepth', 'rotation']) assert.equal(s1[k], s0[k], `stair ${k}`);
  assert.ok(near(s1.x, s0.x - 5), 'staircase follows its column');

  assertStructuralIntegrity(before, after);
});

test('original layout is never mutated by a reflow', () => {
  const before = buildFixture();
  const snapshot = JSON.stringify(before);
  applySiteChange(before, { width: 25 });
  applySiteChange(before, { width: 21 });
  assert.equal(JSON.stringify(before), snapshot);
});

test('resize is reversible: 30 -> 25 -> 30 restores the geometry', () => {
  const a = buildFixture();
  const b = applySiteChange(a, { width: 25 }).nextLayout;
  const c = applySiteChange(b, { width: 30 }).nextLayout;
  for (const r of a.rooms) {
    const r2 = byId(c.rooms, r.id);
    for (const k of ['x', 'y', 'width', 'length']) assert.ok(near(r[k], r2[k]), `${r.id}.${k}`);
  }
});

test('infeasible shrink reports a conflict, deletes nothing, and relaxFixed reduces the shortfall', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { width: 22 });
  assert.equal(res.success, false);
  const c = res.conflicts.find((x) => x.code === 'building-width');
  assert.ok(c, 'building-width conflict reported');
  assert.ok(near(c.excess, 3), `shortfall is 3 ft, got ${c.excess}`);
  assert.equal(res.nextLayout.rooms.length, before.rooms.length);
  assert.equal(res.nextLayout.staircases.length, 1);

  const relaxed = applySiteChange(before, { width: 22, relaxFixed: true });
  const c2 = relaxed.conflicts.find((x) => x.code === 'building-width');
  assert.ok(!c2 || c2.excess < c.excess, 'relaxing fixed rooms frees more space');
  // Locked rooms never change even when relaxed
  const locked = cloneLayout(before);
  byId(locked.rooms, 'toilet').isLocked = true;
  const r3 = applySiteChange(locked, { width: 22, relaxFixed: true }).nextLayout;
  assert.equal(byId(r3.rooms, 'toilet').width, 5);
});

test('dragging the left (west) edge keeps the east edge content in place', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { width: 35, edge: 'left' });
  const after = res.nextLayout;
  assert.equal(res.success, true, JSON.stringify(res.conflicts));
  assert.equal(res.shift.x, 5);
  // Building fills the new buildable width: west edge at 2, east at 33
  const util = byId(after.rooms, 'utility');
  assert.ok(near(util.x + util.width, 33));
  assert.ok(near(byId(after.rooms, 'master').x, 2));
  // Physically (old coordinates = new - shift) the east column did not move
  assert.ok(near(util.x - res.shift.x, byId(before.rooms, 'utility').x));
  assertStructuralIntegrity(before, after);
});

test('dragging the right (east) edge outward grows flexible rooms only', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { width: 34, edge: 'right' });
  const after = res.nextLayout;
  assert.equal(res.shift.x, 0);
  assert.ok(near(byId(after.rooms, 'master').width, 19));
  for (const id of FIXED_ROOM_IDS) assert.equal(byId(after.rooms, id).width, byId(before.rooms, id).width);
  assertStructuralIntegrity(before, after);
});

test('dragging the bottom (south) edge outward lengthens flexible rows', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { length: 44, edge: 'bottom' });
  const after = res.nextLayout;
  assert.equal(res.success, true, JSON.stringify(res.conflicts));
  assert.equal(after.plot.length, 44);
  assert.deepEqual(after.footprint, { x: 2, y: 4, width: 26, length: 36 });
  const bed3 = byId(after.rooms, 'bed3');
  assert.ok(near(bed3.y + bed3.length, 40), 'building fills the new buildable length');
  for (const id of FIXED_ROOM_IDS) assert.equal(byId(after.rooms, id).length, byId(before.rooms, id).length);
  // Staircase is rigid: same length and step count
  assert.equal(byId(after.staircases, 'stair').length, byId(before.staircases, 'stair').length);
  assertStructuralIntegrity(before, after);
});

test('dragging the top (north) edge keeps the south rows in place', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { length: 44, edge: 'top' });
  assert.equal(res.shift.y, 4);
  const bed3 = byId(res.nextLayout.rooms, 'bed3');
  const bed3Before = byId(before.rooms, 'bed3');
  assert.ok(near(bed3.y - res.shift.y, bed3Before.y), 'south row keeps its physical position');
  assertStructuralIntegrity(before, res.nextLayout);
});

test('symmetric resize splits the change between both sides', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { width: 34, isSymmetric: true });
  assert.equal(res.shift.x, 2);
  assertStructuralIntegrity(before, res.nextLayout);
});

test('shrinking the length past fixed rows reports a conflict instead of distorting rooms', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { length: 36 });
  assert.equal(res.success, false);
  assert.ok(res.conflicts.some((c) => c.code === 'building-length'));
  for (const id of FIXED_ROOM_IDS) assert.equal(byId(res.nextLayout.rooms, id).length, byId(before.rooms, id).length);
  assert.equal(byId(res.nextLayout.staircases, 'stair').risers, 15);
});

test('changing a setback reflows the building', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { setbacks: { west: 4 } });
  const after = res.nextLayout;
  assert.equal(res.success, true, JSON.stringify(res.conflicts));
  assert.equal(after.plot.setbacks.west, 4);
  assert.equal(after.plot.width, 30);
  assert.ok(near(byId(after.rooms, 'master').x, 4));
  assert.ok(near(byId(after.rooms, 'master').width, 13));
  assertStructuralIntegrity(before, after);
});

test('invalid input is rejected without corrupting the layout', () => {
  const before = buildFixture();
  const res = applySiteChange(before, { width: 'abc' });
  assert.equal(res.success, false);
  assert.equal(res.nextLayout.plot.width, 30);
  const tiny = applySiteChange(before, { width: 1 });
  assert.ok(tiny.nextLayout.plot.width >= 5, 'plot never collapses below the minimum');
  assert.equal(tiny.success, false);
});

test('rooms with explicit min/max limits are respected', () => {
  const before = buildFixture();
  byId(before.rooms, 'master').maxWidth = 16;
  const after = applySiteChange(before, { width: 34 }).nextLayout;
  assert.ok(byId(after.rooms, 'master').width <= 16 + 1e-3);
  byId(before.rooms, 'living').minWidth = 13;
  const res = applySiteChange(before, { width: 25 });
  assert.ok(byId(res.nextLayout.rooms, 'living').width >= 13 - 1e-3);
  assert.equal(res.success, false, 'cannot absorb 5 ft when living may only lose 2 ft');
});

test('site resize is one undoable transaction', () => {
  const before = buildFixture();
  const h = new HistoryManager(before);
  const after = applySiteChange(before, { width: 25 }).nextLayout;
  h.pushState(after);
  assert.equal(h.undoStack.length, 1);
  assert.deepEqual(h.undo(), before);
  assert.deepEqual(h.redo(), after);
});

test('drag preview from a snapshot is deterministic (no cumulative drift)', () => {
  const snap = buildFixture();
  let preview = snap;
  for (const w of [29, 28, 27.5, 26, 25.25, 25]) preview = applySiteChange(snap, { width: w }).nextLayout;
  const direct = applySiteChange(snap, { width: 25 }).nextLayout;
  assert.deepEqual(preview.rooms, direct.rooms);
  assert.deepEqual(preview.walls, direct.walls);
});

test('external staircase in a setback follows its anchored boundary', () => {
  const layout = createDefaultLayout({ siteWidth: 30, siteLength: 40, westOpen: 6, eastOpen: 2, northOpen: 4, southOpen: 4 });
  layout.rooms = [createRoom({ id: 'r', name: 'Hall', x: 6, y: 4, width: 22, length: 32 })];
  layout.staircases = [
    createStaircase({ id: 'sL', stairType: 'straight', x: 1, y: 10, width: 3.5, anchor: 'left' }),
    createStaircase({ id: 'sR', stairType: 'straight', x: 1, y: 25, width: 3.5, anchor: 'right' }),
  ];
  const res = applySiteChange(layout, { width: 36, edge: 'left' });
  const sL = byId(res.nextLayout.staircases, 'sL');
  const sR = byId(res.nextLayout.staircases, 'sR');
  assert.equal(sL.x, 1, 'left-anchored stair stays attached to the west boundary');
  assert.equal(sR.x, 7, 'right-anchored stair keeps its distance to the east boundary');
  assert.equal(sL.risers, byId(layout.staircases, 'sL').risers);
});

test('staircase that cannot fit the plot is reported, not deleted or distorted', () => {
  const layout = createDefaultLayout({ siteWidth: 30, siteLength: 40 });
  layout.staircases = [createStaircase({ id: 's', stairType: 'straight', x: 2, y: 2, width: 3.5, risers: 20 })];
  const len = layout.staircases[0].length;
  const res = applySiteChange(layout, { length: 12 });
  assert.equal(res.nextLayout.staircases.length, 1);
  assert.equal(res.nextLayout.staircases[0].length, len);
  assert.ok(res.conflicts.some((c) => c.id === 's' && c.severity !== 'info'));
  assert.equal(res.success, false);
});

test('an opening wider than its shortened host wall is reported, never deleted', () => {
  const layout = { walls: [{ id: 'w', x1: 0, y1: 0, x2: 2, y2: 0 }], doors: [{ id: 'd', x: 1, y: 0, width: 3, wallId: 'w' }], windows: [] };
  const conflicts = validateOpenings(layout);
  assert.equal(conflicts[0].code, 'opening-too-wide');
  assert.equal(layout.doors.length, 1);
});

test('an opening near the end of its wall is slid back fully onto the wall', () => {
  const layout = { walls: [{ id: 'w', x1: 0, y1: 0, x2: 10, y2: 0 }], doors: [{ id: 'd', x: 9.5, y: 0, width: 3 }], windows: [] };
  assert.deepEqual(validateOpenings(layout), []);
  assert.equal(layout.doors[0].wallId, 'w');
  assert.equal(layout.doors[0].x, 8.5);
});
