import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WALL_THICKNESS_IN,
  WALL_THICKNESS_OPTIONS,
  calculateWallLength,
  canJoinWalls,
  cloneLayout,
  createDefaultLayout,
  createDoor,
  createWall,
  createWindow,
  findElementsOutsidePlot,
  getPlotRect,
  getWallThicknessInches,
  inchesToFeet,
} from '../components/editor/layoutModel.js';
import {
  buildWall,
  getOpeningGeometry,
  getOpeningHost,
  getWallShape,
  setWallProps,
  setWallThickness,
  splitWall,
} from '../components/editor/wallOps.js';
import { generateLayoutSVG } from '../components/editor/exportUtils.js';
import { HistoryManager } from '../components/editor/historyManager.js';
import { loadProject, normalizeLoadedLayout, saveProject } from '../components/editor/projectStorage.js';
import { buildFixture } from './fixtures.mjs';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

function bounds(polygon) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function layoutWith(walls, extra = {}) {
  return { ...createDefaultLayout({ siteWidth: 60, siteLength: 60 }), walls, ...extra };
}

const horizontal = (id = 'h', inches = 6) => createWall({ id, x1: 10, y1: 10, x2: 30, y2: 10, thicknessInches: inches });

test('the options are 2 to 8 inches and the default is 6', () => {
  assert.deepEqual(WALL_THICKNESS_OPTIONS, [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(DEFAULT_WALL_THICKNESS_IN, 6);
});

for (const inches of [2, 3, 4, 5, 6, 7, 8]) {
  test(`a new ${inches}" wall stores inches and has the exact width in world units`, () => {
    const wall = buildWall({ x: 0, y: 0 }, { x: 10, y: 0 }, { thicknessInches: inches });
    assert.equal(wall.thicknessInches, inches);
    assert.equal(wall.thickness, inches / 12);
    const b = bounds(getWallShape(wall).polygon);
    assert.ok(near(b.maxY - b.minY, inches / 12), 'outline is as wide as the thickness');
    assert.ok(near(b.maxX - b.minX, 10), 'outline is exactly as long as the wall');
  });
}

test('a new wall with no thickness given is 6 inches', () => {
  const wall = buildWall({ x: 0, y: 0 }, { x: 10, y: 0 });
  assert.equal(wall.thicknessInches, 6);
  assert.equal(wall.thickness, 0.5);
});

test('walls created the older way report the right inches', () => {
  assert.equal(createWall({ type: 'exterior' }).thicknessInches, 9);
  assert.equal(createWall({ type: 'interior' }).thicknessInches, 4.5);
  assert.equal(getWallThicknessInches({ thickness: 0.75 }), 9);
});

test('changing thickness updates the stored geometry value, and nothing else on the wall', () => {
  const wall = horizontal();
  const res = setWallThickness(layoutWith([wall]), 'h', 8);
  const next = res.layout.walls[0];

  assert.equal(next.thicknessInches, 8);
  assert.equal(next.thickness, inchesToFeet(8));
  for (const key of ['id', 'type', 'x1', 'y1', 'x2', 'y2', 'color', 'isLocked']) assert.equal(next[key], wall[key], key);
  assert.equal(calculateWallLength(next), calculateWallLength(wall));
});

test('the outline grows equally about the centreline on horizontal, vertical, and angled walls', () => {
  const cases = [
    createWall({ id: 'a', x1: 10, y1: 10, x2: 30, y2: 10, thicknessInches: 2 }),
    createWall({ id: 'a', x1: 10, y1: 10, x2: 10, y2: 30, thicknessInches: 2 }),
    createWall({ id: 'a', x1: 10, y1: 10, x2: 22, y2: 19, thicknessInches: 2 }),
  ];
  for (const wall of cases) {
    const next = setWallThickness(layoutWith([wall]), 'a', 8).layout.walls[0];
    const p = getWallShape(next).polygon;
    const len = calculateWallLength(wall);
    assert.ok(near(Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), len), 'face length equals wall length');
    assert.ok(near(Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y), 8 / 12), 'width equals thickness');
    // The midpoint across each end is the centreline endpoint: alignment is preserved.
    assert.ok(near((p[0].x + p[3].x) / 2, wall.x1) && near((p[0].y + p[3].y) / 2, wall.y1));
    assert.ok(near((p[1].x + p[2].x) / 2, wall.x2) && near((p[1].y + p[2].y) / 2, wall.y2));
  }
});

