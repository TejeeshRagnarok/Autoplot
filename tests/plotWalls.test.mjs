import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySiteChange,
  cloneLayout,
  createColumn,
  createDefaultLayout,
  createWall,
  findElementsInPlotWalls,
  findPlotWallAt,
  getPlotInnerRect,
  getPlotRect,
  getPlotWallBorderStyle,
  getPlotWallData,
  getPlotWallPolygons,
  getPlotWallThicknesses,
  resizePlotBoundary,
  setPlotWallThickness,
} from '../components/editor/layoutModel.js';
import { selectionItems } from '../components/editor/selectionModel.js';
import { generateLayoutSVG } from '../components/editor/exportUtils.js';
import { HistoryManager } from '../components/editor/historyManager.js';
import { validateLayout } from '../components/editor/layoutValidation.js';
import { loadProject, normalizeLoadedLayout, saveProject } from '../components/editor/projectStorage.js';
import { buildFixture } from './fixtures.mjs';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const SIDES = ['north', 'south', 'east', 'west'];
const BUILDING = ['rooms', 'walls', 'doors', 'windows', 'staircases', 'columns', 'parking', 'utilities', 'annotations', 'cadEntities', 'dimensions', 'footprint'];

const set = (layout, side, inches) => {
  const res = setPlotWallThickness(layout, side, inches);
  assert.equal(res.reason, null);
  return res.layout;
};

function withThicknesses(layout, t) {
  let next = layout;
  for (const side of SIDES) next = set(next, side, t[side]);
  return next;
}

const EXAMPLE = { north: 8, south: 6, east: 4, west: 5 };

test('a new layout has all four plot walls, stored separately from building walls', () => {
  const layout = createDefaultLayout({ siteWidth: 30, siteLength: 40 });
  assert.deepEqual(layout.plot.boundaryWalls, { north: 6, south: 6, east: 6, west: 6 });
  assert.deepEqual(layout.walls, []);
});

for (const side of SIDES) {
  test(`${side}: changes alone, and the plot and building stay exactly as they were`, () => {
    const base = buildFixture();
    const next = set(base, side, 3);

    for (const other of SIDES) {
      assert.equal(getPlotWallThicknesses(next)[other], other === side ? 3 : 6, other);
    }
    assert.deepEqual(getPlotRect(next), getPlotRect(base));
    for (const key of BUILDING) assert.equal(next[key], base[key], `${key} is carried over untouched`);
    assert.deepEqual(next.plot.setbacks, base.plot.setbacks);
  });
}

test('the example of different thicknesses on each side coexists', () => {
  const next = withThicknesses(buildFixture(), EXAMPLE);
  assert.deepEqual(next.plot.boundaryWalls, EXAMPLE);
});

test('thickness converts from inches to world units on the inner face, outer face fixed', () => {
  const next = withThicknesses(buildFixture(), EXAMPLE);
  const outer = getPlotRect(next);
  const inner = getPlotInnerRect(next);

  assert.equal(outer.x0, 0);
  assert.equal(outer.y0, 0);
  assert.equal(outer.width, 30);
  assert.equal(outer.length, 40);
  assert.ok(near(inner.y0, 8 / 12));
  assert.ok(near(inner.y1, 40 - 6 / 12));
  assert.ok(near(inner.x1, 30 - 4 / 12));
  assert.ok(near(inner.x0, 5 / 12));
});

test('all four corners meet exactly, sharing the outer and inner corner points', () => {
  const p = getPlotWallPolygons(withThicknesses(buildFixture(), EXAMPLE));
  const has = (polygon, pt) => polygon.some((q) => near(q.x, pt.x) && near(q.y, pt.y));
  const corners = [['north', 'west'], ['north', 'east'], ['south', 'west'], ['south', 'east']];
  for (const [a, b] of corners) {
    const shared = p[a].filter((pt) => has(p[b], pt));
    assert.equal(shared.length, 2, `${a}/${b} share their mitre line`);
  }
});

test('the four walls fill the band between the faces exactly: no gap, no overlap', () => {
  const layout = withThicknesses(buildFixture(), EXAMPLE);
  const area = (poly) => Math.abs(poly.reduce((s, a, i) => {
    const b = poly[(i + 1) % poly.length];
    return s + a.x * b.y - b.x * a.y;
  }, 0)) / 2;
  const inner = getPlotInnerRect(layout);
  const expected = 30 * 40 - inner.width * inner.length;
  const total = Object.values(getPlotWallPolygons(layout)).reduce((s, poly) => s + area(poly), 0);
  assert.ok(near(total, expected, 1e-6), `${total} vs ${expected}`);
});

