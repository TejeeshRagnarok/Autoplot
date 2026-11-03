import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySiteChange,
  cloneLayout,
  createAnnotation,
  createColumn,
  createDimension,
  createParking,
  describeOutsidePlot,
  findElementsOutsidePlot,
  getPlotAndBuildableBounds,
  getPlotRect,
  resizePlot,
  resizePlotBoundary,
} from '../components/editor/layoutModel.js';
import { HistoryManager } from '../components/editor/historyManager.js';
import { validateLayout } from '../components/editor/layoutValidation.js';
import { moveRoom } from '../components/editor/roomResize.js';
import { generateLayoutSVG } from '../components/editor/exportUtils.js';
import { loadProject, saveProject } from '../components/editor/projectStorage.js';
import { generateStructuredLayoutFromState, getSourceKey, syncLayoutToState } from '../components/editor/layoutBridge.js';
import { generateBuildingSize } from '../constants/vastuData.js';
import { buildFixture } from './fixtures.mjs';

const BUILDING_LISTS = ['rooms', 'walls', 'doors', 'windows', 'staircases', 'columns', 'parking', 'utilities', 'annotations', 'cadEntities'];

/** Everything that must survive a plot resize, byte for byte. */
function buildingGeometry(layout) {
  const snapshot = {};
  for (const key of BUILDING_LISTS) snapshot[key] = layout[key];
  snapshot.internalDimensions = (layout.dimensions || []).filter((d) => d.id !== 'dim-plot-width' && d.id !== 'dim-plot-length');
  snapshot.footprint = layout.footprint;
  snapshot.setbacks = layout.plot.setbacks;
  return JSON.parse(JSON.stringify(snapshot));
}

/** The fixture plus one of each remaining object type and an internal dimension. */
function fullLayout() {
  const layout = buildFixture();
  layout.columns = [createColumn({ id: 'col', x: 2, y: 4 })];
  layout.parking = [createParking({ id: 'park', x: 3, y: 37, width: 9, length: 2 })];
  layout.annotations = [createAnnotation({ id: 'note', x: 5, y: 5, text: 'Note' })];
  layout.dimensions.push(createDimension({ id: 'dim-internal', x1: 2, y1: 4, x2: 17, y2: 4, offset: 1 }));
  layout.cadEntities = [{ id: 'line', kind: 'line', x1: 3, y1: 5, x2: 8, y2: 5 }];
  return layout;
}

const resized = (layout, change) => {
  const res = resizePlotBoundary(layout, change);
  assert.equal(res.success, true);
  return res.nextLayout;
};

test('exact example: 54 x 49 to length 55, then width 60, leaves the building unchanged', () => {
  const base = fullLayout();
  base.plot.width = 54;
  base.plot.length = 49;
  const before = buildingGeometry(base);

  const a = resized(base, { length: 55 });
  assert.equal(a.plot.width, 54);
  assert.equal(a.plot.length, 55);
  assert.equal(a.plot.width * a.plot.length, 2970);
  assert.deepEqual(buildingGeometry(a), before);

  const b = resized(a, { width: 60 });
  assert.equal(b.plot.width, 60);
  assert.equal(b.plot.length, 55);
  assert.equal(b.plot.width * b.plot.length, 3300);
  assert.deepEqual(buildingGeometry(b), before);
});