test('an unchanged value is a no-op, so it adds no undo step', () => {
  const layout = layoutWith([horizontal()]);
  assert.equal(setWallThickness(layout, 'h', 6).layout, layout);
});

test('values outside the list, locked walls, and unknown walls are refused', () => {
  const layout = layoutWith([horizontal(), createWall({ id: 'locked', x1: 0, y1: 40, x2: 9, y2: 40, isLocked: true })]);
  for (const [id, value] of [['h', 9], ['h', 1], ['h', '6'], ['locked', 4], ['missing', 4]]) {
    const res = setWallThickness(layout, id, value);
    assert.equal(res.layout, layout);
    assert.ok(res.reason, `${id} ${value}`);
  }
});

test('changing one wall leaves other walls alone, including connected ones', () => {
  const a = horizontal('a', 6);
  const b = createWall({ id: 'b', x1: 30, y1: 10, x2: 30, y2: 30, thicknessInches: 4 });
  const far = createWall({ id: 'far', x1: 0, y1: 50, x2: 20, y2: 50, thicknessInches: 7 });
  const res = setWallThickness(layoutWith([a, b, far]), 'a', 8);

  assert.deepEqual(res.updatedIds, ['a']);
  assert.equal(res.layout.walls[1], b);
  assert.equal(res.layout.walls[2], far);
});

test('collinear walls that only touch end to end stay independent', () => {
  const a = createWall({ id: 'a', x1: 0, y1: 10, x2: 10, y2: 10, thicknessInches: 6 });
  const b = createWall({ id: 'b', x1: 10, y1: 10, x2: 20, y2: 10, thicknessInches: 6 });
  const next = setWallThickness(layoutWith([a, b]), 'a', 3).layout;
  assert.equal(next.walls[1].thicknessInches, 6);
});

test('overlapping segments of one physical wall change together, transitively', () => {
  const a = createWall({ id: 'a', x1: 0, y1: 10, x2: 10, y2: 10, thicknessInches: 6 });
  const b = createWall({ id: 'b', x1: 5, y1: 10, x2: 15, y2: 10, thicknessInches: 4 });
  const c = createWall({ id: 'c', x1: 12, y1: 10, x2: 20, y2: 10, thicknessInches: 5 });
  const other = createWall({ id: 'other', x1: 0, y1: 12, x2: 20, y2: 12, thicknessInches: 5 });
  const res = setWallThickness(layoutWith([a, b, c, other]), 'a', 8);

  assert.deepEqual([...res.updatedIds].sort(), ['a', 'b', 'c']);
  assert.deepEqual(res.layout.walls.map((w) => w.thicknessInches), [8, 8, 8, 5]);
});

test('a locked overlapping segment is respected', () => {
  const a = createWall({ id: 'a', x1: 0, y1: 10, x2: 10, y2: 10 });
  const b = createWall({ id: 'b', x1: 5, y1: 10, x2: 15, y2: 10, thicknessInches: 4, isLocked: true });
  const next = setWallThickness(layoutWith([a, b]), 'a', 8).layout;
  assert.equal(next.walls[1].thicknessInches, 4);
});

test('an L corner with mixed thicknesses closes to a square outer corner', () => {
  const a = createWall({ id: 'a', x1: 0, y1: 10, x2: 20, y2: 10, thicknessInches: 8 });
  const b = createWall({ id: 'b', x1: 20, y1: 10, x2: 20, y2: 30, thicknessInches: 2 });
  const walls = [a, b];
  const ba = bounds(getWallShape(a, walls).polygon);
  const bb = bounds(getWallShape(b, walls).polygon);

  // Wall a runs on to b's outer face and b runs up to a's outer face.
  assert.ok(near(ba.maxX, 20 + 1 / 12));
  assert.ok(near(bb.maxX, 20 + 1 / 12));
  assert.ok(near(bb.minY, 10 - 4 / 12));
  assert.ok(near(ba.minY, 10 - 4 / 12));
  // The free ends stay exactly at the wall's true length.
  assert.ok(near(ba.minX, 0));
  assert.ok(near(bb.maxY, 30));
});

