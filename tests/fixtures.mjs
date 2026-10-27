/**
 * Shared test fixtures: a 30' x 40' plot with nine rooms, an internal
 * staircase, walls generated from room edges, doors and windows.
 *
 * Footprint (setbacks W2 E2 N4 S4): x 2..28, y 4..36
 *
 *          x=2          17     22     28
 *   y=4    +------------+------+------+
 *          | Master Bed | Toil | Store|
 *   y=10   |            +------+      |
 *          |            | Pooja|      |
 *   y=16   +------------+------+------+
 *          | Living     |stair | Kitch|
 *   y=28   +------------+------+------+
 *          | Bedroom 3  | Bath | Util |
 *   y=36   +------------+------+------+
 */

import {
  createDefaultLayout,
  createRoom,
  createWall,
  createDoor,
  createWindow,
  createStaircase,
  createRoomBoundaryWalls,
  syncPlotDimensions,
  WALL_THICKNESS,
} from '../components/editor/layoutModel.js';

export function buildFixture() {
  const layout = createDefaultLayout({ siteWidth: 30, siteLength: 40, eastOpen: 2, westOpen: 2, northOpen: 4, southOpen: 4 });
  layout.id = 'fixture';

  const R = (id, name, x0, x1, y0, y1, extra = {}) => createRoom({ id, name, x: x0, y: y0, width: x1 - x0, length: y1 - y0, color: '#fff', ...extra });
  layout.rooms = [
    R('master', 'Master Bedroom', 2, 17, 4, 16),
    R('toilet', 'Toilet', 17, 22, 4, 10),
    R('pooja', 'Pooja Room', 17, 22, 10, 16),
    R('store', 'Store Room', 22, 28, 4, 16),
    R('living', 'Living Room', 2, 17, 16, 28),
    R('kitchen', 'Kitchen', 22, 28, 16, 28),
    R('bed3', 'Bedroom 3', 2, 17, 28, 36),
    R('bath', 'Bathroom', 17, 22, 28, 36),
    R('utility', 'Utility', 22, 28, 28, 36),
  ];

  layout.walls = [
    createWall({ id: 'ext-n', type: 'exterior', x1: 2, y1: 4, x2: 28, y2: 4, thickness: WALL_THICKNESS.EXTERIOR }),
    createWall({ id: 'ext-e', type: 'exterior', x1: 28, y1: 4, x2: 28, y2: 36, thickness: WALL_THICKNESS.EXTERIOR }),
    createWall({ id: 'ext-s', type: 'exterior', x1: 28, y1: 36, x2: 2, y2: 36, thickness: WALL_THICKNESS.EXTERIOR }),
    createWall({ id: 'ext-w', type: 'exterior', x1: 2, y1: 36, x2: 2, y2: 4, thickness: WALL_THICKNESS.EXTERIOR }),
  ];
  for (const r of layout.rooms) layout.walls = createRoomBoundaryWalls(layout, r);

  layout.staircases = [
    createStaircase({ id: 'stair', stairType: 'straight', x: 17.75, y: 16.1667, width: 3.5, risers: 15 }),
  ];

  layout.doors = [
    createDoor({ id: 'd-master', x: 9.5, y: 16, width: 2.8 }),
    createDoor({ id: 'd-toilet', x: 17, y: 7, width: 2.3 }),
    createDoor({ id: 'd-kitchen', x: 22, y: 22, width: 2.8 }),
    createDoor({ id: 'd-main', x: 9.5, y: 36, width: 3.5, isMain: true }),
  ];
  layout.windows = [
    createWindow({ id: 'w-master', x: 9.5, y: 4, width: 4 }),
    createWindow({ id: 'w-kitchen', x: 28, y: 22, width: 3.5 }),
  ];
  syncPlotDimensions(layout);
  return layout;
}

export const FIXED_ROOM_IDS = ['toilet', 'pooja', 'store', 'bath', 'utility'];
export const FLEX_ROOM_IDS = ['master', 'living', 'bed3', 'kitchen'];

export const byId = (list, id) => list.find((e) => e.id === id);
export const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

/** Pairs of rooms that share an edge segment, as "a|b|side" keys. */
export function sharedEdges(layout) {
  const out = new Set();
  const rooms = layout.rooms;
  const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.01;
  for (const a of rooms) {
    for (const b of rooms) {
      if (a.id >= b.id) continue;
      if (near(a.x + a.width, b.x) && ov(a.y, a.y + a.length, b.y, b.y + b.length)) out.add(`${a.id}|${b.id}|v`);
      if (near(b.x + b.width, a.x) && ov(a.y, a.y + a.length, b.y, b.y + b.length)) out.add(`${a.id}|${b.id}|v`);
      if (near(a.y + a.length, b.y) && ov(a.x, a.x + a.width, b.x, b.x + b.width)) out.add(`${a.id}|${b.id}|h`);
      if (near(b.y + b.length, a.y) && ov(a.x, a.x + a.width, b.x, b.x + b.width)) out.add(`${a.id}|${b.id}|h`);
    }
  }
  return out;
}

/** Pairs of wall endpoints that coincide, as "wallA.p|wallB.p" keys. */
export function wallJunctions(layout) {
  const pts = [];
  for (const w of layout.walls) pts.push([`${w.id}.1`, w.x1, w.y1], [`${w.id}.2`, w.x2, w.y2]);
  const out = new Set();
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (near(pts[i][1], pts[j][1], 0.01) && near(pts[i][2], pts[j][2], 0.01)) out.add(`${pts[i][0]}|${pts[j][0]}`);
    }
  }
  return out;
}

export function distanceToWall(o, w) {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const t = Math.max(0, Math.min(1, ((o.x - w.x1) * dx + (o.y - w.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(o.x - (w.x1 + t * dx), o.y - (w.y1 + t * dy));
}