const EDGE_CASES = [
  ['increase length (south)', { length: 46, edge: 'bottom' }, { x0: 0, y0: 0, x1: 30, y1: 46 }],
  ['decrease length (south)', { length: 37, edge: 'bottom' }, { x0: 0, y0: 0, x1: 30, y1: 37 }],
  ['increase width (east)', { width: 36, edge: 'right' }, { x0: 0, y0: 0, x1: 36, y1: 40 }],
  ['decrease width (east)', { width: 29, edge: 'right' }, { x0: 0, y0: 0, x1: 29, y1: 40 }],
  ['grow west edge', { width: 36, edge: 'left' }, { x0: -6, y0: 0, x1: 30, y1: 40 }],
  ['shrink west edge', { width: 29, edge: 'left' }, { x0: 1, y0: 0, x1: 30, y1: 40 }],
  ['grow north edge', { length: 46, edge: 'top' }, { x0: 0, y0: -6, x1: 30, y1: 40 }],
  ['shrink north edge', { length: 37, edge: 'top' }, { x0: 0, y0: 3, x1: 30, y1: 40 }],
  ['north-west corner', { width: 34, length: 44, edge: 'corner-nw' }, { x0: -4, y0: -4, x1: 30, y1: 40 }],
  ['north-east corner', { width: 34, length: 44, edge: 'corner-ne' }, { x0: 0, y0: -4, x1: 34, y1: 40 }],
  ['south-west corner', { width: 34, length: 44, edge: 'corner-sw' }, { x0: -4, y0: 0, x1: 30, y1: 44 }],
  ['south-east corner', { width: 34, length: 44, edge: 'corner-se' }, { x0: 0, y0: 0, x1: 34, y1: 44 }],
  ['symmetric', { width: 34, length: 44, edge: 'symmetric' }, { x0: -2, y0: -2, x1: 32, y1: 42 }],
  ['numeric width with the default edge', { width: 33 }, { x0: 0, y0: 0, x1: 33, y1: 40 }],
  ['numeric length with the default edge', { length: 45 }, { x0: 0, y0: 0, x1: 30, y1: 45 }],
];

for (const [name, change, expected] of EDGE_CASES) {
  test(`${name}: only the expected edges move and the building is unchanged`, () => {
    const base = fullLayout();
    const before = buildingGeometry(base);
    const baseJson = JSON.stringify(base);

    const next = resized(base, change);
    const rect = getPlotRect(next);

    assert.deepEqual({ x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }, expected);
    assert.deepEqual(buildingGeometry(next), before);
    for (const key of BUILDING_LISTS) assert.equal(next[key], base[key], `${key} is carried over untouched`);
    assert.equal(JSON.stringify(base), baseJson, 'input layout is not mutated');
  });
}

test('rooms and staircase keep every property through repeated resizes on all edges', () => {
  const base = fullLayout();
  const before = buildingGeometry(base);
  assert.ok(base.rooms.length > 0 && base.staircases.length > 0);

  let current = base;
  for (const change of [{ width: 40, edge: 'left' }, { length: 50, edge: 'top' }, { width: 35, edge: 'right' }, { length: 42, edge: 'bottom' }]) {
    current = resized(current, change);
    assert.deepEqual(buildingGeometry(current), before);
  }
});

test('outer dimension annotations follow the moved boundary', () => {
  const next = resized(fullLayout(), { width: 36, length: 46, edge: 'corner-nw' });
  const width = next.dimensions.find((d) => d.id === 'dim-plot-width');
  const length = next.dimensions.find((d) => d.id === 'dim-plot-length');

  assert.equal(width.x1, -6);
  assert.equal(width.x2, 30);
  assert.equal(width.value, 36);
  assert.equal(width.y1, -6 - width.offset);
  assert.equal(length.y1, -6);
  assert.equal(length.y2, 40);
  assert.equal(length.value, 46);
});

test('invalid values are rejected and leave the layout alone', () => {
  const base = fullLayout();
  for (const change of [{ width: 'abc' }, { width: Number.NaN }, { length: 2 }, { width: -10 }]) {
    const res = resizePlotBoundary(base, change);
    assert.equal(res.success, false);
    assert.equal(res.nextLayout, base);
    assert.ok(res.reason);
  }
});

test('an unchanged size is a no-op, so it adds no undo step', () => {
  const base = fullLayout();
  assert.equal(resized(base, { width: 30, length: 40, edge: 'left' }), base);
});

test('growing then shrinking back restores the original plot exactly', () => {
  const base = fullLayout();
  const grown = resized(base, { width: 36, edge: 'left' });
  const back = resized(grown, { width: 30, edge: 'left' });
  assert.deepEqual(back.plot, base.plot);
});

