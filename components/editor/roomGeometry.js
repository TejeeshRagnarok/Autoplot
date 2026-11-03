/**
 * AutoPlot Room Geometry, Snapping, Alignment & Boundary Synchronization Engine
 * Handles:
 * - Smart alignment & snapping (Plot boundaries, Setback/Footprint, Walls, Adjacent rooms, Grid)
 * - Screen-pixel normalized snapping tolerance across all zoom levels
 * - Alignment guides & snap indicator generation
 * - Plot & buildable area fit detection & warnings
 * - 8-point room resize calculations (NW, N, NE, E, SE, S, SW, W)
 * - Boundary wall generation & synchronization (preventing duplicate or doubled walls)
 * - Door and window host wall tracking during room movement & resizing
 */

import {
  createWall,
  createRoom,
  WALL_THICKNESS,
  cloneLayout,
  generateUniqueId,
} from './layoutModel.js';

export const MIN_ROOM_DIMENSION = 2.5; // Feet

/**
 * Extract plot, setbacks, and buildable footprint bounds
 */
export function getPlotAndBuildableBounds(layout) {
  const plotW = Number(layout?.plot?.width) || 30;
  const plotL = Number(layout?.plot?.length) || 40;
  const sb = layout?.plot?.setbacks || { east: 2, west: 2, north: 4, south: 4 };
  const northO = Number(sb.north) || 0;
  const southO = Number(sb.south) || 0;
  const eastO = Number(sb.east) || 0;
  const westO = Number(sb.west) || 0;

  const minX = westO;
  const maxX = Math.max(minX + 2, plotW - eastO);
  const minY = northO;
  const maxY = Math.max(minY + 2, plotL - southO);

  return {
    plot: { width: plotW, length: plotL },
    setbacks: { north: northO, south: southO, east: eastO, west: westO },
    buildable: {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(0, maxX - minX),
      length: Math.max(0, maxY - minY),
    },
  };
}

/**
 * Validate whether a room fits inside the plot and the buildable area
 */
export function checkRoomPlotFit(room, layout) {
  if (!room || !layout) return { isOutsidePlot: false, isOutsideBuildable: false, warnings: [] };
  const { plot, buildable } = getPlotAndBuildableBounds(layout);
  const warnings = [];

  const rLeft = Number(room.x) || 0;
  const rTop = Number(room.y) || 0;
  const rW = Number(room.width) || 0;
  const rL = Number(room.length) || 0;
  const rRight = rLeft + rW;
  const rBottom = rTop + rL;

  const eps = 0.05;

  const isOutsidePlot =
    rLeft < -eps ||
    rTop < -eps ||
    rRight > plot.width + eps ||
    rBottom > plot.length + eps;

  const isOutsideBuildable =
    rLeft < buildable.minX - eps ||
    rTop < buildable.minY - eps ||
    rRight > buildable.maxX + eps ||
    rBottom > buildable.maxY + eps;

  const exceedsBuildableDimensions =
    rW > buildable.width + eps || rL > buildable.length + eps;

  if (isOutsidePlot) {
    warnings.push(
      `Room extends beyond the plot boundary (${plot.width}' × ${plot.length}').`
    );
  } else if (isOutsideBuildable) {
    warnings.push(
      `Room extends into the restricted setback zone (buildable: ${buildable.width.toFixed(1)}' × ${buildable.length.toFixed(1)}').`
    );
  }

  if (exceedsBuildableDimensions) {
    warnings.push(
      `Room dimensions (${rW.toFixed(1)}' × ${rL.toFixed(1)}') exceed available buildable space (${buildable.width.toFixed(1)}' × ${buildable.length.toFixed(1)}').`
    );
  }

  return {
    isOutsidePlot,
    isOutsideBuildable,
    exceedsBuildableDimensions,
    warnings,
    buildable,
    plot,
  };
}

/**
 * Collect all candidate vertical and horizontal alignment lines from plot, setbacks, walls, and other rooms
 */
