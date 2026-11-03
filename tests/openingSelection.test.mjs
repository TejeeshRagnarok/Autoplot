import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultLayout, createDoor, createRoom, createWall, createWindow } from '../components/editor/layoutModel.js';
import { hitTestAll } from '../components/editor/selectionModel.js';
import { getOpeningGeometry, moveOpening, placeOpeningOnWall } from '../components/editor/wallOps.js';

const SCALE = 12; // px per ft, as in the editor at its default fit

function roomWithDoor(extra = {}) {
  const layout = createDefaultLayout({ siteWidth: 60, siteLength: 60 });
  layout.rooms = [createRoom({ id: 'room', name: 'Room', x: 10, y: 10, width: 20, length: 20 })];
  layout.walls = [createWall({ id: 'w', x1: 10, y1: 10, x2: 30, y2: 10 })];
  layout.doors = [createDoor({ id: 'door', x: 20, y: 10, width: 3, wallId: 'w', hinge: 'left', swing: 'inward', ...extra })];
  layout.windows = [];
  return layout;
}

const topHit = (layout, x, y) => hitTestAll(layout, x, y, SCALE)[0];

test('clicking the door in the wall gap selects it', () => {
  assert.equal(topHit(roomWithDoor(), 20, 10).type, 'door');
});

test('clicking the drawn leaf selects the door, not the room behind it', () => {
  const layout = roomWithDoor();
  const { hinge, tip } = getOpeningGeometry(layout.doors[0], layout.walls).leaves[0];
  const hit = topHit(layout, (hinge.x + tip.x) / 2, (hinge.y + tip.y) / 2);
  assert.equal(hit.type, 'door');
  assert.equal(hit.data.id, 'door');
});

test('clicking the swing arc selects the door, not the room behind it', () => {
  const layout = roomWithDoor();
  const { hinge, tip, free, radius } = getOpeningGeometry(layout.doors[0], layout.walls).leaves[0];
  const ux = (tip.x - hinge.x) / radius + (free.x - hinge.x) / radius;
  const uy = (tip.y - hinge.y) / radius + (free.y - hinge.y) / radius;
  const n = Math.hypot(ux, uy);
  assert.equal(topHit(layout, hinge.x + (ux / n) * radius, hinge.y + (uy / n) * radius).type, 'door');
});

test('the room is still selected away from the swing, including inside the arc', () => {
  const layout = roomWithDoor();
  assert.equal(topHit(layout, 25, 25).type, 'room');
  const { hinge, tip, free, radius } = getOpeningGeometry(layout.doors[0], layout.walls).leaves[0];
  const ux = (tip.x - hinge.x) / radius + (free.x - hinge.x) / radius;
  const uy = (tip.y - hinge.y) / radius + (free.y - hinge.y) / radius;
  const n = Math.hypot(ux, uy);
  assert.equal(topHit(layout, hinge.x + (ux / n) * radius * 0.5, hinge.y + (uy / n) * radius * 0.5).type, 'room');
});

test('the circle continued past the door swing does not count', () => {
  const layout = roomWithDoor();
  const { hinge, tip, radius } = getOpeningGeometry(layout.doors[0], layout.walls).leaves[0];
  // Opposite the open leaf, on the same radius: outside the drawn quarter.
  const x = hinge.x - (tip.x - hinge.x);
  const y = hinge.y - (tip.y - hinge.y);
  assert.equal(Math.hypot(x - hinge.x, y - hinge.y), radius);
  assert.notEqual(hitTestAll(layout, x, y, SCALE).find((h) => h.type === 'door')?.data.id, 'door');
});

test('a sliding door has no swing, so only its wall gap selects it', () => {
  const layout = roomWithDoor({ type: 'sliding' });
  assert.equal(topHit(layout, 20, 10).type, 'door');
  assert.equal(topHit(layout, 18.5, 11.5).type, 'room');
});