test('corners stay closed after a thickness change', () => {
  const a = createWall({ id: 'a', x1: 0, y1: 10, x2: 20, y2: 10, thicknessInches: 6 });
  const b = createWall({ id: 'b', x1: 20, y1: 10, x2: 20, y2: 30, thicknessInches: 6 });
  const { walls } = setWallThickness(layoutWith([a, b]), 'a', 2).layout;

  assert.equal(walls[0].x2, walls[1].x1, 'endpoints still meet');
  assert.equal(walls[0].y2, walls[1].y1);
  const bb = bounds(getWallShape(walls[1], walls).polygon);
  assert.ok(near(bb.minY, 10 - 1 / 12), 'b now stops at the thinner outer face');
});

test('a wall that butts into a through-wall is not pushed out the far side', () => {
  const left = createWall({ id: 'left', x1: 0, y1: 10, x2: 10, y2: 10, thicknessInches: 8 });
  const right = createWall({ id: 'right', x1: 10, y1: 10, x2: 20, y2: 10, thicknessInches: 8 });
  const stem = createWall({ id: 'stem', x1: 10, y1: 10, x2: 10, y2: 20, thicknessInches: 4 });
  const walls = [left, right, stem];

  assert.ok(near(bounds(getWallShape(stem, walls).polygon).minY, 10), 'stem stops at the centreline');
  assert.ok(near(bounds(getWallShape(left, walls).polygon).maxX, 10), 'the through-wall does not extend');
  assert.ok(near(bounds(getWallShape(right, walls).polygon).minX, 10));
});

test('a stem ending mid-span of another wall does not change it', () => {
  const through = createWall({ id: 'through', x1: 0, y1: 10, x2: 20, y2: 10, thicknessInches: 8 });
  const stem = createWall({ id: 'stem', x1: 10, y1: 10, x2: 10, y2: 20, thicknessInches: 4 });
  const walls = [through, stem];
  assert.ok(near(bounds(getWallShape(through, walls).polygon).maxX, 20));
  assert.ok(near(bounds(getWallShape(stem, walls).polygon).minY, 10));
});

test('an angled corner gets a joint at the shared point, each at its own radius', () => {
  const a = createWall({ id: 'a', x1: 0, y1: 0, x2: 10, y2: 0, thicknessInches: 6 });
  const b = createWall({ id: 'b', x1: 10, y1: 0, x2: 17, y2: 7, thicknessInches: 4 });
  const walls = [a, b];
  assert.deepEqual(getWallShape(a, walls).joints, [{ x: 10, y: 0, r: 0.25 }]);
  assert.deepEqual(getWallShape(b, walls).joints, [{ x: 10, y: 0, r: 2 / 12 }]);
});

test('free ends get no extension or joint', () => {
  const shape = getWallShape(horizontal(), [horizontal()]);
  assert.deepEqual(shape.joints, []);
  assert.ok(near(bounds(shape.polygon).minX, 10));
  assert.ok(near(bounds(shape.polygon).maxX, 30));
});

test('doors and windows stay attached, in place, and adopt the new thickness', () => {
  const wall = horizontal('host', 6);
  const door = createDoor({ id: 'door', x: 15, y: 10, width: 3, wallId: 'host' });
  const win = createWindow({ id: 'win', x: 25, y: 10, width: 4, wallId: 'host' });
  const next = setWallThickness(layoutWith([wall], { doors: [door], windows: [win] }), 'host', 2).layout;

  assert.equal(next.doors[0], door);
  assert.equal(next.windows[0], win);
  assert.equal(getOpeningHost(next.doors[0], next.walls).wall.id, 'host');
  assert.equal(getOpeningHost(next.windows[0], next.walls).wall.id, 'host');
  assert.equal(getOpeningGeometry(next.doors[0], next.walls).thickness, 2 / 12);
  assert.equal(getOpeningGeometry(next.windows[0], next.walls).thickness, 2 / 12);
});