test('corners follow a moved plot origin', () => {
  const moved = resizePlotBoundary(buildFixture(), { width: 36, length: 46, edge: 'corner-nw' }).nextLayout;
  const p = getPlotWallPolygons(moved);
  assert.deepEqual(p.north[0], { x: -6, y: -6 });
  assert.deepEqual(p.south[2], { x: 30, y: 40 });
  assert.ok(near(getPlotInnerRect(moved).x0, -6 + 0.5));
});

test('clicking inside each wall finds it, at any thickness', () => {
  const layout = withThicknesses(buildFixture(), { north: 8, south: 2, east: 3, west: 5 });
  assert.equal(findPlotWallAt(layout, 15, 0.3), 'north');
  assert.equal(findPlotWallAt(layout, 15, 40 - 0.1), 'south');
  assert.equal(findPlotWallAt(layout, 30 - 0.1, 20), 'east');
  assert.equal(findPlotWallAt(layout, 0.3, 20), 'west');
});

test('points away from the walls find nothing', () => {
  const layout = buildFixture();
  assert.equal(findPlotWallAt(layout, 15, 20), null);
  assert.equal(findPlotWallAt(layout, 15, 0.6), null, 'just inside the inner face');
  assert.equal(findPlotWallAt(layout, -3, 20), null, 'outside the plot');
});

test('the pick tolerance keeps a thin wall clickable just outside its faces', () => {
  const layout = set(buildFixture(), 'west', 2);
  assert.equal(findPlotWallAt(layout, -0.2, 20), null);
  assert.equal(findPlotWallAt(layout, -0.2, 20, 0.3), 'west');
  assert.equal(findPlotWallAt(layout, 2 / 12 + 0.2, 20, 0.3), 'west');
});

test('a corner click follows the drawn diagonal', () => {
  const layout = withThicknesses(buildFixture(), { north: 8, south: 6, east: 6, west: 2 });
  // Inside the corner square: 2" west wall, 8" north wall.
  assert.equal(findPlotWallAt(layout, 0.05, 0.4), 'west');
  assert.equal(findPlotWallAt(layout, 0.15, 0.1), 'north');
});

test('selection data reports the wall, and plot walls are never delete or copy targets', () => {
  const layout = set(buildFixture(), 'east', 7);
  const data = getPlotWallData(layout, 'east');
  assert.deepEqual(data, { id: 'plot-wall-east', side: 'east', thicknessInches: 7 });
  assert.deepEqual(selectionItems({ type: 'plotWall', data }), []);
});

test('an unchanged value is a no-op, so it adds no undo step', () => {
  const layout = buildFixture();
  assert.equal(set(layout, 'north', 6), layout);
});

test('bad input is refused and changes nothing', () => {
  const layout = buildFixture();
  for (const [side, inches] of [['north', 9], ['north', '6'], ['north', 0], ['up', 4]]) {
    const res = setPlotWallThickness(layout, side, inches);
    assert.equal(res.layout, layout);
    assert.ok(res.reason, `${side} ${inches}`);
  }
});

test('an object crossing the inner face is reported, and is not moved', () => {
  const base = buildFixture();
  base.columns = [createColumn({ id: 'near-edge', x: 15, y: 0.5, size: 0.1 })];
  assert.deepEqual(findElementsInPlotWalls(base), [], '6" wall stops at y=0.5: no real crossing');

  const res = setPlotWallThickness(base, 'north', 8);
  assert.deepEqual(res.overlapping.map((o) => o.id), ['near-edge']);
  assert.equal(res.layout.columns, base.columns);
  const issues = validateLayout(res.layout).filter((i) => i.title === 'Object Overlaps Plot Wall');
  assert.deepEqual(issues.map((i) => i.elementId), ['near-edge']);
});

test('the fixture building has no false overlap warnings at 8 inches on every side', () => {
  const next = withThicknesses(buildFixture(), { north: 8, south: 8, east: 8, west: 8 });
  assert.deepEqual(findElementsInPlotWalls(next), []);
});

test('an object already beyond the plot is reported as outside, not as overlapping', () => {
  const base = buildFixture();
  base.walls = [...base.walls, createWall({ id: 'far', x1: -5, y1: 5, x2: -2, y2: 5 })];
  assert.ok(!findElementsInPlotWalls(base).some((o) => o.id === 'far'));
});

