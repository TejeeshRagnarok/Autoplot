/**
 * AutoPlot Architectural Layout Data Model & Geometry Utilities
 * Complete 2D structured object representation of a building layout.
 */

import { entityBounds } from './cadGeometry.js';
import {
  DEFAULT_PLOT_WALL_THICKNESS_IN,
  PLOT_WALL_SIDES,
  findPlotWallAt,
  getPlotInnerRect,
  getPlotRect,
  getPlotWallBorderStyle,
  getPlotWallData,
  getPlotWallPolygons,
  getPlotWallThicknesses,
} from './siteGeometry.js';

export {
  DEFAULT_PLOT_WALL_THICKNESS_IN,
  PLOT_WALL_SIDES,
  findPlotWallAt,
  getPlotInnerRect,
  getPlotRect,
  getPlotWallBorderStyle,
  getPlotWallData,
  getPlotWallPolygons,
  getPlotWallThicknesses,
};

let idCounter = 1000;
export function generateUniqueId(prefix = 'elem') {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}-${idCounter}`;
}

export const ELEMENT_TYPES = {
  PLOT: 'plot',
  WALL: 'wall',
  ROOM: 'room',
  DOOR: 'door',
  WINDOW: 'window',
  STAIR: 'staircase',
  COLUMN: 'column',
  PARKING: 'parking',
  UTILITY: 'utility',
  DIMENSION: 'dimension',
  ANNOTATION: 'annotation',
};

export const WALL_THICKNESS = {
  EXTERIOR: 0.75, // 9 inches in feet
  INTERIOR: 0.375, // 4.5 inches in feet
  PARTITION: 0.25, // 3 inches in feet
};

// Thicknesses offered when drawing or editing a wall, in inches.
export const WALL_THICKNESS_OPTIONS = [2, 3, 4, 5, 6, 7, 8];
export const DEFAULT_WALL_THICKNESS_IN = 6;

export const inchesToFeet = (inches) => Number(inches) / 12;
export const feetToInches = (feet) => Math.round(Number(feet) * 12 * 100) / 100;

/** A wall's thickness in inches; older walls only stored it in feet. */
export function getWallThicknessInches(wall) {
  const stored = Number(wall?.thicknessInches);
  return Number.isFinite(stored) && stored > 0 ? stored : feetToInches(wall?.thickness);
}

export const ROOM_PALETTE = [
  '#F0FDF4', // Soft mint / sage
  '#EFF6FF', // Soft sky blue
  '#FFFBEB', // Warm ivory amber
  '#FDF2F8', // Soft rose pink
  '#F5F3FF', // Soft lavender
  '#F8FAFC', // Crisp white slate
  '#FFF7ED', // Soft peach
  '#ECFDF5', // Soft emerald
];

/**
 * Creates a clean default layout
 */
export function createDefaultLayout(siteParams = {}) {
  const siteW = parseFloat(siteParams.siteWidth) || 30;
  const siteL = parseFloat(siteParams.siteLength) || 40;
  const eastO = parseFloat(siteParams.eastOpen) || 2;
  const westO = parseFloat(siteParams.westOpen) || 2;
  const northO = parseFloat(siteParams.northOpen) || 4;
  const southO = parseFloat(siteParams.southOpen) || 4;

  return {
    version: '2.0.0',
    title: siteParams.title || `${siteParams.ownerName ? `${siteParams.ownerName}'s Residence` : 'AutoPlot Residence'}`,
    ownerName: siteParams.ownerName || 'Client',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plot: {
      id: 'plot-boundary',
      width: siteW,
      length: siteL,
      facing: siteParams.siteFacing || 'North',
      roadDirection: siteParams.roadDirection || 'North Road',
      compassAngle: parseFloat(siteParams.compassAngle) || 0,
      setbacks: {
        east: eastO,
        west: westO,
        north: northO,
        south: southO,
      },
      boundaryWalls: {
        north: DEFAULT_PLOT_WALL_THICKNESS_IN,
        south: DEFAULT_PLOT_WALL_THICKNESS_IN,
        east: DEFAULT_PLOT_WALL_THICKNESS_IN,
        west: DEFAULT_PLOT_WALL_THICKNESS_IN,
      },
    },
    footprint: {
      x: westO,
      y: northO,
      width: Math.max(10, siteW - westO - eastO),
      length: Math.max(10, siteL - northO - southO),
    },
    walls: [],
    rooms: [],
    doors: [],
    windows: [],
    staircases: [],
    columns: [],
    parking: [],
    utilities: [],
    dimensions: [],
    annotations: [],
    cadEntities: [],
  };
}

/**
 * Create a wall object. x1/y1 to x2/y2 is the centreline. `thicknessInches` is
 * the real-world thickness; `thickness` is the same value in feet, the unit of
 * all editor geometry. Pass either one.
 */
export function createWall(params = {}) {
  const fallbackFeet = params.type === 'exterior' ? WALL_THICKNESS.EXTERIOR : WALL_THICKNESS.INTERIOR;
  const hasInches = params.thicknessInches !== undefined;
  const thickness = hasInches
    ? inchesToFeet(params.thicknessInches)
    : (params.thickness !== undefined ? params.thickness : fallbackFeet);
  return {
    id: params.id || generateUniqueId('wall'),
    type: params.type || 'interior', // 'exterior' | 'interior' | 'partition'
    x1: Number(params.x1 || 0),
    y1: Number(params.y1 || 0),
    x2: Number(params.x2 || 0),
    y2: Number(params.y2 || 0),
    thickness: Number(thickness),
    thicknessInches: hasInches ? Number(params.thicknessInches) : feetToInches(thickness),
    isLocked: !!params.isLocked,
    color: params.color || '#0F172A',
  };
}

/**
 * Create a room object
 */
export function createRoom(params = {}) {
  const width = Math.max(2, Number(params.width || 10));
  const length = Math.max(2, Number(params.length || 10));
  return {
    id: params.id || generateUniqueId('room'),
    name: params.name || 'Room',
    label: params.label || params.name || 'Room',
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    width: width,
    length: length,
    color: params.color || ROOM_PALETTE[Math.floor(Math.random() * ROOM_PALETTE.length)],
    isLocked: !!params.isLocked,
    showDimensions: params.showDimensions !== undefined ? params.showDimensions : true,
    showLabel: params.showLabel !== undefined ? params.showLabel : true,
    customTag: params.customTag || '',
  };
}

/**
 * Create a door object
 */
export function createDoor(params = {}) {
  return {
    id: params.id || generateUniqueId('door'),
    wallId: params.wallId || null,
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    width: Number(params.width || (params.isMain ? 3.5 : (params.isBathroom ? 2.3 : 2.8))),
    height: Number(params.height || 7.0),
    thickness: Number(params.thickness || 0.35),
    swing: params.swing || 'inward', // 'inward' | 'outward'
    hinge: params.hinge || 'left', // 'left' | 'right'
    type: params.type || 'single', // 'single' | 'double' | 'sliding'
    isMain: !!params.isMain,
    isBathroom: !!params.isBathroom,
    rotation: Number(params.rotation || 0),
    isLocked: !!params.isLocked,
  };
}

/**
 * Create a window object
 */
export function createWindow(params = {}) {
  return {
    id: params.id || generateUniqueId('win'),
    wallId: params.wallId || null,
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    width: Number(params.width || (params.isBathroom ? 2.0 : 4.0)),
    height: Number(params.height || 4.0),
    type: params.type || (params.isBathroom ? 'ventilator' : 'standard'), // 'standard' | 'ventilator' | 'bay'
    chajja: params.chajja !== undefined ? params.chajja : true,
    chajjaDepth: Number(params.chajjaDepth || 1.0),
    isBathroom: !!params.isBathroom,
    isKitchen: !!params.isKitchen,
    rotation: Number(params.rotation || 0),
    isLocked: !!params.isLocked,
  };
}

import {
  reflowLayoutOnPlotResize,
  syncPlotDimensionAnnotations,
} from './constraintEngine.js';

import {
  createStaircase as createStaircaseCore,
  getStaircaseBounds,
} from './staircaseGeometry.js';

/**
 * Create a staircase object with full architectural parameters
 */
export function createStaircase(params = {}) {
  return createStaircaseCore(params);
}

/**
 * Create a column / pillar object
 */
export function createColumn(params = {}) {
  return {
    id: params.id || generateUniqueId('col'),
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    size: Number(params.size || 0.75), // 9" default
    shape: params.shape || 'square', // 'square' | 'round'
    isLocked: !!params.isLocked,
  };
}

/**
 * Create a parking area
 */
export function createParking(params = {}) {
  return {
    id: params.id || generateUniqueId('parking'),
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    width: Number(params.width || 9.0),
    length: Number(params.length || 16.0),
    label: params.label || 'CAR PARKING',
    isLocked: !!params.isLocked,
  };
}

/**
 * Create a setback utility (Sump, Borewell, Septic, Outside WC)
 */
export function createUtility(params = {}) {
  return {
    id: params.id || generateUniqueId('util'),
    type: params.type || 'sump', // 'sump' | 'bore' | 'septic' | 'wc'
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    width: Number(params.width || 3.5),
    length: Number(params.length || 3.5),
    name: params.name || 'Utility',
    isLocked: !!params.isLocked,
  };
}

/**
 * Create a dimension line
 */
export function createDimension(params = {}) {
  return {
    id: params.id || generateUniqueId('dim'),
    x1: Number(params.x1 || 0),
    y1: Number(params.y1 || 0),
    x2: Number(params.x2 || 0),
    y2: Number(params.y2 || 0),
    offset: Number(params.offset || 1.5),
    label: params.label || '',
    isLocked: !!params.isLocked,
  };
}

/**
 * Create text annotation
 */
export function createAnnotation(params = {}) {
  return {
    id: params.id || generateUniqueId('anno'),
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    text: params.text || 'Annotation',
    fontSize: Number(params.fontSize || 12),
    color: params.color || '#334155',
    isLocked: !!params.isLocked,
  };
}

// ==========================================
// GEOMETRIC CALCULATIONS & TRANSFORMATIONS
// ==========================================

export function calculateWallLength(wall) {
  if (!wall) return 0;
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculateWallAngle(wall) {
  if (!wall) return 0;
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

export function getWallMidpoint(wall) {
  if (!wall) return { x: 0, y: 0 };
  return {
    x: (wall.x1 + wall.x2) / 2,
    y: (wall.y1 + wall.y2) / 2,
  };
}

export function calculateRoomArea(room) {
  if (!room) return 0;
  return Math.max(0, (room.width || 0) * (room.length || 0));
}

/**
 * Distance from point (px, py) to line segment (x1, y1) -> (x2, y2)
 */
export function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));

  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  const dx = px - projX;
  const dy = py - projY;

  return {
    distance: Math.sqrt(dx * dx + dy * dy),
    projectedX: projX,
    projectedY: projY,
    t: t,
  };
}

/**
 * Split a wall into two segments at a point
 */
export function splitWallAtPoint(wall, point) {
  const midX = point.x !== undefined ? point.x : (wall.x1 + wall.x2) / 2;
  const midY = point.y !== undefined ? point.y : (wall.y1 + wall.y2) / 2;

  const seg1 = createWall({
    ...wall,
    id: generateUniqueId('wall'),
    x2: midX,
    y2: midY,
  });

  const seg2 = createWall({
    ...wall,
    id: generateUniqueId('wall'),
    x1: midX,
    y1: midY,
  });

  return [seg1, seg2];
}

/**
 * Join two collinear walls that share an endpoint
 */
export function canJoinWalls(w1, w2, tolerance = 0.2) {
  if (!w1 || !w2 || w1.id === w2.id) return false;
  if (Math.abs(w1.thickness - w2.thickness) > 0.01) return false;

  // Check shared endpoints
  const endpoints = [
    { p1: { x: w1.x2, y: w1.y2 }, p2: { x: w2.x1, y: w2.y1 }, type: 'end-start' },
    { p1: { x: w1.x1, y: w1.y1 }, p2: { x: w2.x2, y: w2.y2 }, type: 'start-end' },
    { p1: { x: w1.x2, y: w1.y2 }, p2: { x: w2.x2, y: w2.y2 }, type: 'end-end' },
    { p1: { x: w1.x1, y: w1.y1 }, p2: { x: w2.x1, y: w2.y1 }, type: 'start-start' },
  ];

  for (const ep of endpoints) {
    const dist = Math.sqrt((ep.p1.x - ep.p2.x) ** 2 + (ep.p1.y - ep.p2.y) ** 2);
    if (dist < tolerance) {
      // Check collinearity
      const a1 = calculateWallAngle(w1) % 180;
      const a2 = calculateWallAngle(w2) % 180;
      if (Math.abs(a1 - a2) < 0.5 || Math.abs(Math.abs(a1 - a2) - 180) < 0.5) {
        return ep.type;
      }
    }
  }
  return false;
}

export function joinWalls(w1, w2) {
  const joinType = canJoinWalls(w1, w2);
  if (!joinType) return null;

  let x1, y1, x2, y2;
  if (joinType === 'end-start') {
    x1 = w1.x1; y1 = w1.y1; x2 = w2.x2; y2 = w2.y2;
  } else if (joinType === 'start-end') {
    x1 = w2.x1; y1 = w2.y1; x2 = w1.x2; y2 = w1.y2;
  } else if (joinType === 'end-end') {
    x1 = w1.x1; y1 = w1.y1; x2 = w2.x1; y2 = w2.y1;
  } else {
    x1 = w1.x2; y1 = w1.y2; x2 = w2.x2; y2 = w2.y2;
  }

  return createWall({
    ...w1,
    id: w1.id,
    x1, y1, x2, y2,
  });
}

/**
 * Snap a value to a grid step
 */
export function snapValue(val, snapStep = 0.5) {
  if (!snapStep || snapStep <= 0) return val;
  return Math.round(val / snapStep) * snapStep;
}

// ==========================================
// WALL ORIENTATION & STRAIGHT-LINE DRAGGING
// ==========================================

/**
 * Classify a wall's orientation. Near-axis walls are treated as perfectly
 * horizontal / vertical so they never accidentally become tilted.
 * @returns {'horizontal'|'vertical'|'diagonal'}
 */
export function getWallOrientation(wall, tolerance = 0.15) {
  if (!wall) return 'diagonal';
  const dx = Math.abs(wall.x2 - wall.x1);
  const dy = Math.abs(wall.y2 - wall.y1);
  if (dy <= tolerance && dx >= tolerance) return 'horizontal';
  if (dx <= tolerance && dy >= tolerance) return 'vertical';
  return 'diagonal';
}

/**
 * Force a near-axis wall to be perfectly axis aligned (removes floating drift).
 */
export function normalizeWallOrientation(wall, tolerance = 0.15) {
  if (!wall) return wall;
  const orientation = getWallOrientation(wall, tolerance);
  if (orientation === 'horizontal') return { ...wall, y2: wall.y1 };
  if (orientation === 'vertical') return { ...wall, x2: wall.x1 };
  return wall;
}

/**
 * Translate an entire wall by (dx, dy). Both endpoints move by the exact same
 * delta, which guarantees the length, thickness and orientation are preserved.
 */
export function translateWall(wall, dx, dy) {
  if (!wall) return wall;
  return {
    ...wall,
    x1: wall.x1 + dx,
    y1: wall.y1 + dy,
    x2: wall.x2 + dx,
    y2: wall.y2 + dy,
  };
}

/**
 * Move one endpoint of a wall while preserving straight geometry.
 * Axis-aligned walls keep their axis fixed unless diagonal mode is enabled.
 * @param {object} wall
 * @param {'p1'|'p2'} which
 * @param {{x:number,y:number}} point - already snapped target position
 * @param {{allowDiagonal?:boolean}} options
 */
export function moveWallEndpoint(wall, which, point, options = {}) {
  if (!wall) return wall;
  const { allowDiagonal = false } = options;
  const orientation = getWallOrientation(wall);
  let nx = point.x;
  let ny = point.y;

  if (!allowDiagonal) {
    if (orientation === 'horizontal') {
      ny = which === 'p1' ? wall.y1 : wall.y2;
    } else if (orientation === 'vertical') {
      nx = which === 'p1' ? wall.x1 : wall.x2;
    }
  }

  if (which === 'p1') return { ...wall, x1: nx, y1: ny };
  return { ...wall, x2: nx, y2: ny };
}

/**
 * Move every endpoint that was coincident with `fromPoint` to `toPoint`.
 * Used to keep adjoining walls / corners connected when a wall or endpoint
 * is dragged. The excluded wall is left untouched.
 */
export function moveConnectedEndpoints(walls, fromPoint, toPoint, excludeWallId, tolerance = 0.25) {
  if (!Array.isArray(walls) || !fromPoint || !toPoint) return walls;
  return walls.map((w) => {
    if (w.id === excludeWallId) return w;
    let changed = false;
    let nx1 = w.x1;
    let ny1 = w.y1;
    let nx2 = w.x2;
    let ny2 = w.y2;

    if (Math.hypot(w.x1 - fromPoint.x, w.y1 - fromPoint.y) <= tolerance) {
      nx1 = toPoint.x;
      ny1 = toPoint.y;
      changed = true;
    }
    if (Math.hypot(w.x2 - fromPoint.x, w.y2 - fromPoint.y) <= tolerance) {
      nx2 = toPoint.x;
      ny2 = toPoint.y;
      changed = true;
    }
    return changed ? { ...w, x1: nx1, y1: ny1, x2: nx2, y2: ny2 } : w;
  });
}

/**
 * Find the nearest wall endpoint to a target point (for endpoint / corner snapping).
 * @returns {{x:number,y:number,distance:number}|null}
 */
export function findEndpointSnap(point, walls, tolerance = 0.75, excludeWallId = null, excludePoint = null) {
  if (!Array.isArray(walls) || !point) return null;
  let best = null;
  const eps = 1e-6;
  walls.forEach((w) => {
    if (w.id === excludeWallId) return;
    const candidates = [[w.x1, w.y1], [w.x2, w.y2]];
    candidates.forEach(([ex, ey]) => {
      if (excludePoint && Math.abs(ex - excludePoint.x) < eps && Math.abs(ey - excludePoint.y) < eps) return;
      const d = Math.hypot(point.x - ex, point.y - ey);
      if (d <= tolerance && (!best || d < best.distance)) {
        best = { x: ex, y: ey, distance: d };
      }
    });
  });
  return best;
}

/**
 * Find orthogonal alignment guides: if a free coordinate is close to another
 * wall endpoint's coordinate, snap to it and report a guide line.
 */
export function findAlignmentGuides(point, walls, axis, tolerance = 0.5, excludeWallId = null) {
  if (!Array.isArray(walls)) return { x: point.x, y: point.y, guides: [] };
  const guides = [];
  let nx = point.x;
  let ny = point.y;

  if (axis === 'x') {
    let best = null;
    walls.forEach((w) => {
      if (w.id === excludeWallId) return;
      [w.x1, w.x2].forEach((ex) => {
        const d = Math.abs(point.x - ex);
        if (d <= tolerance && (!best || d < best.d)) best = { v: ex, d };
      });
    });
    if (best) {
      nx = best.v;
      guides.push({ orientation: 'v', pos: best.v });
    }
  } else if (axis === 'y') {
    let best = null;
    walls.forEach((w) => {
      if (w.id === excludeWallId) return;
      [w.y1, w.y2].forEach((ey) => {
        const d = Math.abs(point.y - ey);
        if (d <= tolerance && (!best || d < best.d)) best = { v: ey, d };
      });
    });
    if (best) {
      ny = best.v;
      guides.push({ orientation: 'h', pos: best.v });
    }
  }

  return { x: nx, y: ny, guides };
}

// ==========================================
// PLOT DIMENSION LINES (Interactive / Editable)
// ==========================================

/**
 * Read the outer plot dimension annotation metadata for a given axis.
 * The measurement value is always derived from the real plot geometry so the
 * label can never drift from the actual boundary.
 */
export function getPlotDimensionMeta(layout, axis) {
  const plot = layout?.plot || {};
  const value = axis === 'width' ? (Number(plot.width) || 30) : (Number(plot.length) || 40);
  const id = axis === 'width' ? 'dim-plot-width' : 'dim-plot-length';
  const dim = (layout?.dimensions || []).find((d) => d.id === id);
  const fallback = 2.5;
  const offset = dim && Number(dim.offset) ? Math.abs(Number(dim.offset)) : fallback;
  return { id, axis, value, offset };
}

/**
 * Re-derive the outer plot dimension line coordinates & labels from the real
 * plot width/length. Mutates the provided layout (assumed already cloned) and
 * returns it.
 */
export function syncPlotDimensions(layout) {
  if (!layout || !layout.plot) return layout;
  return syncPlotDimensionAnnotations(layout);
}

/**
 * Change the visual offset (position) of an outer plot dimension annotation.
 * Does NOT modify the actual plot geometry.
 */
export function setPlotDimensionOffset(layout, axis, offset) {
  if (!layout || !layout.plot) return layout;
  const off = Math.max(0.5, Number(offset) || 0.5);
  layout.dimensions = Array.isArray(layout.dimensions) ? [...layout.dimensions] : [];
  const id = axis === 'width' ? 'dim-plot-width' : 'dim-plot-length';
  const idx = layout.dimensions.findIndex((d) => d.id === id);
  if (idx >= 0) layout.dimensions[idx] = { ...layout.dimensions[idx], offset: off };
  else layout.dimensions.push(createDimension({ id, offset: off }));
  return syncPlotDimensions(layout);
}

const MIN_PLOT_SIZE = 5; // ft

const WEST_EDGES = ['left', 'corner-nw', 'corner-sw'];
const NORTH_EDGES = ['top', 'corner-nw', 'corner-ne'];
const SYMMETRIC_EDGES = ['symmetric', 'both'];

/**
 * Plot-only resize: moves the outer site boundary and nothing else. Every
 * building list is carried over by reference, so the building cannot change.
 * The opposite edge stays put unless `edge` asks for a symmetric resize.
 *
 * @param {object} layout never mutated
 * @param {{width?:number, length?:number, edge?:string}} change
 *   edge: 'right'|'left'|'top'|'bottom'|'corner-ne'|'corner-nw'|'corner-se'|'corner-sw'|'symmetric'
 *   (default: the east and south edges move)
 * @returns {{success:boolean, nextLayout:object, outside:Array, reason?:string}}
 */
export function resizePlotBoundary(layout, change = {}) {
  if (!layout || !layout.plot) {
    return { success: false, nextLayout: layout, outside: [], reason: 'There is no plot to resize.' };
  }
  const rect = getPlotRect(layout);
  const width = change.width !== undefined ? Number(change.width) : rect.width;
  const length = change.length !== undefined ? Number(change.length) : rect.length;
  if (!Number.isFinite(width) || !Number.isFinite(length)) {
    return { success: false, nextLayout: layout, outside: [], reason: 'That is not a valid measurement, so the plot was not changed.' };
  }
  if (width < MIN_PLOT_SIZE || length < MIN_PLOT_SIZE) {
    return { success: false, nextLayout: layout, outside: [], reason: `The plot must be at least ${MIN_PLOT_SIZE}' on each side, so it was not changed.` };
  }

  const round = (v) => Number(v.toFixed(4));
  const nextW = round(width);
  const nextL = round(length);
  if (nextW === rect.width && nextL === rect.length) {
    return { success: true, nextLayout: layout, outside: findElementsOutsidePlot(layout) };
  }

  // How far the low edge moves for a growth of `grown`.
  const lowEdgeMove = (grown, isLowEdge) => {
    if (SYMMETRIC_EDGES.includes(change.edge)) return grown / 2;
    return isLowEdge ? grown : 0;
  };
  const originX = round(rect.x0 - lowEdgeMove(nextW - rect.width, WEST_EDGES.includes(change.edge)));
  const originY = round(rect.y0 - lowEdgeMove(nextL - rect.length, NORTH_EDGES.includes(change.edge)));

  const { originX: _x, originY: _y, ...plot } = layout.plot;
  if (originX !== 0) plot.originX = originX;
  if (originY !== 0) plot.originY = originY;
  plot.width = nextW;
  plot.length = nextL;

  const next = { ...layout, plot, dimensions: [...(layout.dimensions || [])], updatedAt: new Date().toISOString() };
  syncPlotDimensionAnnotations(next);
  return { success: true, nextLayout: next, outside: findElementsOutsidePlot(next) };
}