export function collectAlignmentTargets(layout, excludeRoomId = null) {
  const { plot, buildable } = getPlotAndBuildableBounds(layout);

  // Vertical alignment targets (x-coordinates)
  const verticalTargets = [
    { pos: 0, label: 'Plot West Boundary', type: 'plot', priority: 1 },
    { pos: plot.width, label: 'Plot East Boundary', type: 'plot', priority: 1 },
    { pos: buildable.minX, label: 'West Setback Line', type: 'setback', priority: 2 },
    { pos: buildable.maxX, label: 'East Setback Line', type: 'setback', priority: 2 },
  ];

  // Horizontal alignment targets (y-coordinates)
  const horizontalTargets = [
    { pos: 0, label: 'Plot North Boundary', type: 'plot', priority: 1 },
    { pos: plot.length, label: 'Plot South Boundary', type: 'plot', priority: 1 },
    { pos: buildable.minY, label: 'North Setback Line', type: 'setback', priority: 2 },
    { pos: buildable.maxY, label: 'South Setback Line', type: 'setback', priority: 2 },
  ];

  // From other rooms
  (layout?.rooms || []).forEach((r) => {
    if (r.id === excludeRoomId) return;
    const name = r.name || r.label || 'Room';
    const rx = Number(r.x) || 0;
    const ry = Number(r.y) || 0;
    const rw = Number(r.width) || 0;
    const rl = Number(r.length) || 0;

    verticalTargets.push(
      { pos: rx, label: `${name} (Left)`, type: 'room', priority: 3 },
      { pos: rx + rw, label: `${name} (Right)`, type: 'room', priority: 3 },
      { pos: rx + rw / 2, label: `${name} (Center)`, type: 'room-center', priority: 4 }
    );

    horizontalTargets.push(
      { pos: ry, label: `${name} (Top)`, type: 'room', priority: 3 },
      { pos: ry + rl, label: `${name} (Bottom)`, type: 'room', priority: 3 },
      { pos: ry + rl / 2, label: `${name} (Center)`, type: 'room-center', priority: 4 }
    );
  });

  // From existing walls
  (layout?.walls || []).forEach((w) => {
    const dx = Math.abs(w.x2 - w.x1);
    const dy = Math.abs(w.y2 - w.y1);

    // Room edges lie on wall centrelines, so that is the only line to snap to:
    // a room snapped to a wall face would leave a sliver beside the shared wall.
    if (dx <= 0.2) {
      // Near vertical wall
      const avgX = (w.x1 + w.x2) / 2;
      verticalTargets.push({ pos: avgX, label: 'Wall Centerline', type: 'wall', priority: 2 });
    }
    if (dy <= 0.2) {
      // Near horizontal wall
      const avgY = (w.y1 + w.y2) / 2;
      horizontalTargets.push({ pos: avgY, label: 'Wall Centerline', type: 'wall', priority: 2 });
    }

    // Endpoints
    verticalTargets.push(
      { pos: w.x1, label: 'Wall Endpoint', type: 'wall-point', priority: 4 },
      { pos: w.x2, label: 'Wall Endpoint', type: 'wall-point', priority: 4 }
    );
    horizontalTargets.push(
      { pos: w.y1, label: 'Wall Endpoint', type: 'wall-point', priority: 4 },
      { pos: w.y2, label: 'Wall Endpoint', type: 'wall-point', priority: 4 }
    );
  });

  return { verticalTargets, horizontalTargets };
}

/**
 * Smart snapping calculation for Room placement, movement, and resizing
 * Converts screen-pixel tolerance (e.g. 12px) to world units dynamically.
 */