test('undo and redo restore the correct walls, one change per step', () => {
  const base = buildFixture();
  const history = new HistoryManager(base);
  const a = set(base, 'north', 8);
  history.pushState(a);
  const b = set(a, 'west', 2);
  history.pushState(b);

  const undo1 = history.undo();
  assert.deepEqual(getPlotWallThicknesses(undo1), { north: 8, south: 6, east: 6, west: 6 });
  const undo2 = history.undo();
  assert.deepEqual(getPlotWallThicknesses(undo2), { north: 6, south: 6, east: 6, west: 6 });
  assert.equal(history.canUndo(), false);
  const redo1 = history.redo();
  assert.deepEqual(getPlotWallThicknesses(redo1), { north: 8, south: 6, east: 6, west: 6 });
  const redo2 = history.redo();
  assert.deepEqual(getPlotWallThicknesses(redo2), { north: 8, south: 6, east: 6, west: 2 });
});

test('save and reopen preserves each side as a number', async () => {
  const store = new Map();
  globalThis.window = {
    localStorage: { setItem: (k, v) => store.set(k, v), getItem: (k) => (store.has(k) ? store.get(k) : null) },
  };
  try {
    const { id, ...fixture } = buildFixture();
    const before = JSON.stringify(BUILDING.map((k) => fixture[k]));
    const next = withThicknesses(fixture, EXAMPLE);
    assert.equal(await saveProject(next), true);
    const reopened = loadProject();
    assert.deepEqual(reopened.plot.boundaryWalls, EXAMPLE);
    assert.equal(JSON.stringify(BUILDING.map((k) => reopened[k])), before);
  } finally {
    delete globalThis.window;
  }
});

test('an older project with no plot walls opens with the defaults and the same geometry', () => {
  const old = cloneLayout(buildFixture());
  delete old.plot.boundaryWalls;
  assert.deepEqual(getPlotWallThicknesses(old), { north: 6, south: 6, east: 6, west: 6 });
  const loaded = normalizeLoadedLayout(old);
  assert.deepEqual(loaded.plot.boundaryWalls, { north: 6, south: 6, east: 6, west: 6 });
  assert.equal(loaded.plot.width, old.plot.width);
});

test('editing a plot wall on an older project stores all four sides', () => {
  const old = cloneLayout(buildFixture());
  delete old.plot.boundaryWalls;
  assert.deepEqual(set(old, 'south', 3).plot.boundaryWalls, { north: 6, south: 3, east: 6, west: 6 });
});

test('plot-only resizing keeps the thicknesses and the building', () => {
  const base = withThicknesses(buildFixture(), EXAMPLE);
  const next = resizePlotBoundary(base, { width: 40, edge: 'left' }).nextLayout;
  assert.deepEqual(next.plot.boundaryWalls, EXAMPLE);
  assert.equal(next.rooms, base.rooms);
  assert.equal(next.plot.width, 40);
  const inner = getPlotInnerRect(next);
  assert.ok(near(inner.x0, -10 + 5 / 12));
});

test('a setback reflow keeps the plot walls', () => {
  const base = withThicknesses(buildFixture(), EXAMPLE);
  const res = applySiteChange(base, { setbacks: { north: 5 } });
  assert.deepEqual(res.nextLayout.plot.boundaryWalls, EXAMPLE);
});

test('the 2D plan and report style converts each side from inches at the given scale', () => {
  const layout = withThicknesses(buildFixture(), EXAMPLE);
  assert.deepEqual(getPlotWallBorderStyle(layout, 12), {
    borderTopWidth: 8,
    borderBottomWidth: 6,
    borderRightWidth: 4,
    borderLeftWidth: 5,
    borderColor: '#64748B',
  });
});

test('screens with no layout yet draw the default walls rather than failing', () => {
  assert.equal(getPlotWallBorderStyle(null, 12).borderTopWidth, 6);
  assert.deepEqual(getPlotWallThicknesses(undefined), { north: 6, south: 6, east: 6, west: 6 });
});

test('plot walls appear in the SVG export at their real positions', () => {
  const layout = withThicknesses(buildFixture(), { north: 6, south: 6, east: 6, west: 6 });
  const svg = generateLayoutSVG(layout, 'ft');
  // 20 px per foot, 100 px padding: a 6" north wall runs from y=100 to y=110.
  assert.ok(svg.includes('<polygon data-plot-wall="north" points="100,100 700,100 690,110 110,110" fill="#64748B"/>'));
});