/**
 * Set the thickness of one plot wall. Only the plot changes: every building list
 * is carried over by reference, and the plot's size and position stay the same.
 * @param {'north'|'south'|'east'|'west'} side
 * @param {number} inches one of WALL_THICKNESS_OPTIONS
 * @returns {{layout:object, overlapping:Array, reason:string|null}}
 */
export function setPlotWallThickness(layout, side, inches) {
  if (!layout?.plot || !PLOT_WALL_SIDES.includes(side)) {
    return { layout, overlapping: [], reason: 'Plot wall not found.' };
  }
  if (!WALL_THICKNESS_OPTIONS.includes(inches)) {
    return { layout, overlapping: [], reason: `Wall thickness must be one of ${WALL_THICKNESS_OPTIONS.join(', ')} inches.` };
  }
  const current = getPlotWallThicknesses(layout);
  if (current[side] === inches && layout.plot.boundaryWalls) {
    return { layout, overlapping: [], reason: null };
  }
  const next = {
    ...layout,
    plot: { ...layout.plot, boundaryWalls: { ...current, [side]: inches } },
    updatedAt: new Date().toISOString(),
  };
  return { layout: next, overlapping: findElementsInPlotWalls(next), reason: null };
}

/**
 * Objects inside the plot but crossing a plot wall's inner face. Diagnostic only:
 * a plot wall never moves the building.
 * @returns {Array<{type:string,id:string,name:string}>}
 */