export function findRoomSnapping(proposedRoom, layout, options = {}) {
  const {
    excludeRoomId = null,
    handle = 'body', // 'body' | 'draw' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
    viewportScale = 18,
    screenTolerancePixels = 12,
    snapEnabled = true,
    snapStep = 0.5,
    anchor = null, // Fixed anchor point during resize
  } = options;

  // Compute world tolerance based on screen pixels for consistent feel at all zooms
  const worldTolerance = Math.max(0.15, Math.min(2.5, screenTolerancePixels / Math.max(1, viewportScale)));

  const { verticalTargets, horizontalTargets } = collectAlignmentTargets(layout, excludeRoomId);

  let curX = Number(proposedRoom.x) || 0;
  let curY = Number(proposedRoom.y) || 0;
  let curW = Math.max(MIN_ROOM_DIMENSION, Number(proposedRoom.width) || MIN_ROOM_DIMENSION);
  let curL = Math.max(MIN_ROOM_DIMENSION, Number(proposedRoom.length) || MIN_ROOM_DIMENSION);

  const guides = [];
  const snapBadges = [];

  // Helper to snap a coordinate to a list of targets or grid
  const snapCoord = (val, targets, axisName) => {
    // The snap switch controls every kind of snap, not only the grid.
    if (!snapEnabled) return { snapped: val, delta: 0, target: null };
    let bestDelta = 0;
    let bestDist = Infinity;
    let bestTarget = null;

    // 1. Check architectural targets
    for (const t of targets) {
      const d = Math.abs(val - t.pos);
      if (d <= worldTolerance) {
        // Prioritize closer distance, then higher priority
        if (d < bestDist - 0.01 || (Math.abs(d - bestDist) <= 0.01 && t.priority < (bestTarget?.priority || 99))) {
          bestDist = d;
          bestDelta = t.pos - val;
          bestTarget = t;
        }
      }
    }

    if (bestTarget) {
      return {
        snapped: val + bestDelta,
        delta: bestDelta,
        target: bestTarget,
      };
    }

    // 2. Check grid snap if enabled
    if (snapEnabled && snapStep > 0) {
      const gridVal = Math.round(val / snapStep) * snapStep;
      const d = Math.abs(val - gridVal);
      if (d <= worldTolerance * 0.8) {
        return {
          snapped: gridVal,
          delta: gridVal - val,
          target: { pos: gridVal, label: `Grid (${gridVal}')`, type: 'grid' },
        };
      }
    }

    return { snapped: val, delta: 0, target: null };
  };

  if (handle === 'body') {
    // Moving the whole room: test left, right, and center edges against vertical targets
    const xCandidates = [
      { val: curX, offset: 0, role: 'Left Edge' },
      { val: curX + curW, offset: -curW, role: 'Right Edge' },
      { val: curX + curW / 2, offset: -curW / 2, role: 'Center' },
    ];

    let bestX = null;
    for (const cand of xCandidates) {
      const res = snapCoord(cand.val, verticalTargets, 'x');
      if (res.target && (!bestX || Math.abs(res.delta) < Math.abs(bestX.delta))) {
        bestX = { ...res, newRoomX: curX + res.delta, role: cand.role };
      }
    }

    if (bestX) {
      curX = bestX.newRoomX;
      guides.push({
        orientation: 'v',
        pos: bestX.target.pos,
        label: `${bestX.target.label}`,
        type: bestX.target.type,
      });
      snapBadges.push({
        text: `🧲 ${bestX.target.label}`,
        type: bestX.target.type,
        pos: { x: bestX.target.pos, y: curY + curL / 2 },
      });
    }

    // Test top, bottom, and center edges against horizontal targets
    const yCandidates = [
      { val: curY, offset: 0, role: 'Top Edge' },
      { val: curY + curL, offset: -curL, role: 'Bottom Edge' },
      { val: curY + curL / 2, offset: -curL / 2, role: 'Center' },
    ];

    let bestY = null;
    for (const cand of yCandidates) {
      const res = snapCoord(cand.val, horizontalTargets, 'y');
      if (res.target && (!bestY || Math.abs(res.delta) < Math.abs(bestY.delta))) {
        bestY = { ...res, newRoomY: curY + res.delta, role: cand.role };
      }
    }

    if (bestY) {
      curY = bestY.newRoomY;
      guides.push({
        orientation: 'h',
        pos: bestY.target.pos,
        label: `${bestY.target.label}`,
        type: bestY.target.type,
      });
      snapBadges.push({
        text: `🧲 ${bestY.target.label}`,
        type: bestY.target.type,
        pos: { x: curX + curW / 2, y: bestY.target.pos },
      });
    }
  } else if (handle === 'draw') {
    // When drawing a new room from anchor to cursor
    // The opposite corner (curX + curW, curY + curL) or proposed free point is snapped
    const pX = proposedRoom.freeX !== undefined ? proposedRoom.freeX : curX + curW;
    const pY = proposedRoom.freeY !== undefined ? proposedRoom.freeY : curY + curL;

    const snapX = snapCoord(pX, verticalTargets, 'x');
    const snapY = snapCoord(pY, horizontalTargets, 'y');

    const finalCornerX = snapX.snapped;
    const finalCornerY = snapY.snapped;

    if (snapX.target) {
      guides.push({ orientation: 'v', pos: snapX.target.pos, label: snapX.target.label, type: snapX.target.type });
      snapBadges.push({ text: `🧲 ${snapX.target.label}`, type: snapX.target.type, pos: { x: snapX.target.pos, y: finalCornerY } });
    }
    if (snapY.target) {
      guides.push({ orientation: 'h', pos: snapY.target.pos, label: snapY.target.label, type: snapY.target.type });
      snapBadges.push({ text: `🧲 ${snapY.target.label}`, type: snapY.target.type, pos: { x: finalCornerX, y: snapY.target.pos } });
    }

    const startX = anchor ? anchor.x : curX;
    const startY = anchor ? anchor.y : curY;

    curX = Math.min(startX, finalCornerX);
    curY = Math.min(startY, finalCornerY);
    curW = Math.max(0.1, Math.abs(finalCornerX - startX));
    curL = Math.max(0.1, Math.abs(finalCornerY - startY));
  } else {
    // Resizing handles (8 directions)
    // Left edge moving ('w', 'nw', 'sw')
    if (handle.includes('w')) {
      const fixedRight = anchor ? anchor.x : curX + curW;
      const snapRes = snapCoord(curX, verticalTargets, 'x');
      let targetLeft = snapRes.snapped;
      // Enforce minimum dimension
      if (fixedRight - targetLeft < MIN_ROOM_DIMENSION) {
        targetLeft = fixedRight - MIN_ROOM_DIMENSION;
      }
      curX = targetLeft;
      curW = fixedRight - targetLeft;
      if (snapRes.target) {
        guides.push({ orientation: 'v', pos: snapRes.target.pos, label: snapRes.target.label, type: snapRes.target.type });
        snapBadges.push({ text: `🧲 ${snapRes.target.label}`, type: snapRes.target.type, pos: { x: curX, y: curY + curL / 2 } });
      }
    }

    // Right edge moving ('e', 'ne', 'se')
    if (handle.includes('e')) {
      const fixedLeft = anchor ? anchor.x : curX;
      const proposedRight = curX + curW;
      const snapRes = snapCoord(proposedRight, verticalTargets, 'x');
      let targetRight = snapRes.snapped;
      if (targetRight - fixedLeft < MIN_ROOM_DIMENSION) {
        targetRight = fixedLeft + MIN_ROOM_DIMENSION;
      }
      curX = fixedLeft;
      curW = targetRight - fixedLeft;
      if (snapRes.target) {
        guides.push({ orientation: 'v', pos: snapRes.target.pos, label: snapRes.target.label, type: snapRes.target.type });
        snapBadges.push({ text: `🧲 ${snapRes.target.label}`, type: snapRes.target.type, pos: { x: fixedLeft + curW, y: curY + curL / 2 } });
      }
    }

    // Top edge moving ('n', 'nw', 'ne')
    if (handle.includes('n')) {
      const fixedBottom = anchor ? anchor.y : curY + curL;
      const snapRes = snapCoord(curY, horizontalTargets, 'y');
      let targetTop = snapRes.snapped;
      if (fixedBottom - targetTop < MIN_ROOM_DIMENSION) {
        targetTop = fixedBottom - MIN_ROOM_DIMENSION;
      }
      curY = targetTop;
      curL = fixedBottom - targetTop;
      if (snapRes.target) {
        guides.push({ orientation: 'h', pos: snapRes.target.pos, label: snapRes.target.label, type: snapRes.target.type });
        snapBadges.push({ text: `🧲 ${snapRes.target.label}`, type: snapRes.target.type, pos: { x: curX + curW / 2, y: curY } });
      }
    }

    // Bottom edge moving ('s', 'sw', 'se')
    if (handle.includes('s')) {
      const fixedTop = anchor ? anchor.y : curY;
      const proposedBottom = curY + curL;
      const snapRes = snapCoord(proposedBottom, horizontalTargets, 'y');
      let targetBottom = snapRes.snapped;
      if (targetBottom - fixedTop < MIN_ROOM_DIMENSION) {
        targetBottom = fixedTop + MIN_ROOM_DIMENSION;
      }
      curY = fixedTop;
      curL = targetBottom - fixedTop;
      if (snapRes.target) {
        guides.push({ orientation: 'h', pos: snapRes.target.pos, label: snapRes.target.label, type: snapRes.target.type });
        snapBadges.push({ text: `🧲 ${snapRes.target.label}`, type: snapRes.target.type, pos: { x: curX + curW / 2, y: fixedTop + curL } });
      }
    }
  }

  const snappedRoom = {
    ...proposedRoom,
    // Same precision as the room solver, so a snapped edge lands exactly on its target.
    x: Number(curX.toFixed(4)),
    y: Number(curY.toFixed(4)),
    width: Number(curW.toFixed(4)),
    length: Number(curL.toFixed(4)),
  };

  const fitCheck = checkRoomPlotFit(snappedRoom, layout);

  return {
    snappedRoom,
    guides,
    snapBadges,
    fitCheck,
    warnings: fitCheck.warnings,
  };
}

