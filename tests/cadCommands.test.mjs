/**
 * CAD drawing entities and modification commands: every command is checked
 * against computed geometry (real intersections, exact distances).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultLayout, createWall, createDoor, createWindow, createColumn, createStaircase, createRoom, applySiteChange, getStaircaseBounds, cloneLayout, createDimension, createAnnotation } from '../components/editor/layoutModel.js';
import {
  breakAtClick, breakElement, chamferElements, copySelection, copyToClipboard, createArcEntity, createCircleEntity,
  createLineEntity, createPolylineEntity, createRectangleEntity, createRegularPolygonEntity, deleteSelection,
  extendElement, filletElements, insertCopies, joinSelection, makeMirror, makeRotate, makeScale, makeTranslate,
  offsetElement, pickOutline, polarArray, rectangularArray, stretchInBox, transformSelection, trimElement,
} from '../components/editor/cadCommands.js';
import { arcSweep, distanceToOutline, entityArea, entityBounds, entityLength, pointAtAngle, circleCircle, lineLineIntersection } from '../components/editor/cadGeometry.js';
import { HistoryManager } from '../components/editor/historyManager.js';
import { getOpeningHost } from '../components/editor/wallOps.js';
import { buildFixture, byId } from './fixtures.mjs';

const almost = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);
const ent = (l, id) => l.cadEntities.find((e) => e.id === id);
const E = (id) => ({ type: 'entity', id });
const W = (id) => ({ type: 'wall', id });

function blank() {
  const l = createDefaultLayout({ siteWidth: 100, siteLength: 100 });
  l.walls = [];
  return l;
}
const withLines = (...defs) => {
  const l = blank();
  l.cadEntities = defs.map(([id, x1, y1, x2, y2]) => createLineEntity({ x: x1, y: y1 }, { x: x2, y: y2 }, { id }));
  return l;
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

test('lines, polylines, rectangles, polygons, circles and arcs have exact geometry', () => {
  const line = createLineEntity({ x: 0, y: 0 }, { x: 3, y: 4 });
  assert.equal(entityLength(line), 5);

  const poly = createPolylineEntity([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);
  assert.equal(entityLength(poly), 7);

  const rect = createRectangleEntity({ x: 1, y: 1 }, { x: 5, y: 4 });
  assert.equal(entityArea(rect), 12);
  assert.equal(entityLength(rect), 14);
  assert.deepEqual(entityBounds(rect), { minX: 1, minY: 1, maxX: 5, maxY: 4 });

  const hex = createRegularPolygonEntity({ x: 0, y: 0 }, { x: 2, y: 0 }, 6);
  assert.equal(hex.points.length, 6);
  for (const p of hex.points) almost(Math.hypot(p.x, p.y), 2);
  almost(entityLength(hex), 12);

  const c = createCircleEntity({ x: 2, y: 3 }, 5);
  almost(entityArea(c), Math.PI * 25);
  almost(entityLength(c), Math.PI * 10);
});

test('an arc passes through the three picked points, whichever way it turns', () => {
  const pts = [[{ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }], [{ x: -5, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 0 }], [{ x: 5, y: 0 }, { x: 0, y: -5 }, { x: -5, y: 0 }]];
  for (const [a, m, b] of pts) {
    const arc = createArcEntity(a, m, b);
    almost(arc.r, 5);
    almost(arc.cx, 0);
    almost(arc.cy, 0);
    almost(arcSweep(arc), 180);
    for (const p of [a, m, b]) almost(distanceToOutline(p, arc, 'entity'), 0, 1e-3);
  }
  assert.equal(createArcEntity({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null, 'collinear points');
});

test('arc bounds include axis extremes inside the sweep', () => {
  const arc = createArcEntity({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 });
  const b = entityBounds(arc);
  almost(b.maxY, 5);
  almost(b.minY, 0);
  almost(b.minX, -5);
});

test('intersection primitives', () => {
  const hit = lineLineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
  assert.deepEqual([hit.x, hit.y], [5, 0]);
  assert.equal(lineLineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), null);
  assert.equal(circleCircle({ cx: 0, cy: 0, r: 1 }, { cx: 5, cy: 0, r: 1 }).length, 0);
  const two = circleCircle({ cx: 0, cy: 0, r: 5 }, { cx: 6, cy: 0, r: 5 });
  assert.equal(two.length, 2);
  almost(two[0].x, 3);
  almost(Math.abs(two[0].y), 4);
});

// ---------------------------------------------------------------------------
// Move / copy / rotate / mirror / scale
// ---------------------------------------------------------------------------

test('move shifts every kind of element by the exact delta', () => {
  const l = blank();
  l.cadEntities = [
    createLineEntity({ x: 0, y: 0 }, { x: 1, y: 1 }, { id: 'a' }),
    createCircleEntity({ x: 5, y: 5 }, 2, { id: 'c' }),
    createRectangleEntity({ x: 0, y: 0 }, { x: 2, y: 2 }, { id: 'r' }),
  ];
  l.columns = [createColumn({ id: 'col', x: 4, y: 4 })];
  l.annotations = [createAnnotation({ id: 'n', x: 1, y: 1 })];
  l.staircases = [createStaircase({ id: 's', stairType: 'straight', x: 1, y: 1, width: 4, risers: 7 })];
  l.dimensions.push(createDimension({ id: 'dm', x1: 0, y1: 0, x2: 2, y2: 0 }));
  const items = [E('a'), E('c'), E('r'), { type: 'column', id: 'col' }, { type: 'annotation', id: 'n' }, { type: 'staircase', id: 's' }, { type: 'dimension', id: 'dm' }];
  const res = transformSelection(l, items, makeTranslate(2.5, -1));
  assert.deepEqual(res.skipped, []);
  const n = res.layout;
  assert.deepEqual([ent(n, 'a').x1, ent(n, 'a').y2], [2.5, 0]);
  assert.deepEqual([ent(n, 'c').cx, ent(n, 'c').cy, ent(n, 'c').r], [7.5, 4, 2]);
  assert.deepEqual(ent(n, 'r').points[0], { x: 2.5, y: -1 });
  assert.equal(n.columns[0].x, 6.5);
  assert.equal(n.annotations[0].y, 0);
  assert.equal(getStaircaseBounds(n.staircases[0]).x, 3.5);
  assert.equal(n.dimensions.find((d) => d.id === 'dm').x2, 4.5);
});

test('copy makes independent objects with new ids', () => {
  const l = withLines(['a', 0, 0, 5, 0]);
  const res = copySelection(l, [E('a')], 0, 3);
  assert.equal(res.layout.cadEntities.length, 2);
  const copy = res.layout.cadEntities[1];
  assert.notEqual(copy.id, 'a');
  assert.equal(copy.y1, 3);
  // Editing the copy leaves the original alone
  copy.x1 = 99;
  assert.equal(ent(res.layout, 'a').x1, 0);
});

test('rotate uses the given reference point and preserves lengths', () => {
  const l = withLines(['a', 5, 0, 10, 0]);
  const res = transformSelection(l, [E('a')], makeRotate({ x: 0, y: 0 }, 90));
  const a = ent(res.layout, 'a');
  almost(a.x1, 0);
  almost(a.y1, 5);
  almost(a.x2, 0);
  almost(a.y2, 10);
  almost(entityLength(a), 5);
  const about = ent(transformSelection(l, [E('a')], makeRotate({ x: 5, y: 0 }, 180)).layout, 'a');
  almost(about.x1, 5);
  almost(about.x2, 0);
  const oblique = ent(transformSelection(l, [E('a')], makeRotate({ x: 7.5, y: 0 }, 37)).layout, 'a');
  almost(entityLength(oblique), 5);
});

test('rotating a rectangle at an oblique angle keeps its shape; an arc follows', () => {
  const l = blank();
  l.cadEntities = [
    createRectangleEntity({ x: 0, y: 0 }, { x: 4, y: 2 }, { id: 'r' }),
    createArcEntity({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { id: 'arc' }),
  ];
  const res = transformSelection(l, [E('r'), E('arc')], makeRotate({ x: 0, y: 0 }, 30));
  const r = ent(res.layout, 'r');
  assert.equal(r.shape, 'polygon');
  almost(entityArea(r), 8, 1e-3);
  almost(entityLength(r), 12, 1e-3);
  const arc = ent(res.layout, 'arc');
  almost(arc.start, 30);
  almost(arc.end, 210);
});

test('a room rotates only in quarter turns, and its size and centre stay exact', () => {
  const l = blank();
  l.rooms = [createRoom({ id: 'r', x: 10, y: 10, width: 12, length: 8 }), createRoom({ id: 'r2', x: 40, y: 40, width: 5, length: 5 })];
  const c = { x: 16, y: 14 };
  const res = transformSelection(l, [{ type: 'room', id: 'r' }], makeRotate(c, 90));
  const r = byId(res.layout.rooms, 'r');
  assert.deepEqual([r.width, r.length], [8, 12]);
  almost(r.x + r.width / 2, 16);
  almost(r.y + r.length / 2, 14);
  const no = transformSelection(l, [{ type: 'room', id: 'r' }], makeRotate(c, 45));
  assert.equal(no.changed, 0);
  assert.match(no.skipped[0], /90/);
});

test('mirror reflects points exactly and reverses an arc', () => {
  const l = blank();
  l.cadEntities = [
    createLineEntity({ x: 2, y: 1 }, { x: 4, y: 3 }, { id: 'a' }),
    createArcEntity({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { id: 'arc' }),
  ];
  const res = transformSelection(l, [E('a'), E('arc')], makeMirror({ x: 0, y: 0 }, { x: 0, y: 10 }));
  const a = ent(res.layout, 'a');
  assert.deepEqual([a.x1, a.y1, a.x2, a.y2], [-2, 1, -4, 3]);
  const arc = ent(res.layout, 'arc');
  // The mirrored arc covers the mirror image of the original's points.
  almost(distanceToOutline({ x: 0, y: 5 }, arc, 'entity'), 0, 1e-3);
  almost(arcSweep(arc), 180);
  const diag = ent(transformSelection(l, [E('a')], makeMirror({ x: 0, y: 0 }, { x: 10, y: 10 })).layout, 'a');
  assert.deepEqual([diag.x1, diag.y1], [1, 2]);
});

test('mirroring a door over a vertical axis flips its side consistently', () => {
  const l = blank();
  l.walls = [createWall({ id: 'w', x1: 10, y1: 10, x2: 20, y2: 10 })];
  l.doors = [createDoor({ id: 'd', x: 15, y: 10, width: 3, wallId: 'w', swing: 'inward' })];
  const res = transformSelection(l, [W('w')], makeMirror({ x: 30, y: 0 }, { x: 30, y: 10 }));
  const d = res.layout.doors[0];
  assert.equal(d.x, 45);
  assert.equal(d.swing, 'outward');
  assert.ok(getOpeningHost(d, res.layout.walls, 1e-3));
});

test('a staircase mirrors only about H/V lines and keeps its footprint', () => {
  const l = blank();
  l.staircases = [createStaircase({ id: 's', stairType: 'dog-legged', x: 10, y: 10, width: 6, risers: 18 })];
  const b0 = getStaircaseBounds(l.staircases[0]);
  const res = transformSelection(l, [{ type: 'staircase', id: 's' }], makeMirror({ x: 30, y: 0 }, { x: 30, y: 10 }));
  const s = res.layout.staircases[0];
  assert.equal(s.mirrored, true);
  assert.equal(s.width, 6);
  almost(getStaircaseBounds(s).x + b0.width, 60 - b0.x);
  const no = transformSelection(l, [{ type: 'staircase', id: 's' }], makeMirror({ x: 0, y: 0 }, { x: 10, y: 10 }));
  assert.equal(no.changed, 0);
});

test('scale multiplies distances from the base point', () => {
  const l = blank();
  l.cadEntities = [createLineEntity({ x: 2, y: 2 }, { x: 4, y: 2 }, { id: 'a' }), createCircleEntity({ x: 3, y: 3 }, 1, { id: 'c' })];
  l.rooms = [createRoom({ id: 'r', x: 10, y: 10, width: 4, length: 6 }), createRoom({ id: 'r2', x: 50, y: 50, width: 4, length: 4 })];
  const res = transformSelection(l, [E('a'), E('c'), { type: 'room', id: 'r' }], makeScale({ x: 0, y: 0 }, 2));
  const a = ent(res.layout, 'a');
  assert.deepEqual([a.x1, a.x2], [4, 8]);
  assert.equal(ent(res.layout, 'c').r, 2);
  const r = byId(res.layout.rooms, 'r');
  assert.deepEqual([r.x, r.y, r.width, r.length], [20, 20, 8, 12]);
  const stair = blank();
  stair.staircases = [createStaircase({ id: 's', x: 1, y: 1 })];
  const refused = transformSelection(stair, [{ type: 'staircase', id: 's' }], makeScale({ x: 0, y: 0 }, 2));
  assert.equal(refused.changed, 0);
  assert.match(refused.skipped[0], /parametric/);
});

test('locked objects stay put and the user is told', () => {
  const l = withLines(['a', 0, 0, 5, 0]);
  l.cadEntities[0].isLocked = true;
  const res = transformSelection(l, [E('a')], makeTranslate(1, 1));
  assert.equal(res.layout, l);
  assert.equal(res.skipped.length, 1);
});

test('moving a room takes its own walls and their openings; other walls stay', () => {
  const base = buildFixture();
  base.rooms.push(createRoom({ id: 'iso', name: 'Iso', x: 40, y: 40, width: 5, length: 5 }));
  base.plot.width = 100;
  base.plot.length = 100;
  const res = transformSelection(base, [{ type: 'room', id: 'iso' }], makeTranslate(10, 0));
  assert.equal(byId(res.layout.rooms, 'iso').x, 50);
  assert.deepEqual(byId(res.layout.rooms, 'living'), byId(base.rooms, 'living'));
  for (const w of base.walls) {
    assert.deepEqual(byId(res.layout.walls, w.id), w, 'existing walls are not touched');
  }
  // Boundary walls now exist at the new position
  const atNew = res.layout.walls.filter((w) => Math.abs(w.x1 - 50) < 0.01 && Math.abs(w.x2 - 50) < 0.01);
  assert.ok(atNew.length >= 1);
});

// ---------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------

test('offset keeps the exact distance, on the picked side', () => {
  const l = withLines(['a', 0, 0, 10, 0]);
  const down = offsetElement(l, E('a'), 2, { x: 5, y: 3 });
  const c = down.layout.cadEntities[1];
  assert.deepEqual([c.y1, c.y2, c.x1, c.x2], [2, 2, 0, 10]);
  const up = offsetElement(l, E('a'), 2, { x: 5, y: -3 }).layout.cadEntities[1];
  assert.equal(up.y1, -2);
  assert.notEqual(c.id, 'a');
});

test('offset of a wall is a real wall; offsetting a polyline mitres its corners', () => {
  const l = blank();
  l.walls = [createWall({ id: 'w', x1: 0, y1: 0, x2: 10, y2: 0, thickness: 0.5, type: 'exterior' })];
  const w = offsetElement(l, W('w'), 3, { x: 5, y: 5 }).layout.walls[1];
  assert.deepEqual([w.y1, w.thickness, w.type], [3, 0.5, 'exterior']);

  const p = blank();
  p.cadEntities = [createPolylineEntity([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { id: 'p' })];
  const off = offsetElement(p, E('p'), 1, { x: 5, y: 5 }).layout.cadEntities[1];
  assert.deepEqual(off.points, [{ x: 0, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 10 }]);
});

test('offset of a closed polygon goes in or out by the picked side', () => {
  const l = blank();
  l.cadEntities = [createRectangleEntity({ x: 0, y: 0 }, { x: 10, y: 10 }, { id: 'r' })];
  const inner = offsetElement(l, E('r'), 1, { x: 5, y: 2 }).layout.cadEntities[1];
  assert.equal(entityArea(inner), 64);
  const outer = offsetElement(l, E('r'), 1, { x: 5, y: -2 }).layout.cadEntities[1];
  assert.equal(entityArea(outer), 144);
});

test('offset of a circle or arc changes the radius by the distance', () => {
  const l = blank();
  l.cadEntities = [createCircleEntity({ x: 0, y: 0 }, 5, { id: 'c' })];
  assert.equal(offsetElement(l, E('c'), 2, { x: 10, y: 0 }).layout.cadEntities[1].r, 7);
  assert.equal(offsetElement(l, E('c'), 2, { x: 1, y: 0 }).layout.cadEntities[1].r, 3);
  assert.ok(offsetElement(l, E('c'), 8, { x: 1, y: 0 }).reason, 'larger than the radius');
  assert.ok(offsetElement(l, E('c'), 0, { x: 1, y: 0 }).reason, 'zero distance');
});

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

test('trim cuts at the actual intersection and removes the clicked piece', () => {
  const l = withLines(['t', 0, 0, 10, 0], ['cut', 4, -5, 4, 5]);
  const res = trimElement(l, E('t'), { x: 8, y: 0 });
  const t = ent(res.layout, 't');
  assert.deepEqual([t.x1, t.x2], [0, 4]);
  const other = trimElement(l, E('t'), { x: 1, y: 0 });
  const o = ent(other.layout, 't');
  assert.deepEqual([o.x1, o.x2], [4, 10]);
});

test('trimming the middle of a line between two cutters leaves two pieces', () => {
  const l = withLines(['t', 0, 0, 10, 0], ['c1', 3, -1, 3, 1], ['c2', 7, -1, 7, 1]);
  const res = trimElement(l, E('t'), { x: 5, y: 0 });
  const pieces = res.layout.cadEntities.filter((e) => e.y1 === 0 && e.y2 === 0);
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces.map((p) => [p.x1, p.x2]), [[0, 3], [7, 10]]);
  assert.equal(res.created.length, 1);
});

test('trim uses oblique and curved cutters at the real crossing', () => {
  const oblique = withLines(['t', 0, 0, 10, 0], ['c', 2, -2, 6, 2]);
  const t = ent(trimElement(oblique, E('t'), { x: 9, y: 0 }).layout, 't');
  almost(t.x2, 4);
  const circ = blank();
  circ.cadEntities = [createLineEntity({ x: 0, y: 0 }, { x: 10, y: 0 }, { id: 't' }), createCircleEntity({ x: 5, y: 0 }, 3, { id: 'c' })];
  const res = trimElement(circ, E('t'), { x: 5, y: 0 });
  const pieces = res.layout.cadEntities.filter((e) => e.kind === 'line');
  assert.deepEqual(pieces.map((p) => [p.x1, p.x2]), [[0, 2], [8, 10]]);
});

test('trim with no crossing reports it and changes nothing', () => {
  const l = withLines(['t', 0, 0, 10, 0], ['far', 0, 5, 10, 5]);
  const res = trimElement(l, E('t'), { x: 5, y: 0 });
  assert.equal(res.layout, l);
  assert.ok(res.reason);
});

test('trim works on walls and refuses to remove a hosted opening', () => {
  const l = blank();
  l.walls = [createWall({ id: 'w', x1: 0, y1: 0, x2: 20, y2: 0 }), createWall({ id: 'c', x1: 10, y1: -5, x2: 10, y2: 5 })];
  l.doors = [createDoor({ id: 'd', x: 5, y: 0, width: 3, wallId: 'w' })];
  const res = trimElement(l, W('w'), { x: 15, y: 0 });
  const w = byId(res.layout.walls, 'w');
  assert.deepEqual([w.x1, w.x2], [0, 10]);
  assert.equal(res.layout.doors[0].wallId, 'w');
  const refused = trimElement(l, W('w'), { x: 5, y: 0 });
  assert.equal(refused.layout, l);
  assert.match(refused.reason, /door or window/);
});

test('trim a circle into an arc, and an arc into a shorter arc', () => {
  const l = blank();
  l.cadEntities = [
    createCircleEntity({ x: 0, y: 0 }, 5, { id: 'c' }),
    createLineEntity({ x: 0, y: -10 }, { x: 0, y: 10 }, { id: 'cut' }),
  ];
  const res = trimElement(l, E('c'), { x: 5, y: 0 });
  const arc = ent(res.layout, 'c');
  assert.equal(arc.kind, 'arc');
  almost(arcSweep(arc), 180);
  // The removed side was x > 0
  almost(pointAtAngle(arc, arc.start + 90).x, -5);

  const again = trimElement({ ...res.layout, cadEntities: [arc, createLineEntity({ x: -10, y: 0 }, { x: 10, y: 0 }, { id: 'cut2' })] }, E('c'), { x: -3.5, y: -3.6 });
  const a2 = ent(again.layout, 'c');
  almost(arcSweep(a2), 90);
});

test('trim a polyline and a closed polygon', () => {
  const l = blank();
  l.cadEntities = [
    createPolylineEntity([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { id: 'p' }),
    createLineEntity({ x: 5, y: -2 }, { x: 5, y: 2 }, { id: 'c' }),
  ];
  const res = trimElement(l, E('p'), { x: 2, y: 0 });
  assert.deepEqual(ent(res.layout, 'p').points, [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);

  const r = blank();
  r.cadEntities = [
    createRectangleEntity({ x: 0, y: 0 }, { x: 10, y: 10 }, { id: 'r' }),
    createLineEntity({ x: 5, y: -2 }, { x: 5, y: 12 }, { id: 'c' }),
  ];
  const opened = trimElement(r, E('r'), { x: 10, y: 5 });
  const poly = ent(opened.layout, 'r');
  assert.equal(poly.kind, 'polyline');
  assert.equal(poly.closed, false);
  almost(entityLength(poly), 20);
});

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

test('extend reaches the next boundary along its own direction', () => {
  const l = withLines(['a', 0, 0, 3, 0], ['near', 6, -5, 6, 5], ['far', 9, -5, 9, 5]);
  const a = ent(extendElement(l, E('a'), { x: 2.9, y: 0 }).layout, 'a');
  assert.deepEqual([a.x1, a.y1, a.x2, a.y2], [0, 0, 6, 0]);
  const back = withLines(['a', 3, 0, 5, 0], ['b', 1, -5, 1, 5]);
  const b = ent(extendElement(back, E('a'), { x: 3.1, y: 0 }).layout, 'a');
  assert.deepEqual([b.x1, b.x2], [1, 5]);
});

test('extend keeps direction on an oblique line and reaches a circle', () => {
  const l = blank();
  l.cadEntities = [createLineEntity({ x: 0, y: 0 }, { x: 1, y: 1 }, { id: 'a' }), createCircleEntity({ x: 10, y: 10 }, 2, { id: 'c' })];
  const a = ent(extendElement(l, E('a'), { x: 1, y: 1 }).layout, 'a');
  almost(a.x2, a.y2);
  almost(Math.hypot(a.x2 - 10, a.y2 - 10), 2);
});

test('extend reports when no boundary exists; a wall carries its openings', () => {
  const l = withLines(['a', 0, 0, 3, 0]);
  const res = extendElement(l, E('a'), { x: 3, y: 0 });
  assert.equal(res.layout, l);
  assert.ok(res.reason);
  const w = blank();
  w.walls = [createWall({ id: 'w', x1: 0, y1: 0, x2: 10, y2: 0 }), createWall({ id: 'b', x1: 15, y1: -5, x2: 15, y2: 5 })];
  w.doors = [createDoor({ id: 'd', x: 5, y: 0, width: 3, wallId: 'w' })];
  const ext = extendElement(w, W('w'), { x: 9, y: 0 }).layout;
  assert.equal(byId(ext.walls, 'w').x2, 15);
  assert.equal(ext.doors[0].x, 5);
});

// ---------------------------------------------------------------------------
// Fillet / Chamfer
// ---------------------------------------------------------------------------

test('fillet radius 0 makes a sharp corner at the real intersection', () => {
  const l = withLines(['a', 0, 0, 4, 0], ['b', 6, 2, 6, 10]);
  const res = filletElements(l, E('a'), E('b'), 0);
  const a = ent(res.layout, 'a');
  const b = ent(res.layout, 'b');
  assert.deepEqual([a.x1, a.x2, a.y2], [0, 6, 0]);
  assert.deepEqual([b.x1, b.y1, b.y2], [6, 0, 10]);
});

test('fillet with radius adds a tangent arc of that radius', () => {
  const l = withLines(['a', 0, 0, 10, 0], ['b', 10, 0, 10, 10]);
  const res = filletElements(l, E('a'), E('b'), 2, { x: 1, y: 0 }, { x: 10, y: 9 });
  const a = ent(res.layout, 'a');
  const b = ent(res.layout, 'b');
  assert.deepEqual([a.x1, a.x2], [0, 8]);
  assert.deepEqual([b.y1, b.y2].sort((p, q) => p - q), [2, 10]);
  const arc = res.layout.cadEntities.find((e) => e.kind === 'arc');
  assert.equal(arc.r, 2);
  almost(arc.cx, 8);
  almost(arc.cy, 2);
  almost(arcSweep(arc), 90);
  // Tangent points really are the arc's ends
  almost(distanceToOutline({ x: 8, y: 0 }, arc, 'entity'), 0, 1e-3);
  almost(distanceToOutline({ x: 10, y: 2 }, arc, 'entity'), 0, 1e-3);
});

test('fillet refuses parallel lines, too-short lines and curved walls', () => {
  assert.match(filletElements(withLines(['a', 0, 0, 5, 0], ['b', 0, 3, 5, 3]), E('a'), E('b'), 1).reason, /parallel/);
  assert.match(filletElements(withLines(['a', 0, 0, 2, 0], ['b', 2, 0, 2, 2]), E('a'), E('b'), 5).reason, /too short/);
  const w = blank();
  w.walls = [createWall({ id: 'a', x1: 0, y1: 0, x2: 5, y2: 0 }), createWall({ id: 'b', x1: 5, y1: 0, x2: 5, y2: 5 })];
  assert.match(filletElements(w, W('a'), W('b'), 1).reason, /Curved walls/);
  const sharp = filletElements(w, W('a'), W('b'), 0);
  assert.equal(sharp.reason, null);
});

test('chamfer cuts at both distances and connects the ends', () => {
  const l = withLines(['a', 0, 0, 10, 0], ['b', 10, 0, 10, 10]);
  const res = chamferElements(l, E('a'), E('b'), 2, 3);
  const a = ent(res.layout, 'a');
  assert.equal(a.x2, 8);
  const b = ent(res.layout, 'b');
  assert.equal(Math.min(b.y1, b.y2), 3);
  const conn = res.layout.cadEntities.find((e) => e.id === res.created[0].id);
  assert.deepEqual([conn.x1, conn.y1, conn.x2, conn.y2], [8, 0, 10, 3]);
});

test('chamfering walls adds a real wall', () => {
  const l = blank();
  l.walls = [createWall({ id: 'a', x1: 0, y1: 0, x2: 10, y2: 0, thickness: 0.75 }), createWall({ id: 'b', x1: 10, y1: 0, x2: 10, y2: 10, thickness: 0.75 })];
  const res = chamferElements(l, W('a'), W('b'), 2, 2);
  assert.equal(res.layout.walls.length, 3);
  assert.equal(res.layout.walls[2].thickness, 0.75);
  assert.ok(chamferElements(l, W('a'), W('b'), 100, 2).reason);
});

// ---------------------------------------------------------------------------
// Stretch
// ---------------------------------------------------------------------------

test('stretch moves only the points in the window', () => {
  const l = blank();
  l.cadEntities = [
    createLineEntity({ x: 0, y: 0 }, { x: 10, y: 0 }, { id: 'a' }),
    createPolylineEntity([{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 5 }], { id: 'p' }),
    createCircleEntity({ x: 10, y: 10 }, 1, { id: 'c' }),
    createCircleEntity({ x: 40, y: 40 }, 1, { id: 'out' }),
  ];
  l.walls = [createWall({ id: 'w', x1: 0, y1: 20, x2: 10, y2: 20 })];
  l.doors = [createDoor({ id: 'd', x: 2, y: 20, width: 2, wallId: 'w' })];
  const res = stretchInBox(l, { x1: 8, y1: -1, x2: 12, y2: 21 }, 3, 0);
  assert.deepEqual([ent(res.layout, 'a').x1, ent(res.layout, 'a').x2], [0, 13]);
  assert.deepEqual(ent(res.layout, 'p').points, [{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 13, y: 5 }]);
  assert.equal(ent(res.layout, 'c').cx, 13);
  assert.equal(ent(res.layout, 'out').cx, 40);
  assert.deepEqual([byId(res.layout.walls, 'w').x1, byId(res.layout.walls, 'w').x2], [0, 13]);
  assert.equal(res.layout.doors[0].x, 2, 'an opening near the fixed end stays');
});

test('stretching a room edge goes through the room solver', () => {
  const base = buildFixture();
  const res = stretchInBox(base, { x1: 16, y1: 15, x2: 18, y2: 29 }, 1, 0);
  // Living's east edge corners are in the window.
  assert.equal(byId(res.layout.rooms, 'living').width, 16);
  assert.equal(byId(res.layout.rooms, 'living').x, 2);
});

test('stretch with nothing in the window reports it', () => {
  const l = withLines(['a', 0, 0, 1, 0]);
  const res = stretchInBox(l, { x1: 50, y1: 50, x2: 60, y2: 60 }, 1, 1);
  assert.equal(res.layout, l);
  assert.ok(res.reason);
});

// ---------------------------------------------------------------------------
// Break
// ---------------------------------------------------------------------------

test('break splits at a point and across a gap', () => {
  const l = withLines(['a', 0, 0, 10, 0]);
  const one = breakAtClick(l, E('a'), { x: 4, y: 0 });
  assert.deepEqual(one.layout.cadEntities.map((e) => [e.x1, e.x2]), [[0, 4], [4, 10]]);
  const gap = breakAtClick(l, E('a'), { x: 5, y: 0 }, 2);
  assert.deepEqual(gap.layout.cadEntities.map((e) => [e.x1, e.x2]), [[0, 4], [6, 10]]);
  assert.ok(breakElement(l, E('a'), { x: 0, y: 0 }).reason, 'at the very end there is nothing to split');
});

test('break a wall re-hosts its openings and refuses to cut one out', () => {
  const l = blank();
  l.walls = [createWall({ id: 'w', x1: 0, y1: 0, x2: 20, y2: 0 })];
  l.doors = [createDoor({ id: 'd', x: 15, y: 0, width: 3, wallId: 'w' })];
  const res = breakAtClick(l, W('w'), { x: 10, y: 0 });
  assert.equal(res.layout.walls.length, 2);
  const host = res.layout.walls.find((w) => w.id === res.layout.doors[0].wallId);
  assert.deepEqual([host.x1, host.x2], [10, 20]);
  const refused = breakAtClick(l, W('w'), { x: 15, y: 0 }, 2);
  assert.match(refused.reason, /door or window/);
});

test('break a circle into an arc and an arc in two', () => {
  const l = blank();
  l.cadEntities = [createCircleEntity({ x: 0, y: 0 }, 5, { id: 'c' })];
  const res = breakAtClick(l, E('c'), { x: 5, y: 0 }, 1);
  const arc = ent(res.layout, 'c');
  assert.equal(arc.kind, 'arc');
  almost(arcSweep(arc), 360 - (1 / 5) * (180 / Math.PI), 1e-3);

  const a = blank();
  a.cadEntities = [createArcEntity({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { id: 'a' })];
  const two = breakElement(a, E('a'), { x: 0, y: 5 });
  assert.equal(two.layout.cadEntities.length, 2);
  almost(arcSweep(two.layout.cadEntities[0]), 90);
  almost(arcSweep(two.layout.cadEntities[1]), 90);
});

test('breaking a closed polygon opens it', () => {
  const l = blank();
  l.cadEntities = [createRectangleEntity({ x: 0, y: 0 }, { x: 10, y: 10 }, { id: 'r' })];
  const res = breakElement(l, E('r'), { x: 5, y: 0 });
  const p = ent(res.layout, 'r');
  assert.equal(p.kind, 'polyline');
  almost(entityLength(p), 40);
});

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

test('join merges collinear lines and chains others into a polyline', () => {
  const l = withLines(['a', 0, 0, 5, 0], ['b', 5, 0, 10, 0]);
  const res = joinSelection(l, [E('a'), E('b')]);
  assert.equal(res.layout.cadEntities.length, 1);
  const a = res.layout.cadEntities[0];
  assert.equal(a.kind, 'line');
  assert.deepEqual([a.x1, a.x2], [0, 10]);

  const corner = withLines(['a', 0, 0, 5, 0], ['b', 5, 0, 5, 5]);
  const p = joinSelection(corner, [E('a'), E('b')]).layout.cadEntities[0];
  assert.equal(p.kind, 'polyline');
  assert.deepEqual(p.points, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]);

  const reversed = withLines(['a', 0, 0, 5, 0], ['b', 5, 5, 5, 0]);
  assert.equal(joinSelection(reversed, [E('a'), E('b')]).layout.cadEntities[0].kind, 'polyline');
});

test('join validates endpoints and reports when nothing is compatible', () => {
  const l = withLines(['a', 0, 0, 5, 0], ['b', 6, 0, 10, 0]);
  const res = joinSelection(l, [E('a'), E('b')]);
  assert.equal(res.layout, l);
  assert.ok(res.reason);
});

test('join merges walls and arcs of the same circle', () => {
  const w = blank();
  w.walls = [createWall({ id: 'a', x1: 0, y1: 0, x2: 5, y2: 0 }), createWall({ id: 'b', x1: 5, y1: 0, x2: 10, y2: 0 }), createWall({ id: 'c', x1: 10, y1: 0, x2: 15, y2: 0 })];
  const res = joinSelection(w, [W('a'), W('b'), W('c')]);
  assert.equal(res.layout.walls.length, 1);
  assert.deepEqual([res.layout.walls[0].x1, res.layout.walls[0].x2], [0, 15]);

  const a = blank();
  const whole = createArcEntity({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }, { id: 'a1' });
  a.cadEntities = breakElement({ ...a, cadEntities: [whole] }, E('a1'), { x: 0, y: 5 }).layout.cadEntities;
  const merged = joinSelection(a, a.cadEntities.map((e) => E(e.id)));
  assert.equal(merged.layout.cadEntities.length, 1);
  almost(arcSweep(merged.layout.cadEntities[0]), 180);
});

// ---------------------------------------------------------------------------
// Duplicate / delete / arrays / clipboard
// ---------------------------------------------------------------------------

test('duplicating a room gets new ids and its own walls', () => {
  const l = blank();
  l.rooms = [createRoom({ id: 'r', name: 'Den', x: 10, y: 10, width: 10, length: 10 }), createRoom({ id: 'other', x: 60, y: 60, width: 4, length: 4 })];
  const res = copySelection(l, [{ type: 'room', id: 'r' }], 20, 20);
  const copy = res.layout.rooms[2];
  assert.notEqual(copy.id, 'r');
  assert.equal(copy.name, 'Den (Copy)');
  assert.deepEqual([copy.x, copy.y, copy.width, copy.length], [30, 30, 10, 10]);
  assert.equal(res.layout.walls.length, 4);
});

test('duplicating a door keeps it on a wall and clear of the original', () => {
  const l = blank();
  l.walls = [createWall({ id: 'w', x1: 0, y1: 0, x2: 30, y2: 0 })];
  l.doors = [createDoor({ id: 'd', x: 10, y: 0, width: 3, wallId: 'w', isMain: true })];
  const res = copySelection(l, [{ type: 'door', id: 'd' }], 2, 2);
  const copy = res.layout.doors[1];
  assert.equal(copy.wallId, 'w');
  assert.equal(copy.y, 0);
  assert.ok(Math.abs(copy.x - 10) >= 3.25 - 1e-6, `gap kept, x=${copy.x}`);
  assert.equal(copy.isMain, false, 'there is only one main door');
});

test('copying a wall takes its openings along, hosted on the new wall', () => {
  const l = blank();
  l.walls = [createWall({ id: 'w', x1: 0, y1: 0, x2: 30, y2: 0 })];
  l.windows = [createWindow({ id: 'n', x: 10, y: 0, width: 4, wallId: 'w' })];
  const res = copySelection(l, [W('w')], 0, 10);
  const newWall = res.layout.walls[1];
  const win = res.layout.windows[1];
  assert.equal(win.wallId, newWall.id);
  assert.deepEqual([win.x, win.y], [10, 10]);
});

test('delete takes hosted openings and a room\'s own walls, not shared ones', () => {
  const l = blank();
  l.rooms = [createRoom({ id: 'r', x: 10, y: 10, width: 10, length: 10 }), createRoom({ id: 'n', x: 20, y: 10, width: 10, length: 10 })];
  const shared = createWall({ id: 'shared', x1: 20, y1: 10, x2: 20, y2: 20 });
  const own = createWall({ id: 'own', x1: 10, y1: 10, x2: 10, y2: 20 });
  l.walls = [shared, own];
  l.doors = [createDoor({ id: 'd', x: 10, y: 15, width: 3, wallId: 'own' }), createDoor({ id: 'e', x: 20, y: 15, width: 3, wallId: 'shared' })];
  const res = deleteSelection(l, [{ type: 'room', id: 'r' }]);
  assert.deepEqual(res.layout.rooms.map((r) => r.id), ['n']);
  assert.deepEqual(res.layout.walls.map((w) => w.id), ['shared']);
  assert.deepEqual(res.layout.doors.map((d) => d.id), ['e']);
});

test('the last room, plot dimensions and locked objects are not deleted', () => {
  const l = blank();
  l.rooms = [createRoom({ id: 'only', x: 1, y: 1, width: 5, length: 5 })];
  l.dimensions.push({ id: 'dim-plot-width', x1: 0, y1: 0, x2: 1, y2: 0, axis: 'width' });
  l.cadEntities = [createLineEntity({ x: 0, y: 0 }, { x: 1, y: 1 }, { id: 'a', isLocked: true })];
  const res = deleteSelection(l, [{ type: 'room', id: 'only' }, { type: 'dimension', id: 'dim-plot-width' }, E('a')]);
  assert.equal(res.layout, l);
  assert.equal(res.removed, 0);
  assert.equal(res.skipped.length, 3);
});

test('rectangular array makes rows x columns at the exact spacing', () => {
  const l = withLines(['a', 0, 0, 1, 0]);
  const res = rectangularArray(l, [E('a')], { rows: 2, cols: 3, dx: 5, dy: 7 });
  assert.equal(res.layout.cadEntities.length, 6);
  const at = res.layout.cadEntities.map((e) => `${e.x1},${e.y1}`).sort();
  assert.deepEqual(at, ['0,0', '0,7', '10,0', '10,7', '5,0', '5,7'].sort());
  assert.equal(new Set(res.layout.cadEntities.map((e) => e.id)).size, 6, 'independent ids');
  assert.ok(rectangularArray(l, [E('a')], { rows: 1, cols: 1, dx: 5, dy: 5 }).reason);
});

test('polar array spreads items evenly about the centre', () => {
  const l = blank();
  l.columns = [createColumn({ id: 'c', x: 10, y: 0 })];
  const res = polarArray(l, [{ type: 'column', id: 'c' }], { count: 4, angle: 360, center: { x: 0, y: 0 } });
  assert.equal(res.layout.columns.length, 4);
  const pts = res.layout.columns.map((c) => [Math.round(c.x), Math.round(c.y)]);
  assert.deepEqual(pts, [[10, 0], [0, 10], [-10, 0], [0, -10]]);
  const part = polarArray(l, [{ type: 'column', id: 'c' }], { count: 3, angle: 90, center: { x: 0, y: 0 } });
  const last = part.layout.columns[2];
  almost(last.x, 0);
  almost(last.y, 10);
});

test('a polar array reports rooms it cannot place at oblique angles', () => {
  const l = blank();
  l.rooms = [createRoom({ id: 'r', x: 10, y: 0, width: 5, length: 5 }), createRoom({ id: 'r2', x: 50, y: 50, width: 5, length: 5 })];
  const res = polarArray(l, [{ type: 'room', id: 'r' }], { count: 8, angle: 360, center: { x: 0, y: 0 } });
  assert.ok(res.skipped.length > 0);
  assert.equal(res.layout.rooms.length, 2 + 3, 'only the 90 degree steps fit');
});

test('clipboard keeps its own copy and pasting twice gives independent objects', () => {
  const l = withLines(['a', 0, 0, 1, 0]);
  const clip = copyToClipboard(l, [E('a')]);
  const changed = { ...l, cadEntities: [{ ...l.cadEntities[0], x2: 99 }] };
  const once = insertCopies(changed, clip, makeTranslate(2, 2));
  const twice = insertCopies(once.layout, clip, makeTranslate(4, 4));
  const ids = twice.layout.cadEntities.map((e) => e.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(twice.layout.cadEntities[1].x2, 3, 'copied from the original, not the later edit');
  assert.equal(twice.layout.cadEntities[2].x2, 5);
});

test('every command is one undo step restoring the exact geometry', () => {
  const l = withLines(['t', 0, 0, 10, 0], ['c', 5, -5, 5, 5]);
  const h = new HistoryManager(l);
  const res = trimElement(l, E('t'), { x: 8, y: 0 });
  h.pushState(res.layout);
  assert.deepEqual(h.undo(), cloneLayout(l));
  assert.deepEqual(h.redo(), cloneLayout(res.layout));
});

test('picking finds the outline under the pointer within tolerance', () => {
  const l = withLines(['a', 0, 0, 10, 0]);
  l.walls = [createWall({ id: 'w', x1: 0, y1: 5, x2: 10, y2: 5 })];
  assert.equal(pickOutline(l, { x: 5, y: 0.1 }, 0.3).id, 'a');
  assert.equal(pickOutline(l, { x: 5, y: 5.1 }, 0.3).id, 'w');
  assert.equal(pickOutline(l, { x: 5, y: 2 }, 0.3), null);
});

test('CAD entities follow a site resize with the building', () => {
  const base = buildFixture();
  base.cadEntities = [
    createLineEntity({ x: 2, y: 4 }, { x: 28, y: 4 }, { id: 'a' }),
    createCircleEntity({ x: 28, y: 36 }, 1, { id: 'c' }),
    createPolylineEntity([{ x: 2, y: 4 }, { x: 28, y: 36 }], { id: 'p' }),
  ];
  const res = applySiteChange(base, { width: 34, edge: 'right' });
  const eastEdge = 34 - 2;
  almost(ent(res.nextLayout, 'a').x2, eastEdge);
  almost(ent(res.nextLayout, 'c').cx, eastEdge);
  almost(ent(res.nextLayout, 'p').points[1].x, eastEdge);
  almost(ent(res.nextLayout, 'c').r, 1);
  assert.ok(res.success);
});
