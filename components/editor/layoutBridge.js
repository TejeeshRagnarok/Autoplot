/**
 * AutoPlot Layout Bridge
 * Converts the AutoPlot state & Vastu generation calculations into the complete
 * structured 2D architectural LayoutData model, and synchronizes manual edits
 * back to AutoPlot state so that calculations, reports, and master tables reflect edits.
 */

import {
  createDefaultLayout,
  createWall,
  createRoom,
  createDoor,
  createWindow,
  createStaircase,
  createUtility,
  createParking,
  createDimension,
  generateUniqueId,
  WALL_THICKNESS,
  ROOM_PALETTE,
} from './layoutModel';

/**
 * Generates structured LayoutData from AutoPlot state using the Vastu zoning algorithm.
 * @param {object} state - AutoPlot application state
 * @returns {object} structured LayoutData
 */
export function generateStructuredLayoutFromState(state) {
  const siteL = parseFloat(state.siteLength) || 40;
  const siteW = parseFloat(state.siteWidth) || 30;
  let eastO = parseFloat(state.eastOpen) || 2;
  let westO = parseFloat(state.westOpen) || 2;
  let northO = parseFloat(state.northOpen) || 4;
  let southO = parseFloat(state.southOpen) || 4;

  const minFootprintDim = 10.0;
  if (westO + eastO > siteW - minFootprintDim) {
    const totalO = westO + eastO;
    const ratio = (siteW - minFootprintDim) / Math.max(0.1, totalO);
    westO *= ratio;
    eastO *= ratio;
  }
  if (northO + southO > siteL - minFootprintDim) {
    const totalO = northO + southO;
    const ratio = (siteL - minFootprintDim) / Math.max(0.1, totalO);
    northO *= ratio;
    southO *= ratio;
  }

  const footW = siteW - eastO - westO;
  const footL = siteL - northO - southO;
  const footX = westO;
  const footY = northO;

  const layout = createDefaultLayout({
    siteWidth: siteW,
    siteLength: siteL,
    eastOpen: eastO,
    westOpen: westO,
    northOpen: northO,
    southOpen: southO,
    siteFacing: state.siteFacing,
    roadDirection: state.roadDirection,
    compassAngle: state.compassAngle,
    ownerName: state.ownerName,
    title: `${state.ownerName || 'AutoPlot'}'s Residence Plan`,
  });

  const mainDoorDir = state.mainDoorDirection || 'North';
  let entRow = 1;
  let entCol = 1;
  if (mainDoorDir === 'North') { entRow = 0; entCol = 1; }
  else if (mainDoorDir === 'South') { entRow = 2; entCol = 1; }
  else if (mainDoorDir === 'East') { entRow = 1; entCol = 2; }
  else if (mainDoorDir === 'West') { entRow = 1; entCol = 0; }

  // 3x3 Vastu Grid
  const grid = [
    [[], [], []],
    [[], [], []],
    [[], [], []]
  ];
  const reservedCells = [`1,1`, `${entRow},${entCol}`];

  const customRooms = [...(state.customRooms || [])];
  const poojaRoom = customRooms.find(r => r.name.toLowerCase().includes("pooja"));
  const kitchenRoom = customRooms.find(r => r.name.toLowerCase().includes("kitchen"));
  const masterBed = customRooms.find(r => r.name.toLowerCase().includes("master"));
  const diningRoom = customRooms.find(r => r.name.toLowerCase().includes("dining"));

  const otherRooms = customRooms.filter(r => 
    r.id !== poojaRoom?.id && 
    r.id !== kitchenRoom?.id && 
    r.id !== masterBed?.id && 
    r.id !== diningRoom?.id
  );

  // Vastu Placements:
  // NE (0, 2) -> Pooja
  if (poojaRoom) {
    grid[0][2].push({
      id: poojaRoom.id,
      name: poojaRoom.name,
      reqW: parseFloat(poojaRoom.width) || 8,
      reqH: parseFloat(poojaRoom.length) || 8,
    });
  }
  // SE (2, 2) -> Kitchen
  if (kitchenRoom) {
    grid[2][2].push({
      id: kitchenRoom.id,
      name: kitchenRoom.name,
      reqW: parseFloat(kitchenRoom.width) || 10,
      reqH: parseFloat(kitchenRoom.length) || 8,
    });
  }
  // SW (2, 0) -> Master Bed
  if (masterBed) {
    grid[2][0].push({
      id: masterBed.id,
      name: masterBed.name,
      reqW: parseFloat(masterBed.width) || 12,
      reqH: parseFloat(masterBed.length) || 10,
    });
  }
  // E (1, 2) -> Dining
  if (diningRoom) {
    grid[1][2].push({
      id: diningRoom.id,
      name: diningRoom.name,
      reqW: parseFloat(diningRoom.width) || 10,
      reqH: parseFloat(diningRoom.length) || 8,
    });
    reservedCells.push(`1,2`);
  }

  // Allocate remaining rooms
  const isPrivate = (n) => {
    const s = (n || '').toLowerCase();
    return s.includes("bedroom") || s.includes("toilet") || s.includes("bathroom") || s.includes("wc") || s.includes("pooja");
  };

  const assignToSlot = (roomObj, preferredSlots) => {
    let placed = false;
    for (const [r, c] of preferredSlots) {
      const key = `${r},${c}`;
      if (!reservedCells.includes(key) && grid[r][c].length === 0) {
        grid[r][c].push(roomObj);
        placed = true;
        break;
      }
    }
    if (!placed) {
      let minCount = Infinity, bestR = -1, bestC = -1;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (reservedCells.includes(`${r},${c}`)) continue;
          if (grid[r][c].length < minCount) {
            minCount = grid[r][c].length;
            bestR = r; bestC = c;
          }
        }
      }
      if (bestR !== -1 && bestC !== -1) {
        grid[bestR][bestC].push(roomObj);
      }
    }
  };

  otherRooms.forEach(room => {
    const parsed = {
      id: room.id,
      name: room.name,
      reqW: parseFloat(room.width) || 8,
      reqH: parseFloat(room.length) || 8,
    };
    if (isPrivate(room.name)) {
      assignToSlot(parsed, [[0, 0], [1, 0], [2, 1], [0, 1]]);
    } else {
      assignToSlot(parsed, [[0, 1], [1, 0], [2, 1], [0, 0]]);
    }
  });

  const getColMaxW = (c) => {
    let max = 0;
    for (let r = 0; r < 3; r++) {
      grid[r][c].forEach(rm => { if (rm.reqW > max) max = rm.reqW; });
    }
    return max || 8;
  };
  const getRowMaxH = (r) => {
    let max = 0;
    for (let c = 0; c < 3; c++) {
      grid[r][c].forEach(rm => { if (rm.reqH > max) max = rm.reqH; });
    }
    return max || 8;
  };

  let colW = [getColMaxW(0), getColMaxW(1), getColMaxW(2)];
  let rowH = [getRowMaxH(0), getRowMaxH(1), getRowMaxH(2)];

  const sumW = colW[0] + colW[1] + colW[2];
  const colScale = footW / Math.max(1, sumW);
  const colW_scaled = colW.map(w => w * colScale);

  const sumH = rowH[0] + rowH[1] + rowH[2];
  const rowScale = footL / Math.max(1, sumH);
  const rowH_scaled = rowH.map(h => h * rowScale);

  const colX = [footX, footX + colW_scaled[0], footX + colW_scaled[0] + colW_scaled[1]];
  const rowY = [footY, footY + rowH_scaled[0], footY + rowH_scaled[0] + rowH_scaled[1]];

  const blocks = [];
  const corridorWidth = 3.0;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 1 && c === 1) continue;
      if (r === entRow && c === entCol) continue;

      const cellRooms = grid[r][c];
      const cellX = colX[c];
      const cellY = rowY[r];
      const cellW = colW_scaled[c];
      const cellH = rowH_scaled[r];

      if (cellRooms.length === 0) continue;

      if (cellRooms.length === 1) {
        let x = cellX, y = cellY, w = cellW, h = cellH;
        if (r === 1 && c === 0) { w = Math.max(4.0, cellW - corridorWidth); }
        else if (r === 1 && c === 2) { w = Math.max(4.0, cellW - corridorWidth); x = cellX + corridorWidth; }
        else if (r === 0 && c === 1) { h = Math.max(4.0, cellH - corridorWidth); }
        else if (r === 2 && c === 1) { h = Math.max(4.0, cellH - corridorWidth); y = cellY + corridorWidth; }

        blocks.push({
          id: cellRooms[0].id,
          name: cellRooms[0].name,
          x, y, width: w, length: h,
          gridRow: r, gridCol: c
        });
      } else {
        const count = cellRooms.length;
        if (cellW > cellH) {
          const subW = cellW / count;
          cellRooms.forEach((rm, idx) => {
            let x = cellX + idx * subW, y = cellY, w = subW, h = cellH;
            if (r === 1 && c === 0) { w = Math.max(3.0, subW - corridorWidth); }
            else if (r === 1 && c === 2) { w = Math.max(3.0, subW - corridorWidth); x = cellX + idx * subW + corridorWidth; }
            else if (r === 0 && c === 1) { h = Math.max(3.0, cellH - corridorWidth); }
            else if (r === 2 && c === 1) { h = Math.max(3.0, cellH - corridorWidth); y = cellY + corridorWidth; }

            blocks.push({
              id: rm.id,
              name: rm.name,
              x, y, width: w, length: h,
              gridRow: r, gridCol: c
            });
          });
        } else {
          const subH = cellH / count;
          cellRooms.forEach((rm, idx) => {
            let x = cellX, y = cellY + idx * subH, w = cellW, h = subH;
            if (r === 1 && c === 0) { w = Math.max(3.0, cellW - corridorWidth); }
            else if (r === 1 && c === 2) { w = Math.max(3.0, cellW - corridorWidth); x = cellX + corridorWidth; }
            else if (r === 0 && c === 1) { h = Math.max(3.0, subH - corridorWidth); }
            else if (r === 2 && c === 1) { h = Math.max(3.0, subH - corridorWidth); y = cellY + idx * subH + corridorWidth; }

            blocks.push({
              id: rm.id,
              name: rm.name,
              x, y, width: w, length: h,
              gridRow: r, gridCol: c
            });
          });
        }
      }
    }
  }

  // Unified Living Room (Hall)
  let hallX = colX[1], hallY = rowY[1], hallW = colW_scaled[1], hallH = rowH_scaled[1];
  if (mainDoorDir === 'North') {
    hallY = rowY[0];
    hallH = rowH_scaled[0] + rowH_scaled[1];
  } else if (mainDoorDir === 'South') {
    hallH = rowH_scaled[1] + rowH_scaled[2];
  } else if (mainDoorDir === 'East') {
    hallW = colW_scaled[1] + colW_scaled[2];
  } else if (mainDoorDir === 'West') {
    hallX = colX[0];
    hallW = colW_scaled[0] + colW_scaled[1];
  }

  const hallRoom = {
    id: 'room-living-hall',
    name: 'Living Room (Hall)',
    label: 'Living Room',
    x: hallX,
    y: hallY,
    width: hallW,
    length: hallH,
    color: '#EFF6FF',
    gridRow: 1,
    gridCol: 1,
  };
  blocks.push(hallRoom);

  // Convert blocks into layout rooms
  layout.rooms = blocks.map((b, idx) => {
    return createRoom({
      id: b.id || generateUniqueId('room'),
      name: b.name,
      label: b.name,
      x: Number(b.x.toFixed(2)),
      y: Number(b.y.toFixed(2)),
      width: Number(b.width.toFixed(2)),
      length: Number(b.length.toFixed(2)),
      color: ROOM_PALETTE[idx % ROOM_PALETTE.length],
    });
  });

  // Exterior Perimeter Walls (9" thick)
  layout.walls.push(createWall({
    id: 'wall-ext-north',
    type: 'exterior',
    x1: footX, y1: footY,
    x2: footX + footW, y2: footY,
    thickness: WALL_THICKNESS.EXTERIOR,
  }));
  layout.walls.push(createWall({
    id: 'wall-ext-east',
    type: 'exterior',
    x1: footX + footW, y1: footY,
    x2: footX + footW, y2: footY + footL,
    thickness: WALL_THICKNESS.EXTERIOR,
  }));
  layout.walls.push(createWall({
    id: 'wall-ext-south',
    type: 'exterior',
    x1: footX + footW, y1: footY + footL,
    x2: footX, y2: footY + footL,
    thickness: WALL_THICKNESS.EXTERIOR,
  }));
  layout.walls.push(createWall({
    id: 'wall-ext-west',
    type: 'exterior',
    x1: footX, y1: footY + footL,
    x2: footX, y2: footY,
    thickness: WALL_THICKNESS.EXTERIOR,
  }));

  // Interior Walls (4.5" thick) from Room Boundaries
  layout.rooms.forEach(room => {
    if (room.id === 'room-living-hall') return;
    const rL = room.x;
    const rR = room.x + room.width;
    const rT = room.y;
    const rB = room.y + room.length;

    // Check if not coinciding with exterior footprint
    if (Math.abs(rT - footY) > 0.2) {
      layout.walls.push(createWall({
        id: generateUniqueId('wall-int'),
        type: 'interior',
        x1: rL, y1: rT, x2: rR, y2: rT,
        thickness: WALL_THICKNESS.INTERIOR,
      }));
    }
    if (Math.abs(rB - (footY + footL)) > 0.2) {
      layout.walls.push(createWall({
        id: generateUniqueId('wall-int'),
        type: 'interior',
        x1: rL, y1: rB, x2: rR, y2: rB,
        thickness: WALL_THICKNESS.INTERIOR,
      }));
    }
    if (Math.abs(rL - footX) > 0.2) {
      layout.walls.push(createWall({
        id: generateUniqueId('wall-int'),
        type: 'interior',
        x1: rL, y1: rT, x2: rL, y2: rB,
        thickness: WALL_THICKNESS.INTERIOR,
      }));
    }
    if (Math.abs(rR - (footX + footW)) > 0.2) {
      layout.walls.push(createWall({
        id: generateUniqueId('wall-int'),
        type: 'interior',
        x1: rR, y1: rT, x2: rR, y2: rB,
        thickness: WALL_THICKNESS.INTERIOR,
      }));
    }
  });

  // Deduplicate interior walls
  const dedupedWalls = [];
  layout.walls.forEach(w => {
    const isDup = dedupedWalls.some(ex => {
      if (Math.abs(w.x1 - ex.x1) < 0.2 && Math.abs(w.y1 - ex.y1) < 0.2 &&
          Math.abs(w.x2 - ex.x2) < 0.2 && Math.abs(w.y2 - ex.y2) < 0.2) return true;
      if (Math.abs(w.x1 - ex.x2) < 0.2 && Math.abs(w.y1 - ex.y2) < 0.2 &&
          Math.abs(w.x2 - ex.x1) < 0.2 && Math.abs(w.y2 - ex.y1) < 0.2) return true;
      return false;
    });
    if (!isDup) dedupedWalls.push(w);
  });
  layout.walls = dedupedWalls;

  // Doors Placement
  layout.rooms.forEach(room => {
    if (room.id === 'room-living-hall') return;
    const isBath = room.name.toLowerCase().includes("toilet") || room.name.toLowerCase().includes("bath");
    const doorW = isBath ? 2.3 : 2.8;

    // Place door facing hall
    const dX = Number((room.x + room.width / 2).toFixed(2));
    const dY = Number(room.y.toFixed(2));

    layout.doors.push(createDoor({
      id: generateUniqueId('door'),
      x: dX,
      y: dY,
      width: doorW,
      swing: 'inward',
      hinge: 'left',
      type: 'single',
      isBathroom: isBath,
    }));
  });

  // Main Entrance Door on Hall outer wall
  let mdX = footX + footW / 2;
  let mdY = footY;
  if (mainDoorDir === 'South') { mdY = footY + footL; }
  else if (mainDoorDir === 'East') { mdX = footX + footW; mdY = footY + footL / 2; }
  else if (mainDoorDir === 'West') { mdX = footX; mdY = footY + footL / 2; }

  layout.doors.push(createDoor({
    id: 'door-main-entrance',
    x: Number(mdX.toFixed(2)),
    y: Number(mdY.toFixed(2)),
    width: 3.8,
    swing: 'inward',
    hinge: 'right',
    type: 'double',
    isMain: true,
  }));

  // Windows Placement along outer walls
  layout.rooms.forEach(room => {
    const isBath = room.name.toLowerCase().includes("toilet") || room.name.toLowerCase().includes("bath");
    const isKit = room.name.toLowerCase().includes("kitchen");
    const winW = isBath ? 2.0 : (isKit ? 3.5 : 4.0);

    // North exterior
    if (Math.abs(room.y - footY) < 0.3 && northO > 0) {
      layout.windows.push(createWindow({
        id: generateUniqueId('win'),
        x: Number((room.x + room.width / 2).toFixed(2)),
        y: footY,
        width: winW,
        isBathroom: isBath,
        isKitchen: isKit,
      }));
    }
    // South exterior
    if (Math.abs((room.y + room.length) - (footY + footL)) < 0.3 && southO > 0) {
      layout.windows.push(createWindow({
        id: generateUniqueId('win'),
        x: Number((room.x + room.width / 2).toFixed(2)),
        y: footY + footL,
        width: winW,
        isBathroom: isBath,
        isKitchen: isKit,
      }));
    }
    // West exterior
    if (Math.abs(room.x - footX) < 0.3 && westO > 0) {
      layout.windows.push(createWindow({
        id: generateUniqueId('win'),
        x: footX,
        y: Number((room.y + room.length / 2).toFixed(2)),
        width: winW,
        isBathroom: isBath,
        isKitchen: isKit,
      }));
    }
    // East exterior
    if (Math.abs((room.x + room.width) - (footX + footW)) < 0.3 && eastO > 0) {
      layout.windows.push(createWindow({
        id: generateUniqueId('win'),
        x: footX + footW,
        y: Number((room.y + room.length / 2).toFixed(2)),
        width: winW,
        isBathroom: isBath,
        isKitchen: isKit,
      }));
    }
  });

  // Utilities in setbacks
  const getUtilCoord = (loc, size = 3.5) => {
    const pad = 1.0;
    const rX = siteW - eastO - size - pad;
    const bY = siteL - southO - size - pad;
    if (!loc) return { x: pad, y: pad };
    if (loc.includes("Northeast")) return { x: siteW - size - pad, y: pad };
    if (loc.includes("Southeast")) return { x: siteW - size - pad, y: siteL - size - pad };
    if (loc.includes("Southwest")) return { x: pad, y: siteL - size - pad };
    if (loc.includes("Northwest")) return { x: pad, y: pad };
    return { x: pad, y: pad };
  };

  if (state.sumpLocation) {
    const c = getUtilCoord(state.sumpLocation, 3.5);
    layout.utilities.push(createUtility({
      id: 'util-sump',
      type: 'sump',
      name: 'Water Sump',
      x: Number(c.x.toFixed(2)),
      y: Number(c.y.toFixed(2)),
      width: 4.0, length: 3.5,
    }));
  }

  if (state.boreLocation) {
    const c = getUtilCoord(state.boreLocation, 2.5);
    layout.utilities.push(createUtility({
      id: 'util-bore',
      type: 'bore',
      name: 'Borewell',
      x: Number(c.x.toFixed(2)),
      y: Number((c.y + 4.5).toFixed(2)),
      width: 2.5, length: 2.5,
    }));
  }

  if (state.septicLocation) {
    const c = getUtilCoord(state.septicLocation, 4.0);
    layout.utilities.push(createUtility({
      id: 'util-septic',
      type: 'septic',
      name: 'Septic Tank',
      x: Number(c.x.toFixed(2)),
      y: Number(c.y.toFixed(2)),
      width: 4.5, length: 3.5,
    }));
  }

  // Staircase in setback or SW
  if (state.stairsLocation) {
    const c = getUtilCoord(state.stairsLocation, 6.0);
    layout.staircases.push(createStaircase({
      id: 'stair-external',
      x: Number(c.x.toFixed(2)),
      y: Number(c.y.toFixed(2)),
      width: 6.0,
      length: 9.0,
      label: 'STAIRCASE',
    }));
  }

  // Exterior Dimension lines for plot & setbacks
  layout.dimensions.push(createDimension({
    id: 'dim-plot-width',
    x1: 0, y1: -2,
    x2: siteW, y2: -2,
    offset: 2,
    label: `${siteW}' 0" (Plot Width)`,
  }));
  layout.dimensions.push(createDimension({
    id: 'dim-plot-length',
    x1: -2, y1: 0,
    x2: -2, y2: siteL,
    offset: 2,
    label: `${siteL}' 0" (Plot Length)`,
  }));

  return layout;
}