export function findElementsInPlotWalls(layout) {
  const margin = 0.02;
  const outsidePlot = new Set(findElementsOutsidePlot(layout, margin).map((o) => `${o.type}:${o.id}`));
  return findElementsOutsidePlot(layout, margin, getPlotInnerRect(layout))
    .filter((o) => !outsidePlot.has(`${o.type}:${o.id}`));
}

/**
 * Warning text naming the objects a plot resize left outside the boundary.
 * @param {Array<{name:string}>} outside result of findElementsOutsidePlot
 */
export function describeOutsidePlot(outside) {
  const names = [...new Set(outside.map((o) => o.name))];
  const shown = names.slice(0, 4).join(', ');
  const more = names.length > 4 ? ` and ${names.length - 4} more` : '';
  const count = outside.length === 1 ? '1 object extends' : `${outside.length} objects extend`;
  return `${count} beyond the plot: ${shown}${more}. The building was not changed.`;
}

/**
 * Change the site through the constraint engine, which reflows the building.
 * The editor only uses this for setbacks; plot size edits use
 * resizePlotBoundary. Returns the full engine result:
 * { nextLayout, conflicts, warnings, success, shift }.
 * @param {object} layout
 * @param {{width?:number, length?:number, setbacks?:object, edge?:string, isSymmetric?:boolean, relaxFixed?:boolean}} change
 */