test('shrinking past the building warns and names the objects without moving them', () => {
  const base = fullLayout();
  const before = buildingGeometry(base);

  const res = resizePlotBoundary(base, { width: 20, edge: 'right' });
  assert.equal(res.success, true);
  assert.equal(res.nextLayout.plot.width, 20);
  assert.deepEqual(buildingGeometry(res.nextLayout), before);

  const names = res.outside.map((o) => o.name);
  for (const name of ['Store Room', 'Kitchen', 'Wall', 'Window']) assert.ok(names.includes(name), `${name} is reported`);
  assert.ok(!names.includes('Note'), 'objects still inside are not reported');
  assert.match(describeOutsidePlot(res.outside), /beyond the plot: .*Store Room/);

  const issues = validateLayout(res.nextLayout).filter((i) => i.title === 'Object Outside Plot Boundary');
  assert.ok(issues.some((i) => i.elementId === 'store'));
});

test('the west and north edges are checked too, and all object types are found', () => {
  const next = resized(fullLayout(), { width: 22, length: 30, edge: 'corner-nw' });
  const types = new Set(findElementsOutsidePlot(next).map((o) => o.type));
  for (const type of ['room', 'wall', 'door', 'window', 'column', 'annotation', 'entity']) {
    assert.ok(types.has(type), `${type} is reported`);
  }
});

test('nothing is reported as outside after growing, including on the west edge', () => {
  const next = resized(fullLayout(), { width: 40, length: 50, edge: 'corner-nw' });
  assert.deepEqual(findElementsOutsidePlot(next), []);
});

test('undo and redo treat a resize as one step and restore only the site', () => {
  const base = fullLayout();
  const before = buildingGeometry(base);
  const history = new HistoryManager(base);

  const next = resized(base, { width: 36, edge: 'left' });
  history.pushState(next);

  const undone = history.undo();
  assert.equal(undone.plot.width, 30);
  assert.equal(getPlotRect(undone).x0, 0);
  assert.deepEqual(buildingGeometry(undone), before);
  assert.equal(history.canUndo(), false);

  const redone = history.redo();
  assert.equal(redone.plot.width, 36);
  assert.equal(getPlotRect(redone).x0, -6);
  assert.deepEqual(buildingGeometry(redone), before);
});

test('a whole boundary drag is one undo step', () => {
  const base = fullLayout();
  const history = new HistoryManager(base);
  const snapshot = cloneLayout(base);

  history.beginDrag();
  for (const width of [31, 33, 35, 36]) history.updateDuringDrag(resized(snapshot, { width, edge: 'left' }));
  history.endDrag(history.getCurrent());

  assert.equal(history.getCurrent().plot.width, 36);
  const undone = history.undo();
  assert.equal(undone.plot.width, 30);
  assert.equal(history.canUndo(), false);
});

test('save and reopen keeps the plot, its origin, and the building', async () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      setItem: (k, v) => store.set(k, v),
      getItem: (k) => (store.has(k) ? store.get(k) : null),
    },
  };
  try {
    // Same layout shape and load call as the app: a generated layout, loadProject() with no id.
    const base = generateStructuredLayoutFromState(baseState());
    const before = buildingGeometry(base);
    const next = resized(base, { width: 36, length: 46, edge: 'corner-nw' });

    assert.equal(await saveProject(next), true);
    const reopened = loadProject();
    assert.ok(reopened, 'the saved project is found under the id the app loads');
    assert.equal(reopened.plot.width, 36);
    assert.equal(reopened.plot.length, 46);
    assert.deepEqual(getPlotRect(reopened), getPlotRect(next));
    assert.deepEqual(buildingGeometry(reopened), before);
  } finally {
    delete globalThis.window;
  }
});

test('room editing works in the space gained on the west edge', () => {
  const next = resized(fullLayout(), { width: 36, edge: 'left' });
  const room = next.rooms.find((r) => r.id === 'master');
  assert.equal(room.x, 2);

  const moved = moveRoom(next, 'master', -5, 0);
  assert.equal(moved.layout.rooms.find((r) => r.id === 'master').x, -3);

  const clamped = moveRoom(next, 'master', -100, 0);
  assert.equal(clamped.layout.rooms.find((r) => r.id === 'master').x, -6, 'stops at the moved boundary');
});

