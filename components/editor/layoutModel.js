/**
 * AutoPlot Architectural Layout Data Model & Geometry Utilities
 * Complete 2D structured object representation of a building layout.
 */

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
  };
}

/**
 * Create a wall object
 */
export function createWall(params = {}) {
  const thickness = params.thickness !== undefined ? params.thickness : (params.type === 'exterior' ? WALL_THICKNESS.EXTERIOR : WALL_THICKNESS.INTERIOR);
  return {
    id: params.id || generateUniqueId('wall'),
    type: params.type || 'interior', // 'exterior' | 'interior' | 'partition'
    x1: Number(params.x1 || 0),
    y1: Number(params.y1 || 0),
    x2: Number(params.x2 || 0),
    y2: Number(params.y2 || 0),
    thickness: Number(thickness),
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

/**
 * Create a staircase object
 */
export function createStaircase(params = {}) {
  return {
    id: params.id || generateUniqueId('stair'),
    x: Number(params.x || 0),
    y: Number(params.y || 0),
    width: Number(params.width || 6.0),
    length: Number(params.length || 9.0),
    direction: params.direction || 'up', // 'up' | 'down'
    stairType: params.stairType || 'dog-legged', // 'dog-legged' | 'straight' | 'spiral'
    steps: Number(params.steps || 14),
    label: params.label || 'STAIRS',
    isLocked: !!params.isLocked,
  };
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
  if (Math.abs(w1.thickness - w2.thickness) > 0.1) return false;

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
      if (Math.abs(a1 - a2) < 3 || Math.abs(Math.abs(a1 - a2) - 180) < 3) {
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
  const W = Number(layout.plot.width) || 30;
  const L = Number(layout.plot.length) || 40;
  if (!Array.isArray(layout.dimensions)) layout.dimensions = [];

  const wExisting = layout.dimensions.find((d) => d.id === 'dim-plot-width');
  const lExisting = layout.dimensions.find((d) => d.id === 'dim-plot-length');
  const wOff = wExisting && Number(wExisting.offset) ? Math.abs(Number(wExisting.offset)) : 2.5;
  const lOff = lExisting && Number(lExisting.offset) ? Math.abs(Number(lExisting.offset)) : 2.5;

  const upsert = (id, fields) => {
    const idx = layout.dimensions.findIndex((d) => d.id === id);
    if (idx >= 0) layout.dimensions[idx] = { ...layout.dimensions[idx], ...fields };
    else layout.dimensions.push(createDimension({ id, ...fields }));
  };

  upsert('dim-plot-width', {
    x1: 0, y1: -wOff, x2: W, y2: -wOff, offset: wOff,
    label: `${W}' (Plot Width)`,
  });
  upsert('dim-plot-length', {
    x1: -lOff, y1: 0, x2: -lOff, y2: L, offset: lOff,
    label: `${L}' (Plot Length)`,
  });

  return layout;
}

/**
 * Change the visual offset (position) of an outer plot dimension annotation.
 * Does NOT modify the actual plot geometry.
 */
export function setPlotDimensionOffset(layout, axis, offset) {
  if (!layout || !layout.plot) return layout;
  const off = Math.max(0.5, Number(offset) || 0.5);
  if (!Array.isArray(layout.dimensions)) layout.dimensions = [];
  const id = axis === 'width' ? 'dim-plot-width' : 'dim-plot-length';
  const idx = layout.dimensions.findIndex((d) => d.id === id);
  if (idx >= 0) layout.dimensions[idx] = { ...layout.dimensions[idx], offset: off };
  else layout.dimensions.push(createDimension({ id, offset: off }));
  return syncPlotDimensions(layout);
}

/**
 * Resize the real plot geometry along an axis and refresh dependent metadata
 * (footprint + outer dimension annotations). Internal objects are intentionally
 * NOT stretched - they stay exactly where they are and are re-validated later.
 * @param {object} layout
 * @param {'width'|'length'} axis
 * @param {number} feet
 */
export function resizePlot(layout, axis, feet) {
  if (!layout || !layout.plot) return layout;
  const next = cloneLayout(layout);
  const val = Math.max(2, Number(feet) || 0);
  if (axis === 'width') next.plot.width = Number(val.toFixed(2));
  else next.plot.length = Number(val.toFixed(2));

  const sb = next.plot.setbacks || { east: 2, west: 2, north: 4, south: 4 };
  next.plot.setbacks = sb;
  next.footprint = {
    ...(next.footprint || {}),
    x: Number(sb.west || 0),
    y: Number(sb.north || 0),
    width: Math.max(1, Number((next.plot.width - (sb.west || 0) - (sb.east || 0)).toFixed(2))),
    length: Math.max(1, Number((next.plot.length - (sb.north || 0) - (sb.south || 0)).toFixed(2))),
  };

  return syncPlotDimensions(next);
}

/**
 * Identify elements that fall outside the (possibly resized) plot boundary.
 * Used to warn before an unsafe shrink is applied - never deletes anything.
 * @returns {Array<{type:string,id:string,name:string}>}
 */
export function findElementsOutsidePlot(layout, margin = 0.2) {
  const W = Number(layout?.plot?.width) || 0;
  const L = Number(layout?.plot?.length) || 0;
  const out = [];

  const checkRect = (e, type, name) => {
    const x = Number(e.x) || 0;
    const y = Number(e.y) || 0;
    const w = Number(e.width) || 0;
    const h = Number(e.length) || 0;
    if (x < -margin || y < -margin || x + w > W + margin || y + h > L + margin) {
      out.push({ type, id: e.id, name });
    }
  };

  (layout?.rooms || []).forEach((r) => checkRect(r, 'room', r.name || 'Room'));
  (layout?.staircases || []).forEach((s) => checkRect(s, 'staircase', s.label || 'Staircase'));
  (layout?.parking || []).forEach((p) => checkRect(p, 'parking', p.label || 'Parking'));
  (layout?.utilities || []).forEach((u) => checkRect(u, 'utility', u.name || 'Utility'));

  (layout?.walls || []).forEach((w) => {
    const pts = [[w.x1, w.y1], [w.x2, w.y2]];
    for (const [x, y] of pts) {
      if (x < -margin || y < -margin || x > W + margin || y > L + margin) {
        out.push({ type: 'wall', id: w.id, name: 'Wall' });
        break;
      }
    }
  });

  (layout?.doors || []).forEach((d) => {
    if (d.x < -margin || d.y < -margin || d.x > W + margin || d.y > L + margin) {
      out.push({ type: 'door', id: d.id, name: 'Door' });
    }
  });

  (layout?.windows || []).forEach((win) => {
    if (win.x < -margin || win.y < -margin || win.x > W + margin || win.y > L + margin) {
      out.push({ type: 'window', id: win.id, name: 'Window' });
    }
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
