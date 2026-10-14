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

/**
 * Deep clone layout object for immutable updates and undo/redo
 */
export function cloneLayout(layout) {
  if (!layout) return null;
  return JSON.parse(JSON.stringify(layout));
}