test('the buildable area follows the moved boundary', () => {
  const next = resized(buildFixture(), { width: 36, edge: 'left' });
  const { buildable } = getPlotAndBuildableBounds(next);
  assert.equal(buildable.minX, -4);
  assert.equal(buildable.maxX, 28);
  assert.equal(buildable.width, 32);
});

test('resizePlot is plot-only too', () => {
  const base = fullLayout();
  const next = resizePlot(base, 'width', 36);
  assert.equal(next.plot.width, 36);
  assert.deepEqual(buildingGeometry(next), buildingGeometry(base));
});

test('a setback change still reflows, and keeps the moved plot origin', () => {
  const next = resized(buildFixture(), { width: 30, length: 46, edge: 'top' });
  const res = applySiteChange(next, { setbacks: { north: 5 } });
  assert.equal(getPlotRect(res.nextLayout).y0, -6);
  assert.equal(res.nextLayout.plot.setbacks.north, 5);
  assert.equal(res.nextLayout.plot.length, 46);
});

test('SVG export draws the plot and building in the right relative positions', () => {
  const next = resized(buildFixture(), { width: 36, edge: 'left' });
  const svg = generateLayoutSVG(next, 'ft');
  // Plot corner at the 100 px padding; world x=2 sits 8 ft (160 px) inside it at 20 px/ft.
  assert.match(svg, /<rect x="100" y="100" width="720" height="800"/);
  const master = next.rooms.find((r) => r.id === 'master');
  assert.ok(svg.includes(`<rect x="${100 + (master.x + 6) * 20}" y="${100 + master.y * 20}"`));
});

// ---- Leaving the editor: the 2D plan and reports derive the building from state ----

const baseState = () => ({
  siteLength: '40', siteWidth: '30', eastOpen: '2', westOpen: '2', northOpen: '4', southOpen: '4',
  siteFacing: 'North', roadDirection: 'North Road', mainDoorDirection: 'North', compassAngle: '0',
  ownerName: 'Test', stairsLocation: 'Southwest',
  customRooms: [{ id: '1', name: 'Kitchen', length: '10', width: '8' }, { id: '2', name: 'Master Bedroom', length: '12', width: '9' }],
});

for (const [name, change] of [
  ['east', { width: 40, edge: 'right' }],
  ['west', { width: 40, edge: 'left' }],
  ['north', { length: 55, edge: 'top' }],
  ['south', { length: 55, edge: 'bottom' }],
]) {
  test(`after closing the editor, the reported building size survives a ${name} resize`, () => {
    const state = baseState();
    const size = generateBuildingSize(state.siteLength, state.siteWidth, state.eastOpen, state.westOpen, state.northOpen, state.southOpen);

    const layout = resized(generateStructuredLayoutFromState(state), change);
    const next = syncLayoutToState(layout, state);
    const after = generateBuildingSize(next.siteLength, next.siteWidth, next.eastOpen, next.westOpen, next.northOpen, next.southOpen);

    assert.equal(next.siteWidth, String(layout.plot.width));
    assert.equal(next.siteLength, String(layout.plot.length));
    assert.equal(Number(after.width), Number(size.width));
    assert.equal(Number(after.length), Number(size.length));
  });
}

test('the extra area is reported on the side that moved', () => {
  const state = baseState();
  const layout = resized(generateStructuredLayoutFromState(state), { width: 40, edge: 'left' });
  const next = syncLayoutToState(layout, state);
  assert.equal(next.westOpen, '12');
  assert.equal(next.eastOpen, '2');
});

test('closing the editor with no plot change leaves the open space values as entered', () => {
  const state = baseState();
  const next = syncLayoutToState(generateStructuredLayoutFromState(state), state);
  for (const key of ['eastOpen', 'westOpen', 'northOpen', 'southOpen']) assert.equal(next[key], state[key]);
});

test('getSourceKey ignores the stored layout', () => {
  const state = baseState();
  assert.equal(getSourceKey({ ...state, lastEditedLayout: { any: 'thing' } }), getSourceKey(state));
  assert.equal(generateStructuredLayoutFromState(state).sourceKey, getSourceKey(state));
});