/**
 * Check if two line segments are collinear and overlapping
 */
export function areSegmentsOverlapping(s1, s2, tolerance = 0.25) {
  const isHoriz1 = Math.abs(s1.y1 - s1.y2) < 0.15;
  const isHoriz2 = Math.abs(s2.y1 - s2.y2) < 0.15;
  const isVert1 = Math.abs(s1.x1 - s1.x2) < 0.15;
  const isVert2 = Math.abs(s2.x1 - s2.x2) < 0.15;

  if (isHoriz1 && isHoriz2) {
    if (Math.abs(s1.y1 - s2.y1) > tolerance) return false;
    const min1 = Math.min(s1.x1, s1.x2);
    const max1 = Math.max(s1.x1, s1.x2);
    const min2 = Math.min(s2.x1, s2.x2);
    const max2 = Math.max(s2.x1, s2.x2);
    const overlap = Math.min(max1, max2) - Math.max(min1, min2);
    return overlap > tolerance;
  }

  if (isVert1 && isVert2) {
    if (Math.abs(s1.x1 - s2.x1) > tolerance) return false;
    const min1 = Math.min(s1.y1, s1.y2);
    const max1 = Math.max(s1.y1, s1.y2);
    const min2 = Math.min(s2.y1, s2.y2);
    const max2 = Math.max(s2.y1, s2.y2);
    const overlap = Math.min(max1, max2) - Math.max(min1, min2);
    return overlap > tolerance;
  }

  return false;
}

