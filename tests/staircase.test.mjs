import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStaircase,
  normalizeStaircase,
  calculateStaircaseGeometry,
  getStaircaseBounds,
  resizeStaircaseWorld,
  rotateStaircase,
  validateStaircaseFit,
  STAIRCASE_TYPES,
} from '../components/editor/staircaseGeometry.js';

const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const IN = 1 / 12;

test('straight stair: treads = risers - 1 and run = treads x tread depth', () => {
  const s = createStaircase({ stairType: STAIRCASE_TYPES.STRAIGHT, risers: 17, treadDepth: 10 * IN, floorHeight: 10 });
  assert.equal(s.treads, 16);
  assert.equal(s.flights, 1);
  assert.ok(near(s.length, 16 * 10 * IN));
  const g = calculateStaircaseGeometry(s);
  assert.equal(g.flights[0].treadCount, 16);
  assert.equal(g.flights[0].treads.length, 15, 'interior tread lines = treads - 1');
  assert.ok(near(g.metrics.riserHeightInches, 120 / 17));
  assert.equal(g.landings.length, 0);
});

test('dog-legged stair splits risers between two flights with one landing', () => {
  const s = createStaircase({ stairType: STAIRCASE_TYPES.DOG_LEGGED, risers: 19, treadDepth: 10 * IN, landingDepth: 3, width: 6 });
  const g = calculateStaircaseGeometry(s);
  assert.deepEqual(g.metrics.risersPerFlight, [10, 9]);
  assert.deepEqual(g.metrics.treadsPerFlight, [9, 8]);
  assert.equal(s.treads, 17, 'T = R - F');
  assert.equal(g.landings.length, 1);
  assert.ok(near(s.length, 9 * 10 * IN + 3), 'length = longest flight run + landing');
  assert.ok(near(s.flightWidth, (6 - s.wellGap) / 2));
});

test('changing risers regenerates step geometry', () => {
  const a = createStaircase({ stairType: 'straight', risers: 12 });
  const b = normalizeStaircase({ ...a, risers: 18 }, 'risers');
  assert.equal(calculateStaircaseGeometry(a).metrics.totalTreads, 11);
  assert.equal(calculateStaircaseGeometry(b).metrics.totalTreads, 17);
  assert.ok(b.length > a.length, 'more treads at the same depth -> longer run');
});

test('changing tread depth updates the horizontal run', () => {
  const a = createStaircase({ stairType: 'straight', risers: 16, treadDepth: 10 * IN });
  const b = normalizeStaircase({ ...a, treadDepth: 11 * IN }, 'treadDepth');
  assert.ok(near(b.length, 15 * 11 * IN));
});

test('changing floor height or risers updates riser height', () => {
  const a = createStaircase({ stairType: 'straight', risers: 16, floorHeight: 10 });
  const b = normalizeStaircase({ ...a, floorHeight: 11 }, 'floorHeight');
  assert.ok(near(b.riserHeight * 12, 132 / 16));
  const c = normalizeStaircase({ ...a, risers: 20 }, 'risers');
  assert.ok(near(c.riserHeight * 12, 6));
});

test('resizing length keeps the step count and recomputes tread depth', () => {
  const a = createStaircase({ stairType: 'straight', risers: 16, treadDepth: 10 * IN });
  const b = resizeStaircaseWorld(a, 'y', 15);
  assert.equal(b.risers, 16);
  assert.equal(b.treads, 15);
  assert.ok(near(b.treadDepth, 1));
  assert.ok(near(b.length, 15));
});

test('resizing width changes the footprint and the flight width', () => {
  const a = createStaircase({ stairType: 'dog-legged', width: 6 });
  const b = resizeStaircaseWorld(a, 'x', 7);
  assert.equal(b.width, 7);
  assert.ok(b.flightWidth > a.flightWidth);
  assert.equal(b.risers, a.risers);
});

test('rotation swaps the world bounding box and keeps the centre', () => {
  const a = createStaircase({ stairType: 'straight', x: 10, y: 10, width: 3.5, risers: 13 });
  const b0 = getStaircaseBounds(a);
  const r = rotateStaircase(a, 90);
  const b1 = getStaircaseBounds(r);
  assert.equal(r.rotation, 90);
  assert.ok(near(b1.width, b0.length) && near(b1.length, b0.width));
  assert.ok(near(b0.x + b0.width / 2, b1.x + b1.width / 2));
  assert.ok(near(b0.y + b0.length / 2, b1.y + b1.length / 2));
  // With a 90 deg rotation, a resize along world x changes the stair's length
  const resized = resizeStaircaseWorld(r, 'x', 12);
  assert.ok(near(resized.length, 12));
  // All generated geometry stays within the bounding box
  const g = calculateStaircaseGeometry(r);
  const pts = [...g.outline, ...g.flights.flatMap((f) => f.polygon), ...g.arrow.points];
  for (const p of pts) {
    assert.ok(p.x >= b1.x - 1e-3 && p.x <= b1.x + b1.width + 1e-3 && p.y >= b1.y - 1e-3 && p.y <= b1.y + b1.length + 1e-3);
  }
});

test('L-shaped stair: footprint follows flight width and tread depth', () => {
  const s = createStaircase({ stairType: 'l-shaped', risers: 18, treadDepth: 10 * IN, flightWidth: 3.5 });
  const g = calculateStaircaseGeometry(s);
  assert.deepEqual(g.metrics.treadsPerFlight, [8, 8]);
  assert.ok(near(s.length, 3.5 + 8 * 10 * IN));
  assert.ok(near(s.width, 3.5 + 8 * 10 * IN));
  assert.equal(g.landings.length, 1);
});

test('legacy staircases without treadDepth keep their footprint on load', () => {
  const legacy = { id: 'old', stairType: 'dog-legged', x: 1, y: 1, width: 6, length: 9, risers: 16, floorHeight: 10, landingDepth: 3 };
  const s = normalizeStaircase(legacy);
  assert.equal(s.length, 9);
  assert.equal(s.width, 6);
  assert.ok(near(s.treadDepth, 6 / 7));
});

test('guideline warnings are produced for steep stairs', () => {
  const s = createStaircase({ stairType: 'straight', risers: 10, floorHeight: 10 });
  const v = validateStaircaseFit(s, { plot: { width: 30, length: 40 } });
  assert.equal(v.isValid, false);
  assert.ok(v.warnings.some((w) => w.includes('Riser height')));
});

test('layout validation surfaces staircase guideline warnings', async () => {
  const { validateLayout } = await import('../components/editor/layoutValidation.js');
  const layout = { plot: { width: 30, length: 40, setbacks: {} }, rooms: [], walls: [], doors: [], windows: [],
    staircases: [createStaircase({ id: 'steep', stairType: 'straight', risers: 10, floorHeight: 10 })] };
  const issues = validateLayout(layout);
  assert.ok(issues.some((i) => i.elementId === 'steep' && i.title === 'Staircase Guideline'));
});