export function applySiteChange(layout, change = {}) {
  return reflowLayoutOnPlotResize(layout, {
    newWidth: change.width,
    newLength: change.length,
    setbacks: change.setbacks,
    edge: change.edge,
    edgeX: change.edgeX,
    edgeY: change.edgeY,
    isSymmetric: change.isSymmetric,
    relaxFixed: change.relaxFixed,
  });
}

/**
 * Resize the plot along one axis. Kept for callers that only need the layout.
 * @param {'width'|'length'} axis
 */
export function resizePlot(layout, axis, feet, options = {}) {
  if (!layout || !layout.plot) return layout;
  return resizePlotBoundary(layout, { [axis]: Number(feet), edge: options.edge }).nextLayout;
}

/**
 * Identify elements that fall outside the (possibly resized) plot boundary.
 * Diagnostic only: it never moves, resizes, or deletes anything.
 * @param {object} [rect] area to test against; defaults to the plot boundary
 * @returns {Array<{type:string,id:string,name:string}>}
 */
export function findElementsOutsidePlot(layout, margin = 0.2, rect = null) {
  const { x0, y0, x1, y1 } = rect || getPlotRect(layout, { width: 0, length: 0 });
  const out = [];

  const boxOutside = (minX, minY, maxX, maxY) => (
    minX < x0 - margin || minY < y0 - margin || maxX > x1 + margin || maxY > y1 + margin
  );
  const pointOutside = (x, y) => boxOutside(x, y, x, y);

  const checkRect = (e, type, name) => {
    const x = Number(e.x) || 0;
    const y = Number(e.y) || 0;
    if (boxOutside(x, y, x + (Number(e.width) || 0), y + (Number(e.length) || 0))) {
      out.push({ type, id: e.id, name });
    }
  };

  (layout?.rooms || []).forEach((r) => checkRect(r, 'room', r.name || 'Room'));
  (layout?.staircases || []).forEach((s) => checkRect({ id: s.id, ...getStaircaseBounds(s) }, 'staircase', s.label || 'Staircase'));
  (layout?.parking || []).forEach((p) => checkRect(p, 'parking', p.label || 'Parking'));
  (layout?.utilities || []).forEach((u) => checkRect(u, 'utility', u.name || 'Utility'));

  (layout?.walls || []).forEach((w) => {
    // Measured to the wall's faces, not just its centreline.
    const half = (Number(w.thickness) || 0) / 2;
    if (boxOutside(Math.min(w.x1, w.x2) - half, Math.min(w.y1, w.y2) - half, Math.max(w.x1, w.x2) + half, Math.max(w.y1, w.y2) + half)) {
      out.push({ type: 'wall', id: w.id, name: 'Wall' });
    }
  });

  (layout?.doors || []).forEach((d) => {
    if (pointOutside(d.x, d.y)) out.push({ type: 'door', id: d.id, name: 'Door' });
  });

  (layout?.windows || []).forEach((win) => {
    if (pointOutside(win.x, win.y)) out.push({ type: 'window', id: win.id, name: 'Window' });
  });

  (layout?.columns || []).forEach((c) => {
    if (pointOutside(c.x, c.y)) out.push({ type: 'column', id: c.id, name: 'Column' });
  });

  (layout?.annotations || []).forEach((a) => {
    if (pointOutside(a.x, a.y)) out.push({ type: 'annotation', id: a.id, name: a.text || 'Text' });
  });

  (layout?.cadEntities || []).forEach((e) => {
    const b = entityBounds(e);
    if (boxOutside(b.minX, b.minY, b.maxX, b.maxY)) out.push({ type: 'entity', id: e.id, name: 'Drawing object' });
  });

  return out;
}

/**
 * Deep clone layout object for immutable updates and undo/redo
 */
export function cloneLayout(layout) {
  if (!layout) return null;
  return JSON.parse(JSON.stringify(layout));
}

export {
  MIN_ROOM_DIMENSION,
  getPlotAndBuildableBounds,
  checkRoomPlotFit,
  collectAlignmentTargets,
  findRoomSnapping,
  areSegmentsOverlapping,
  createRoomBoundaryWalls,
  syncRoomWithWallsAndOpenings,
} from './roomGeometry.js';

export {
  reflowLayoutOnPlotResize,
  inferObjectConstraints,
  inferRoomConstraintType,
  getRoomTypeMinimum,
  validateOpenings,
  validateSiteFit,
  CONSTRAINT_TYPES,
  ANCHOR_TYPES,
} from './constraintEngine.js';

export {
  calculateStaircaseGeometry,
  validateStaircaseFit,
  normalizeStaircase,
  getStaircaseBounds,
  resizeStaircaseWorld,
  rotateStaircase,
  stairDimensionForAxis,
  STAIRCASE_TYPES,
  STAIRCASE_DEFAULTS,
} from './staircaseGeometry.js';
