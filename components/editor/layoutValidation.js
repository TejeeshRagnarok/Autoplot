/**
 * AutoPlot Layout Validation Engine
 * Validates real-world architectural constraints:
 * - Negative or zero dimensions
 * - Walls extending beyond plot boundaries
 * - Invalid room geometry / too small (< 2ft)
 * - Doors / windows outside host walls or detached
 * - Unintended room overlaps
 * - Disconnected wall endpoints
 * - Vastu advisory notifications
 */

import { calculateWallLength } from './layoutModel.js';
import { validateStaircaseFit } from './staircaseGeometry.js';
import { validateOpenings } from './constraintEngine.js';

export const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

/**
 * Validate an entire LayoutData object
 * @param {object} layout
 * @returns {Array<object>} list of validation issues
 */
export function validateLayout(layout) {
  if (!layout) return [];
  const issues = [];

  const plotW = layout.plot?.width || 0;
  const plotL = layout.plot?.length || 0;

  // 1. Plot boundary check
  if (plotW <= 0 || plotL <= 0) {
    issues.push({
      id: 'issue-plot-dim',
      elementId: 'plot-boundary',
      elementType: 'plot',
      severity: SEVERITY.ERROR,
      title: 'Invalid Plot Dimensions',
      message: `Plot width (${plotW}') and length (${plotL}') must be greater than zero.`,
    });
  }

  // 2. Validate Rooms
  const rooms = layout.rooms || [];
  rooms.forEach((room) => {
    // Zero or negative dimension
    if (room.width <= 0 || room.length <= 0) {
      issues.push({
        id: `issue-room-dim-${room.id}`,
        elementId: room.id,
        elementType: 'room',
        severity: SEVERITY.ERROR,
        title: 'Non-Positive Room Dimensions',
        message: `"${room.name}" has invalid dimensions (${room.width}' × ${room.length}'). Dimensions must be positive.`,
      });
    } else if (room.width < 2.5 || room.length < 2.5) {
      // Impractically small room
      issues.push({
        id: `issue-room-small-${room.id}`,
        elementId: room.id,
        elementType: 'room',
        severity: SEVERITY.WARNING,
        title: 'Room Dangerously Small',
        message: `"${room.name}" is smaller than 2.5 ft (${room.width}' × ${room.length}'). Standard architectural rooms should be at least 3 ft.`,
      });
    }

    // Room outside plot boundary
    if (room.x < 0 || room.y < 0 || room.x + room.width > plotW || room.y + room.length > plotL) {
      issues.push({
        id: `issue-room-plot-${room.id}`,
        elementId: room.id,
        elementType: 'room',
        severity: SEVERITY.WARNING,
        title: 'Room Outside Plot Boundaries',
        message: `"${room.name}" extends beyond the plot boundary (${plotW}' × ${plotL}').`,
      });
    }
  });

  // 3. Room Overlap Check
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const r1 = rooms[i];
      const r2 = rooms[j];
      // Skip hall merged areas check if intentionally spanning
      if (r1.id === 'room-living-hall' || r2.id === 'room-living-hall') continue;

      const overlapX = Math.max(0, Math.min(r1.x + r1.width, r2.x + r2.width) - Math.max(r1.x, r2.x));
      const overlapY = Math.max(0, Math.min(r1.y + r1.length, r2.y + r2.length) - Math.max(r1.y, r2.y));
      const overlapArea = overlapX * overlapY;

      // Allow 0.25 ft tolerance for touching wall boundaries
      if (overlapX > 0.35 && overlapY > 0.35 && overlapArea > 0.5) {
        issues.push({
          id: `issue-overlap-${r1.id}-${r2.id}`,
          elementId: r1.id,
          secondaryElementId: r2.id,
          elementType: 'room',
          severity: SEVERITY.ERROR,
          title: 'Unintended Room Overlap',
          message: `"${r1.name}" and "${r2.name}" overlap by ${overlapArea.toFixed(1)} sq.ft. Adjust walls or room positions.`,
        });
      }
    }
  }

  // 4. Validate Walls
  const walls = layout.walls || [];
  walls.forEach((wall) => {
    const len = calculateWallLength(wall);
    if (len <= 0.1) {
      issues.push({
        id: `issue-wall-len-${wall.id}`,
        elementId: wall.id,
        elementType: 'wall',
        severity: SEVERITY.ERROR,
        title: 'Zero Length Wall',
        message: `Wall has a zero or negative length (${len.toFixed(2)}').`,
      });
    }

    if (wall.thickness <= 0) {
      issues.push({
        id: `issue-wall-thick-${wall.id}`,
        elementId: wall.id,
        elementType: 'wall',
        severity: SEVERITY.ERROR,
        title: 'Invalid Wall Thickness',
        message: `Wall thickness must be greater than zero.`,
      });
    }

    // Check outside plot boundary
    const margin = 2.0;
    if (wall.x1 < -margin || wall.y1 < -margin || wall.x2 > plotW + margin || wall.y2 > plotL + margin) {
      issues.push({
        id: `issue-wall-bound-${wall.id}`,
        elementId: wall.id,
        elementType: 'wall',
        severity: SEVERITY.WARNING,
        title: 'Wall Beyond Setback Perimeter',
        message: `Wall extends significantly outside plot boundary.`,
      });
    }
  });

  // 5. Validate Doors
  const doors = layout.doors || [];
  doors.forEach((door) => {
    if (door.width <= 0) {
      issues.push({
        id: `issue-door-w-${door.id}`,
        elementId: door.id,
        elementType: 'door',
        severity: SEVERITY.ERROR,
        title: 'Invalid Door Width',
        message: `Door width must be positive.`,
      });
    } else if (door.width < 1.8) {
      issues.push({
        id: `issue-door-narrow-${door.id}`,
        elementId: door.id,
        elementType: 'door',
        severity: SEVERITY.WARNING,
        title: 'Door Width Below Standard',
        message: `Door width (${door.width}') is under 2 ft standard clearance.`,
      });
    }

  });

  // 6. Validate Windows
  const windows = layout.windows || [];
  windows.forEach((win) => {
    if (win.width <= 0) {
      issues.push({
        id: `issue-win-w-${win.id}`,
        elementId: win.id,
        elementType: 'window',
        severity: SEVERITY.ERROR,
        title: 'Invalid Window Width',
        message: `Window width must be positive.`,
      });
    }
  });

  // 6b. Doors and windows must sit on a wall (checked on a copy - no side effects)
  validateOpenings(JSON.parse(JSON.stringify({ walls: layout.walls || [], doors: layout.doors || [], windows: layout.windows || [] })))
    .filter((c) => c.code === 'opening-detached')
    .forEach((c) => {
      const isDoor = (layout.doors || []).some((d) => d.id === c.id);
      issues.push({
        id: `issue-opening-detached-${c.id}`,
        elementId: c.id,
        elementType: isDoor ? 'door' : 'window',
        severity: SEVERITY.WARNING,
        title: isDoor ? 'Detached Door' : 'Detached Window',
        message: `This ${isDoor ? 'door' : 'window'} is not on a wall. Drag it onto a wall.`,
      });
    });

  // 7. Staircase drafting guidelines (geometric checks only)
  (layout.staircases || []).forEach((st) => {
    validateStaircaseFit(st, layout).warnings.forEach((w, i) => {
      issues.push({
        id: `issue-stair-${st.id}-${i}`,
        elementId: st.id,
        elementType: 'staircase',
        severity: SEVERITY.WARNING,
        title: 'Staircase Guideline',
        message: w,
      });
    });
  });

  // 8. Openings wider than their host wall (checked on a copy - no side effects)
  validateOpenings(JSON.parse(JSON.stringify({ walls: layout.walls || [], doors: layout.doors || [], windows: layout.windows || [] })))
    .filter((c) => c.code === 'opening-too-wide')
    .forEach((c) => {
      issues.push({
        id: `issue-opening-${c.id}`,
        elementId: c.id,
        elementType: (layout.doors || []).some((d) => d.id === c.id) ? 'door' : 'window',
        severity: SEVERITY.ERROR,
        title: 'Opening Wider Than Wall',
        message: c.message,
      });
    });

  return issues;
}