/**
 * Generates boundary walls for a new room, reusing / avoiding duplicate shared walls
 */
export function createRoomBoundaryWalls(layout, room) {
  if (!room || !layout) return layout?.walls || [];
  const rL = room.x;
  const rR = room.x + room.width;
  const rT = room.y;
  const rB = room.y + room.length;

  const existingWalls = [...(layout.walls || [])];

  const segments = [
    { x1: rL, y1: rT, x2: rR, y2: rT, name: 'top' },
    { x1: rL, y1: rB, x2: rR, y2: rB, name: 'bottom' },
    { x1: rL, y1: rT, x2: rL, y2: rB, name: 'left' },
    { x1: rR, y1: rT, x2: rR, y2: rB, name: 'right' },
  ];

  segments.forEach((seg) => {
    // Check if an existing wall already covers this segment
    const hasOverlap = existingWalls.some((w) => areSegmentsOverlapping(w, seg, 0.3));
    if (!hasOverlap) {
      existingWalls.push(
        createWall({
          id: generateUniqueId('wall-int'),
          type: 'interior',
          x1: Number(seg.x1.toFixed(2)),
          y1: Number(seg.y1.toFixed(2)),
          x2: Number(seg.x2.toFixed(2)),
          y2: Number(seg.y2.toFixed(2)),
          thickness: WALL_THICKNESS.INTERIOR,
        })
      );
    }
  });

  return existingWalls;
}