test('rooms and the plot boundary do not change on the generated-style fixture', () => {
  const base = buildFixture();
  const wall = base.walls.find((w) => w.id === 'ext-n');
  const res = setWallThickness(base, wall.id, 3);

  assert.equal(res.layout.rooms, base.rooms);
  assert.equal(res.layout.plot, base.plot);
  assert.deepEqual(getPlotRect(res.layout), getPlotRect(base));
});

test('a wall thickened past the plot edge is reported, and the plot does not move', () => {
  const edge = createWall({ id: 'edge', x1: 0, y1: 0.1, x2: 20, y2: 0.1, thicknessInches: 2 });
  const layout = layoutWith([edge]);
  assert.deepEqual(findElementsOutsidePlot(layout), []);

  const res = setWallThickness(layout, 'edge', 8);
  assert.equal(res.outside, true);
  assert.deepEqual(getPlotRect(res.layout), getPlotRect(layout));
  assert.ok(findElementsOutsidePlot(res.layout).some((o) => o.id === 'edge'));
});

test('splitting keeps the thickness on both pieces', () => {
  const res = splitWall(layoutWith([horizontal('h', 3)]), 'h');
  assert.deepEqual(res.segments.map((s) => s.thicknessInches), [3, 3]);
  assert.deepEqual(res.segments.map((s) => s.thickness), [0.25, 0.25]);
});

test('walls one inch apart in thickness cannot be joined into one', () => {
  const a = createWall({ id: 'a', x1: 0, y1: 0, x2: 10, y2: 0, thicknessInches: 2 });
  const b = createWall({ id: 'b', x1: 10, y1: 0, x2: 20, y2: 0, thicknessInches: 3 });
  const same = createWall({ id: 'c', x1: 10, y1: 0, x2: 20, y2: 0, thicknessInches: 2 });
  assert.equal(canJoinWalls(a, b), false);
  assert.ok(canJoinWalls(a, same));
});

test('setWallProps keeps inches and feet in step', () => {
  const next = setWallProps(layoutWith([horizontal()]), 'h', { thickness: 0.25 });
  assert.equal(next.walls[0].thicknessInches, 3);
});

test('undo and redo restore the thickness', () => {
  const base = layoutWith([horizontal()]);
  const history = new HistoryManager(base);
  history.pushState(setWallThickness(base, 'h', 2).layout);

  const undone = history.undo();
  assert.equal(undone.walls[0].thicknessInches, 6);
  assert.equal(undone.walls[0].thickness, 0.5);
  const redone = history.redo();
  assert.equal(redone.walls[0].thicknessInches, 2);
  assert.equal(redone.walls[0].thickness, 2 / 12);
});

test('save and reopen restores thickness as a number', async () => {
  const store = new Map();
  globalThis.window = {
    localStorage: { setItem: (k, v) => store.set(k, v), getItem: (k) => (store.has(k) ? store.get(k) : null) },
  };
  try {
    const { id, ...withoutId } = layoutWith([horizontal()]);
    const next = setWallThickness(withoutId, 'h', 7).layout;
    assert.equal(await saveProject(next), true);
    const wall = loadProject().walls[0];
    assert.equal(wall.thicknessInches, 7);
    assert.equal(wall.thickness, 7 / 12);
    assert.equal(typeof wall.thicknessInches, 'number');
  } finally {
    delete globalThis.window;
  }
});

test('an older project gains inches on load, with the same thickness', () => {
  const old = cloneLayout(layoutWith([horizontal()]));
  delete old.walls[0].thicknessInches;
  old.walls[0].thickness = 0.75;
  const wall = normalizeLoadedLayout(old).walls[0];
  assert.equal(wall.thicknessInches, 9);
  assert.equal(wall.thickness, 0.75);
});

test('SVG export draws walls at their real width', () => {
  const svg = generateLayoutSVG(layoutWith([createWall({ id: 'a', x1: 10, y1: 10, x2: 30, y2: 10, thicknessInches: 6 })]), 'ft');
  // 20 px per foot, 100 px padding: y=10 ft is 300 px, a 6" wall is 10 px wide.
  assert.ok(svg.includes('<polygon points="300,305 700,305 700,295 300,295"'), 'wall outline is 10 px wide and 400 px long');
});