test('both openings at one spot are reachable, for cycling between them', () => {
  const layout = roomWithDoor();
  layout.windows = [createWindow({ id: 'win', x: 20, y: 10, width: 4, wallId: 'w' })];
  const types = hitTestAll(layout, 20, 10, SCALE).map((h) => h.type);
  assert.ok(types.includes('door') && types.includes('window'));
});

test('a door stacked on a window can be dragged out along the wall', () => {
  const layout = roomWithDoor();
  layout.windows = [createWindow({ id: 'win', x: 20, y: 10, width: 4, wallId: 'w' })];
  const res = moveOpening(layout, 'door', 'door', { x: 22, y: 10 });
  assert.equal(res.moved, true);
  const door = res.layout.doors[0];
  assert.deepEqual([door.x, door.y, door.wallId], [22, 10, 'w']);
  assert.equal(res.layout.windows[0].x, 20, 'the window stays put');
});

test('a window stacked on a door can be dragged out too', () => {
  const layout = roomWithDoor();
  layout.windows = [createWindow({ id: 'win', x: 20, y: 10, width: 4, wallId: 'w' })];
  const res = moveOpening(layout, 'window', 'win', { x: 15, y: 10 });
  assert.equal(res.layout.windows[0].x, 15);
});

test('an opening it did not start on still blocks it', () => {
  const layout = roomWithDoor();
  layout.windows = [createWindow({ id: 'win', x: 25, y: 10, width: 4, wallId: 'w' })];
  const door = moveOpening(layout, 'door', 'door', { x: 25, y: 10 }).layout.doors[0];
  assert.ok(door.x + 1.5 <= 25 - 2 || door.x - 1.5 >= 25 + 2, `door at ${door.x} stays clear of the window`);
});

test('a drag waits rather than jumping to another wall when the nearest has no room', () => {
  const layout = roomWithDoor();
  layout.walls.push(createWall({ id: 'short', x1: 10, y1: 12, x2: 11, y2: 12 }));
  layout.walls.push(createWall({ id: 'other', x1: 10, y1: 12.5, x2: 30, y2: 12.5 }));
  const point = { x: 10.5, y: 12 };
  // The nearest wall is too short for a 3' door.
  const res = moveOpening(layout, 'door', 'door', point, { maxDist: 3, nearestOnly: true });
  assert.equal(res.moved, false);
  assert.equal(res.layout.doors[0].wallId, 'w');
});

test('a drag stays on its own wall when a nearly identical wall sits right beside it', () => {
  const layout = roomWithDoor({ y: 10, x: 20 });
  layout.walls.push(createWall({ id: 'twin', x1: 19, y1: 10.01, x2: 22, y2: 10.01 }));
  // A pointer snapped to y=10.05 is nearer the short twin than the door's own wall.
  const res = moveOpening(layout, 'door', 'door', { x: 14, y: 10.05 }, { maxDist: 3, nearestOnly: true });
  const door = res.layout.doors[0];
  assert.deepEqual([door.wallId, door.x, door.y], ['w', 14, 10]);
});

test('a drag does change wall once the pointer is clearly on another one', () => {
  const layout = roomWithDoor();
  layout.walls.push(createWall({ id: 'other', x1: 10, y1: 12, x2: 30, y2: 12 }));
  const door = moveOpening(layout, 'door', 'door', { x: 20, y: 12 }, { maxDist: 3, nearestOnly: true }).layout.doors[0];
  assert.deepEqual([door.wallId, door.y], ['other', 12]);
});

test('placing a new opening may still fall back to the next wall', () => {
  const layout = roomWithDoor();
  layout.walls.push(createWall({ id: 'short', x1: 10, y1: 12, x2: 11, y2: 12 }));
  layout.walls.push(createWall({ id: 'other', x1: 10, y1: 12.5, x2: 30, y2: 12.5 }));
  const proto = createDoor({ id: 'new', width: 3 });
  assert.equal(placeOpeningOnWall(layout, proto, { x: 10.5, y: 12 }, { maxDist: 3 }).wallId, 'other');
});