/**
 * Synchronize boundary walls, doors, and windows when a room is moved or resized
 *
 * @deprecated Use roomResize.js (resizeRoom / moveRoom). This function adds
 * deltas to the walls it is given, so calling it repeatedly on a live drag
 * preview stretches walls cumulatively, and it edits exterior walls.
 */
export function syncRoomWithWallsAndOpenings(layout, oldRoom, newRoom) {
  if (!layout || !oldRoom || !newRoom) return layout;

  const oldL = oldRoom.x;
  const oldR = oldRoom.x + oldRoom.width;
  const oldT = oldRoom.y;
  const oldB = oldRoom.y + oldRoom.length;

  const newL = newRoom.x;
  const newR = newRoom.x + newRoom.width;
  const newT = newRoom.y;
  const newB = newRoom.y + newRoom.length;

  const deltaX = newL - oldL;
  const deltaY = newT - oldT;
  const deltaW = (newR - newL) - (oldR - oldL);
  const deltaL = (newB - newT) - (oldB - oldT);

  // If geometry hasn't changed, return early
  if (Math.abs(deltaX) < 1e-4 && Math.abs(deltaY) < 1e-4 && Math.abs(deltaW) < 1e-4 && Math.abs(deltaL) < 1e-4) {
    return layout;
  }

  const otherRooms = (layout.rooms || []).filter((r) => r.id !== oldRoom.id);

  // Helper to check if an old edge was shared with another room
  const isEdgeSharedWithOther = (seg) => {
    return otherRooms.some((r) => {
      const edges = [
        { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y },
        { x1: r.x, y1: r.y + r.length, x2: r.x + r.width, y2: r.y + r.length },
        { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.length },
        { x1: r.x + r.width, y1: r.y, x2: r.x + r.width, y2: r.y + r.length },
      ];
      return edges.some((e) => areSegmentsOverlapping(e, seg, 0.3));
    });
  };

  const oldSegments = {
    top: { x1: oldL, y1: oldT, x2: oldR, y2: oldT },
    bottom: { x1: oldL, y1: oldB, x2: oldR, y2: oldB },
    left: { x1: oldL, y1: oldT, x2: oldL, y2: oldB },
    right: { x1: oldR, y1: oldT, x2: oldR, y2: oldB },
  };

  // Track which walls are updated
  const updatedWalls = (layout.walls || []).map((w) => {
    // Only update interior/unlocked walls that were aligned with the old room
    if (w.isLocked) return w;

    // Check if w was on top edge
    if (areSegmentsOverlapping(w, oldSegments.top, 0.25)) {
      if (!isEdgeSharedWithOther(oldSegments.top)) {
        return {
          ...w,
          y1: newT,
          y2: newT,
          x1: w.x1 + deltaX,
          x2: w.x2 + deltaX + deltaW,
        };
      }
    }
    // Bottom edge
    if (areSegmentsOverlapping(w, oldSegments.bottom, 0.25)) {
      if (!isEdgeSharedWithOther(oldSegments.bottom)) {
        return {
          ...w,
          y1: newB,
          y2: newB,
          x1: w.x1 + deltaX,
          x2: w.x2 + deltaX + deltaW,
        };
      }
    }
    // Left edge
    if (areSegmentsOverlapping(w, oldSegments.left, 0.25)) {
      if (!isEdgeSharedWithOther(oldSegments.left)) {
        return {
          ...w,
          x1: newL,
          x2: newL,
          y1: w.y1 + deltaY,
          y2: w.y2 + deltaY + deltaL,
        };
      }
    }
    // Right edge
    if (areSegmentsOverlapping(w, oldSegments.right, 0.25)) {
      if (!isEdgeSharedWithOther(oldSegments.right)) {
        return {
          ...w,
          x1: newR,
          x2: newR,
          y1: w.y1 + deltaY,
          y2: w.y2 + deltaY + deltaL,
        };
      }
    }

    return w;
  });

  // Track and update doors situated on the old room edges
  const updatedDoors = (layout.doors || []).map((d) => {
    if (d.isLocked) return d;
    // On top edge
    if (Math.abs(d.y - oldT) < 0.4 && d.x >= oldL - 0.5 && d.x <= oldR + 0.5) {
      const relX = (d.x - oldL) / Math.max(0.1, oldRoom.width);
      return {
        ...d,
        y: newT,
        x: Number((newL + relX * newRoom.width).toFixed(2)),
      };
    }
    // On bottom edge
    if (Math.abs(d.y - oldB) < 0.4 && d.x >= oldL - 0.5 && d.x <= oldR + 0.5) {
      const relX = (d.x - oldL) / Math.max(0.1, oldRoom.width);
      return {
        ...d,
        y: newB,
        x: Number((newL + relX * newRoom.width).toFixed(2)),
      };
    }
    // On left edge
    if (Math.abs(d.x - oldL) < 0.4 && d.y >= oldT - 0.5 && d.y <= oldB + 0.5) {
      const relY = (d.y - oldT) / Math.max(0.1, oldRoom.length);
      return {
        ...d,
        x: newL,
        y: Number((newT + relY * newRoom.length).toFixed(2)),
      };
    }
    // On right edge
    if (Math.abs(d.x - oldR) < 0.4 && d.y >= oldT - 0.5 && d.y <= oldB + 0.5) {
      const relY = (d.y - oldT) / Math.max(0.1, oldRoom.length);
      return {
        ...d,
        x: newR,
        y: Number((newT + relY * newRoom.length).toFixed(2)),
      };
    }
    return d;
  });

  // Track and update windows situated on the old room edges
  const updatedWindows = (layout.windows || []).map((win) => {
    if (win.isLocked) return win;
    // On top edge
    if (Math.abs(win.y - oldT) < 0.4 && win.x >= oldL - 0.5 && win.x <= oldR + 0.5) {
      const relX = (win.x - oldL) / Math.max(0.1, oldRoom.width);
      return {
        ...win,
        y: newT,
        x: Number((newL + relX * newRoom.width).toFixed(2)),
      };
    }
    // On bottom edge
    if (Math.abs(win.y - oldB) < 0.4 && win.x >= oldL - 0.5 && win.x <= oldR + 0.5) {
      const relX = (win.x - oldL) / Math.max(0.1, oldRoom.width);
      return {
        ...win,
        y: newB,
        x: Number((newL + relX * newRoom.width).toFixed(2)),
      };
    }
    // On left edge
    if (Math.abs(win.x - oldL) < 0.4 && win.y >= oldT - 0.5 && win.y <= oldB + 0.5) {
      const relY = (win.y - oldT) / Math.max(0.1, oldRoom.length);
      return {
        ...win,
        x: newL,
        y: Number((newT + relY * newRoom.length).toFixed(2)),
      };
    }
    // On right edge
    if (Math.abs(win.x - oldR) < 0.4 && win.y >= oldT - 0.5 && win.y <= oldB + 0.5) {
      const relY = (win.y - oldT) / Math.max(0.1, oldRoom.length);
      return {
        ...win,
        x: newR,
        y: Number((newT + relY * newRoom.length).toFixed(2)),
      };
    }
    return win;
  });

  return {
    ...layout,
    walls: updatedWalls,
    doors: updatedDoors,
    windows: updatedWindows,
  };
}