/**
 * Synchronize edited layout back into the AutoPlot parent state
 * Updates customRooms dimensions and setbacks so Aya-Vyaya tables, PDF reports,
 * and calculations immediately reflect the user's manual edits!
 * @param {object} layout - Edited LayoutData
 * @param {object} currentState - AutoPlot state
 * @returns {object} Updated AutoPlot state
 */
export function syncLayoutToState(layout, currentState) {
  if (!layout || !layout.rooms) return currentState;

  // Map edited rooms back to customRooms
  const updatedCustomRooms = (currentState.customRooms || []).map(cr => {
    // Match by ID or Name
    const matchingEdited = layout.rooms.find(r => r.id === cr.id || r.name.toLowerCase() === cr.name.toLowerCase());
    if (matchingEdited) {
      return {
        ...cr,
        name: matchingEdited.name || cr.name,
        width: String(Number(matchingEdited.width.toFixed(2))),
        length: String(Number(matchingEdited.length.toFixed(2))),
      };
    }
    return cr;
  });

  // Check if new rooms were added in the editor that weren't in customRooms
  layout.rooms.forEach(er => {
    if (er.id === 'room-living-hall') return; // skip default hall
    const exists = updatedCustomRooms.some(cr => cr.id === er.id || cr.name.toLowerCase() === er.name.toLowerCase());
    if (!exists) {
      updatedCustomRooms.push({
        id: er.id,
        name: er.name || 'New Room',
        width: String(Number(er.width.toFixed(2))),
        length: String(Number(er.length.toFixed(2))),
      });
    }
  });

  // Check if any rooms were deleted in editor
  const filteredCustomRooms = updatedCustomRooms.filter(cr => {
    const stillInLayout = layout.rooms.some(er => er.id === cr.id || er.name.toLowerCase() === cr.name.toLowerCase());
    return stillInLayout;
  });

  const nextState = {
    ...currentState,
    siteWidth: layout.plot ? String(layout.plot.width) : currentState.siteWidth,
    siteLength: layout.plot ? String(layout.plot.length) : currentState.siteLength,
    eastOpen: layout.plot?.setbacks ? String(layout.plot.setbacks.east) : currentState.eastOpen,
    westOpen: layout.plot?.setbacks ? String(layout.plot.setbacks.west) : currentState.westOpen,
    northOpen: layout.plot?.setbacks ? String(layout.plot.setbacks.north) : currentState.northOpen,
    southOpen: layout.plot?.setbacks ? String(layout.plot.setbacks.south) : currentState.southOpen,
    customRooms: filteredCustomRooms.length > 0 ? filteredCustomRooms : updatedCustomRooms,
    lastEditedLayout: layout,
  };

  return nextState;
}
