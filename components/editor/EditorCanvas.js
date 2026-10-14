/**
 * AutoPlot Interactive 2D Architectural CAD Canvas
 * Features:
 * - Real world coordinates (feet) <-> screen pixel transformation
 * - Mouse wheel zoom centered at cursor & mouse drag panning
 * - Rulers (Top & Left) with real-world unit tick marks
 * - Grid with toggleable snap-to-grid
 * - Hit detection and selection for all architectural elements
 * - Live interactive handles (Wall endpoints, Room resize corners, Door/Win sliders)
 * - Drawing tools: Draw Wall, Add Room, Add Door, Add Window, Add Staircase, Add Column, Measure Distance
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import {
  calculateWallLength,
  calculateWallAngle,
  pointToSegmentDistance,
  snapValue,
  createWall,
  createRoom,
  createDoor,
  createWindow,
  createStaircase,
  createColumn,
  createParking,
  createUtility,
  generateUniqueId,
  cloneLayout,
  getWallOrientation,
  translateWall,
  moveWallEndpoint,
  moveConnectedEndpoints,
  findEndpointSnap,
  findAlignmentGuides,
  getPlotDimensionMeta,
  syncPlotDimensions,
  resizePlot,
} from './layoutModel';
import { formatMeasurement, formatArea, parseToFeet } from './units';

export default function EditorCanvas({
  layout,
  onUpdateLayout,
  selectedElement,
  onSelectElement,
  activeTool = 'select',
  unit = 'ft-in',
  showGrid = true,
  snapEnabled = true,
  snapStep = 0.5, // 0.5 ft = 6 inches
  showDimensions = true,
  onCursorMove,
  historyManager,
  allowDiagonal = false,
  snapTolerance = 0.75,
  onRequestPlotResize,
}) {
  const containerRef = useRef(null);
  const dimInputRef = useRef(null);

  // Viewport transformation: scale (px per foot), pan offset (px)
  const [viewport, setViewport] = useState({
    scale: 18, // 18px per foot default
    panX: 120,
    panY: 80,
  });

  const [mouseWorldPos, setMouseWorldPos] = useState({ x: 0, y: 0 });

  // Interaction State
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggingHandle, setDraggingHandle] = useState(null); // 'wall-p1' | 'wall-p2' | 'room-br' | 'element-body' | 'dimension-line'
  const [dragStartInfo, setDragStartInfo] = useState(null);
  const [alignmentGuides, setAlignmentGuides] = useState([]);

  // Inline dimension label editing (Mode B)
  const [editingDim, setEditingDim] = useState(null); // { axis, value, screenX, screenY }
  const [dimInputValue, setDimInputValue] = useState('');

  // Drawing Tools State
  const [wallDrawStart, setWallDrawStart] = useState(null); // { x, y }
  const [roomDrawStart, setRoomDrawStart] = useState(null);
  const [measureStart, setMeasureStart] = useState(null);

  // Convert World Coordinates (ft) to Screen Pixels
  const worldToScreen = useCallback((wx, wy) => {
    return {
      x: wx * viewport.scale + viewport.panX,
      y: wy * viewport.scale + viewport.panY,
    };
  }, [viewport]);

  // Convert Screen Pixels to World Coordinates (ft)
  const screenToWorld = useCallback((sx, sy) => {
    return {
      x: (sx - viewport.panX) / viewport.scale,
      y: (sy - viewport.panY) / viewport.scale,
    };
  }, [viewport]);

  // Snap to grid if enabled
  const snap = useCallback((val) => {
    if (!snapEnabled) return val;
    return snapValue(val, snapStep);
  }, [snapEnabled, snapStep]);

  // Auto-fit drawing to screen on initial mount
  const fitToScreen = useCallback(() => {
    if (!containerRef.current || !layout) return;
    const rect = containerRef.current.getBoundingClientRect();
    const plotW = layout.plot?.width || 30;
    const plotL = layout.plot?.length || 40;

    const availableW = Math.max(200, rect.width - 160);
    const availableH = Math.max(200, rect.height - 160);

    const scaleX = availableW / plotW;
    const scaleY = availableH / plotL;
    const newScale = Math.min(scaleX, scaleY, 28);

    const newPanX = (rect.width - plotW * newScale) / 2;
    const newPanY = (rect.height - plotL * newScale) / 2;

    setViewport({
      scale: Math.max(8, newScale),
      panX: newPanX,
      panY: newPanY,
    });
  }, [layout]);

  useEffect(() => {
    // Initial auto-fit
    const timer = setTimeout(fitToScreen, 100);
    return () => clearTimeout(timer);
  }, []);

  // Expose fitToScreen via global event or window if needed
  useEffect(() => {
    const handleFit = () => fitToScreen();
    if (typeof window !== 'undefined') {
      window.addEventListener('autoplot-fit-screen', handleFit);
      return () => window.removeEventListener('autoplot-fit-screen', handleFit);
    }
  }, [fitToScreen]);

  // Mouse Wheel Zoom centered at cursor
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.max(6, Math.min(80, viewport.scale * zoomFactor));

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseScreenX = e.clientX - rect.left;
    const mouseScreenY = e.clientY - rect.top;

    // Zoom centered at mouse cursor
    const mouseWorld = screenToWorld(mouseScreenX, mouseScreenY);
    const newPanX = mouseScreenX - mouseWorld.x * newScale;
    const newPanY = mouseScreenY - mouseWorld.y * newScale;

    setViewport({
      scale: newScale,
      panX: newPanX,
      panY: newPanY,
    });
  };

  // Hit-testing to select elements
  const findElementAtWorldPoint = (wx, wy) => {
    if (!layout) return null;

    // 1. Check doors first
    for (const d of layout.doors || []) {
      const dist = Math.hypot(wx - d.x, wy - d.y);
      if (dist < 2.0) return { type: 'door', data: d };
    }

    // 2. Check windows
    for (const w of layout.windows || []) {
      const dist = Math.hypot(wx - w.x, wy - w.y);
      if (dist < 2.0) return { type: 'window', data: w };
    }

    // 3. Check utilities
    for (const u of layout.utilities || []) {
      if (wx >= u.x && wx <= u.x + u.width && wy >= u.y && wy <= u.y + u.length) {
        return { type: 'utility', data: u };
      }
    }

    // 4. Check staircases
    for (const s of layout.staircases || []) {
      if (wx >= s.x && wx <= s.x + s.width && wy >= s.y && wy <= s.y + s.length) {
        return { type: 'staircase', data: s };
      }
    }

    // 5. Check parking
    for (const p of layout.parking || []) {
      if (wx >= p.x && wx <= p.x + p.width && wy >= p.y && wy <= p.y + p.length) {
        return { type: 'parking', data: p };
      }
    }

    // 6. Check columns
    for (const c of layout.columns || []) {
      const dist = Math.hypot(wx - c.x, wy - c.y);
      if (dist < 1.5) return { type: 'column', data: c };
    }

    // 7. Check walls (point to segment distance)
    for (const wall of layout.walls || []) {
      const res = pointToSegmentDistance(wx, wy, wall.x1, wall.y1, wall.x2, wall.y2);
      if (res.distance < (wall.thickness || 0.75) + 0.5) {
        return { type: 'wall', data: wall };
      }
    }

    // 8. Check rooms
    for (const r of layout.rooms || []) {
      if (wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.length) {
        return { type: 'room', data: r };
      }
    }

    // 9. Check plot boundary
    const plotW = layout.plot?.width || 30;
    const plotL = layout.plot?.length || 40;
    if (wx >= 0 && wx <= plotW && wy >= 0 && wy <= plotL) {
      return { type: 'plot', data: layout.plot };
    }

    return null;
  };

  // ---- Outer plot dimension annotation helpers (width / height lines) ----
  const getDimLabelWorld = (axis) => {
    const W = layout?.plot?.width || 30;
    const L = layout?.plot?.length || 40;
    const meta = getPlotDimensionMeta(layout, axis);
    if (axis === 'width') return { x: W / 2, y: -meta.offset };
    return { x: -meta.offset, y: L / 2 };
  };

  const findDimensionAtWorldPoint = (wx, wy) => {
    if (!layout?.plot) return null;
    const W = layout.plot.width || 30;
    const L = layout.plot.length || 40;
    const w = getPlotDimensionMeta(layout, 'width');
    const l = getPlotDimensionMeta(layout, 'length');

    const clickScr = worldToScreen(wx, wy);
    const isLabel = (axis) => {
      const lw = getDimLabelWorld(axis);
      const scr = worldToScreen(lw.x, lw.y);
      return Math.abs(clickScr.x - scr.x) <= 38 && Math.abs(clickScr.y - scr.y) <= 13;
    };

    const lineTol = 1.1;
    if (wy > -w.offset - lineTol && wy < -w.offset + lineTol && wx > -lineTol && wx < W + lineTol) {
      return { axis: 'width', meta: w, onLabel: isLabel('width') };
    }
    if (wx > -l.offset - lineTol && wx < -l.offset + lineTol && wy > -lineTol && wy < L + lineTol) {
      return { axis: 'length', meta: l, onLabel: isLabel('length') };
    }
    return null;
  };

  const openDimensionEditor = (axis) => {
    const meta = getPlotDimensionMeta(layout, axis);
    const lw = getDimLabelWorld(axis);
    const scr = worldToScreen(lw.x, lw.y);
    setEditingDim({ axis, screenX: scr.x, screenY: scr.y });
    setDimInputValue(formatMeasurement(meta.value, unit));
    onSelectElement({ type: 'dimension', data: meta });
  };

  const commitDimensionEdit = () => {
    if (!editingDim) return;
    const axis = editingDim.axis;
    const feet = parseToFeet(dimInputValue, unit);
    setEditingDim(null);
    if (feet !== null && feet > 0) {
      if (onRequestPlotResize) {
        // Routed through LayoutEditor so unsafe shrinks can be confirmed first.
        onRequestPlotResize(axis, feet);
      } else {
        const next = resizePlot(layout, axis, feet);
        historyManager.pushState(next);
        onUpdateLayout(next);
      }
    }
  };

  const cancelDimensionEdit = () => setEditingDim(null);

  // Pointer Down
  const handlePointerDown = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = screenToWorld(sx, sy);
    const snappedPos = { x: snap(worldPos.x), y: snap(worldPos.y) };

    // Middle click or spacebar or Pan Tool -> start panning
    if (e.button === 1 || e.spaceKey || activeTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewport.panX, y: e.clientY - viewport.panY });
      return;
    }

    // 1. Tool: Draw Wall
    if (activeTool === 'wall') {
      if (!wallDrawStart) {
        setWallDrawStart(snappedPos);
      } else {
        // Complete wall
        const newWall = createWall({
          x1: wallDrawStart.x,
          y1: wallDrawStart.y,
          x2: snappedPos.x,
          y2: snappedPos.y,
          type: 'interior',
        });
        const nextLayout = {
          ...layout,
          walls: [...(layout.walls || []), newWall],
        };
        historyManager.pushState(nextLayout);
        onUpdateLayout(nextLayout);
        onSelectElement({ type: 'wall', data: newWall });
        setWallDrawStart(null);
      }
      return;
    }

    // 2. Tool: Add Room
    if (activeTool === 'room') {
      const roomW = 12;
      const roomH = 10;
      const newRoom = createRoom({
        name: 'New Room',
        x: snappedPos.x,
        y: snappedPos.y,
        width: roomW,
        length: roomH,
      });
      const nextLayout = {
        ...layout,
        rooms: [...(layout.rooms || []), newRoom],
      };
      historyManager.pushState(nextLayout);
      onUpdateLayout(nextLayout);
      onSelectElement({ type: 'room', data: newRoom });
      return;
    }

    // 3. Tool: Add Door
    if (activeTool === 'door') {
      const newDoor = createDoor({
        x: snappedPos.x,
        y: snappedPos.y,
        width: 3.0,
      });
      const nextLayout = {
        ...layout,
        doors: [...(layout.doors || []), newDoor],
      };
      historyManager.pushState(nextLayout);
      onUpdateLayout(nextLayout);
      onSelectElement({ type: 'door', data: newDoor });
      return;
    }

    // 4. Tool: Add Window
    if (activeTool === 'window') {
      const newWin = createWindow({
        x: snappedPos.x,
        y: snappedPos.y,
        width: 4.0,
      });
      const nextLayout = {
        ...layout,
        windows: [...(layout.windows || []), newWin],
      };
      historyManager.pushState(nextLayout);
      onUpdateLayout(nextLayout);
      onSelectElement({ type: 'window', data: newWin });
      return;
    }

    // 5. Tool: Add Column
    if (activeTool === 'column') {
      const newCol = createColumn({
        x: snappedPos.x,
        y: snappedPos.y,
        size: 0.75,
      });
      const nextLayout = {
        ...layout,
        columns: [...(layout.columns || []), newCol],
      };
      historyManager.pushState(nextLayout);
      onUpdateLayout(nextLayout);
      onSelectElement({ type: 'column', data: newCol });
      return;
    }

    // 6. Tool: Add Staircase
    if (activeTool === 'staircase') {
      const newStair = createStaircase({
        x: snappedPos.x,
        y: snappedPos.y,
        width: 6.0,
        length: 9.0,
      });
      const nextLayout = {
        ...layout,
        staircases: [...(layout.staircases || []), newStair],
      };
      historyManager.pushState(nextLayout);
      onUpdateLayout(nextLayout);
      onSelectElement({ type: 'staircase', data: newStair });
      return;
    }

    // 7. Tool: Measure Distance
    if (activeTool === 'measure') {
      if (!measureStart) {
        setMeasureStart(snappedPos);
      } else {
        setMeasureStart(null);
      }
      return;
    }

    // 8. Dimension annotations take priority in the Select tool so a click on a
    //    label never falls through and drags a wall.
    if (activeTool === 'select') {
      const dimHit = findDimensionAtWorldPoint(worldPos.x, worldPos.y);
      if (dimHit) {
        if (dimHit.onLabel) {
          openDimensionEditor(dimHit.axis);
          return;
        }
        onSelectElement({ type: 'dimension', data: dimHit.meta });
        setDraggingHandle('dimension-line');
        setDragStartInfo({
          startWorld: worldPos,
          axis: dimHit.axis,
          initialOffset: dimHit.meta.offset,
        });
        historyManager.beginDrag();
        return;
      }
    }

    // 9. Tool: Select / Move
    // Check if clicked on a selected element's handles
    if (selectedElement) {
      if (selectedElement.type === 'wall') {
        const wall = selectedElement.data;
        const d1 = Math.hypot(worldPos.x - wall.x1, worldPos.y - wall.y1);
        const d2 = Math.hypot(worldPos.x - wall.x2, worldPos.y - wall.y2);
        if (d1 < 1.0) {
          setDraggingHandle('wall-p1');
          setDragStartInfo({
            startWorld: worldPos,
            initial: { ...wall },
            wallSnapshot: cloneLayout(layout.walls || []),
          });
          historyManager.beginDrag();
          return;
        }
        if (d2 < 1.0) {
          setDraggingHandle('wall-p2');
          setDragStartInfo({
            startWorld: worldPos,
            initial: { ...wall },
            wallSnapshot: cloneLayout(layout.walls || []),
          });
          historyManager.beginDrag();
          return;
        }
      } else if (selectedElement.type === 'room') {
        const room = selectedElement.data;
        // Bottom-right corner resize handle
        const brX = room.x + room.width;
        const brY = room.y + room.length;
        if (Math.hypot(worldPos.x - brX, worldPos.y - brY) < 1.2) {
          setDraggingHandle('room-br');
          setDragStartInfo({ startWorld: worldPos, initial: { ...room } });
          historyManager.beginDrag();
          return;
        }
      }
    }

    // General element hit detection
    const hit = findElementAtWorldPoint(worldPos.x, worldPos.y);
    if (hit) {
      onSelectElement(hit);
      // Start moving element
      setDraggingHandle('element-body');
      setDragStartInfo({
        startWorld: worldPos,
        hitType: hit.type,
        initial: { ...hit.data },
        wallSnapshot: hit.type === 'wall' ? cloneLayout(layout.walls || []) : null,
      });
      historyManager.beginDrag();
    } else {
      // Clicked on empty space -> deselect or pan
      onSelectElement(null);
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewport.panX, y: e.clientY - viewport.panY });
    }
  };

  // Pointer Move
  const handlePointerMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = screenToWorld(sx, sy);
    setMouseWorldPos(worldPos);

    if (onCursorMove) {
      onCursorMove(worldPos);
    }

    // Panning
    if (isPanning) {
      setViewport(prev => ({
        ...prev,
        panX: e.clientX - panStart.x,
        panY: e.clientY - panStart.y,
      }));
      return;
    }

    // Dragging / Resizing Handles
    if (draggingHandle && dragStartInfo && selectedElement) {
      const dx = worldPos.x - dragStartInfo.startWorld.x;
      const dy = worldPos.y - dragStartInfo.startWorld.y;

      // 0. Dimension annotation move (Mode A: changes offset only, never plot size)
      if (draggingHandle === 'dimension-line') {
        const axis = dragStartInfo.axis;
        const lineDelta = axis === 'width' ? -dy : -dx;
        const newOffset = Math.max(0.5, dragStartInfo.initialOffset + lineDelta);
        const dimId = axis === 'width' ? 'dim-plot-width' : 'dim-plot-length';
        const nextLayout = {
          ...layout,
          dimensions: (layout.dimensions || []).map((d) =>
            d.id === dimId ? { ...d, offset: newOffset } : d
          ),
        };
        syncPlotDimensions(nextLayout);
        historyManager.updateDuringDrag(nextLayout);
        onUpdateLayout(nextLayout);
        return;
      }

      // 1 & 2. Wall Endpoint drag: resize while keeping the wall perfectly straight
      if ((draggingHandle === 'wall-p1' || draggingHandle === 'wall-p2') && selectedElement.type === 'wall') {
        const which = draggingHandle === 'wall-p1' ? 'p1' : 'p2';
        const wallId = dragStartInfo.initial.id;
        const snapshot = dragStartInfo.wallSnapshot || layout.walls || [];
        const sel = snapshot.find(w => w.id === wallId) || dragStartInfo.initial;
        const orig = which === 'p1' ? { x: sel.x1, y: sel.y1 } : { x: sel.x2, y: sel.y2 };
        const orientation = getWallOrientation(sel);

        let target = { x: snap(worldPos.x), y: snap(worldPos.y) };
        let guides = [];

        // Lock the free axis for axis-aligned walls (unless diagonal mode on)
        const lockAxis = !allowDiagonal && (orientation === 'horizontal' || orientation === 'vertical');
        if (lockAxis && orientation === 'horizontal') target.y = orig.y;
        if (lockAxis && orientation === 'vertical') target.x = orig.x;

        // Endpoint / corner snapping to other wall endpoints
        const endpointHit = findEndpointSnap(
          { x: worldPos.x, y: worldPos.y },
          snapshot,
          snapTolerance,
          wallId,
          orig
        );
        if (endpointHit) {
          target = { x: endpointHit.x, y: endpointHit.y };
        } else if (lockAxis) {
          // Orthogonal alignment guides
          const axis = orientation === 'horizontal' ? 'x' : 'y';
          const aligned = findAlignmentGuides(target, snapshot, axis, snapTolerance * 0.7, wallId);
          if (aligned.guides.length > 0) {
            target[axis] = aligned[axis];
            guides = aligned.guides;
          }
        }

        // Re-apply axis lock so snapping can never tilt an axis-aligned wall
        if (lockAxis && orientation === 'horizontal') target.y = orig.y;
        if (lockAxis && orientation === 'vertical') target.x = orig.x;

        const newSel = moveWallEndpoint(sel, which, target, { allowDiagonal });
        const newEndpoint = which === 'p1' ? { x: newSel.x1, y: newSel.y1 } : { x: newSel.x2, y: newSel.y2 };

        let nextWalls = snapshot.map(w => (w.id === wallId ? newSel : w));
        // Keep adjoining walls / corners connected
        nextWalls = moveConnectedEndpoints(nextWalls, orig, newEndpoint, wallId, 0.3);

        setAlignmentGuides(guides);
        const nextLayout = { ...layout, walls: nextWalls };
        historyManager.updateDuringDrag(nextLayout);
        onUpdateLayout(nextLayout);
        return;
      }

      // 3. Room Bottom-Right Resize
      if (draggingHandle === 'room-br' && selectedElement.type === 'room') {
        const roomId = selectedElement.data.id;
        const newW = Math.max(3.0, snap(dragStartInfo.initial.width + dx));
        const newL = Math.max(3.0, snap(dragStartInfo.initial.length + dy));
        const nextRooms = layout.rooms.map(r => {
          if (r.id === roomId) {
            return { ...r, width: newW, length: newL };
          }
          return r;
        });
        const nextLayout = { ...layout, rooms: nextRooms };
        historyManager.updateDuringDrag(nextLayout);
        onUpdateLayout(nextLayout);
        return;
      }

      // 4. Element Body Move
      if (draggingHandle === 'element-body') {
        const elemType = dragStartInfo.hitType;
        const id = dragStartInfo.initial.id;

        if (elemType === 'room') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextRooms = layout.rooms.map(r => (r.id === id ? { ...r, x: newX, y: newY } : r));
          const nextLayout = { ...layout, rooms: nextRooms };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'wall') {
          // Translate the whole wall by an identical delta for both endpoints.
          // This guarantees length, thickness and orientation never change.
          const moveX = snap(dx);
          const moveY = snap(dy);
          const snapshot = dragStartInfo.wallSnapshot || layout.walls || [];
          const orig = snapshot.find(w => w.id === id) || dragStartInfo.initial;
          const newA = { x: orig.x1 + moveX, y: orig.y1 + moveY };
          const newB = { x: orig.x2 + moveX, y: orig.y2 + moveY };
          const tolerance = 0.25;

          const nextWalls = snapshot.map(w => {
            if (w.id === id) {
              return { ...w, x1: newA.x, y1: newA.y, x2: newB.x, y2: newB.y };
            }
            // Follow adjoining walls whose endpoint was connected to the moved wall
            let nx1 = w.x1, ny1 = w.y1, nx2 = w.x2, ny2 = w.y2, changed = false;
            if (Math.hypot(w.x1 - orig.x1, w.y1 - orig.y1) <= tolerance) { nx1 = newA.x; ny1 = newA.y; changed = true; }
            if (Math.hypot(w.x2 - orig.x1, w.y2 - orig.y1) <= tolerance) { nx2 = newA.x; ny2 = newA.y; changed = true; }
            if (Math.hypot(w.x1 - orig.x2, w.y1 - orig.y2) <= tolerance) { nx1 = newB.x; ny1 = newB.y; changed = true; }
            if (Math.hypot(w.x2 - orig.x2, w.y2 - orig.y2) <= tolerance) { nx2 = newB.x; ny2 = newB.y; changed = true; }
            return changed ? { ...w, x1: nx1, y1: ny1, x2: nx2, y2: ny2 } : w;
          });
          const nextLayout = { ...layout, walls: nextWalls };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'door') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextDoors = layout.doors.map(d => (d.id === id ? { ...d, x: newX, y: newY } : d));
          const nextLayout = { ...layout, doors: nextDoors };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'window') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextWins = layout.windows.map(w => (w.id === id ? { ...w, x: newX, y: newY } : w));
          const nextLayout = { ...layout, windows: nextWins };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'staircase') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextStairs = layout.staircases.map(s => (s.id === id ? { ...s, x: newX, y: newY } : s));
          const nextLayout = { ...layout, staircases: nextStairs };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'utility') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextUtils = layout.utilities.map(u => (u.id === id ? { ...u, x: newX, y: newY } : u));
          const nextLayout = { ...layout, utilities: nextUtils };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'parking') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextParks = layout.parking.map(p => (p.id === id ? { ...p, x: newX, y: newY } : p));
          const nextLayout = { ...layout, parking: nextParks };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        }
      }
    }
  };

  // Pointer Up
  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingHandle) {
      historyManager.endDrag(layout);
      setDraggingHandle(null);
      setDragStartInfo(null);
      setAlignmentGuides([]);
    }
  };

  // Rulers Rendering (Top and Left)
  const renderRulers = () => {
    if (!layout) return null;
    const plotW = layout.plot?.width || 30;
    const plotL = layout.plot?.length || 40;

    const ticksX = [];
    const stepX = 5; // 5 ft major ticks
    for (let x = 0; x <= plotW; x += stepX) {
      const scr = worldToScreen(x, 0);
      ticksX.push(
        <div key={`rx-${x}`} style={{ position: 'absolute', left: scr.x, top: 0, height: 18, borderLeft: '1px solid #94A3B8', paddingLeft: 3 }}>
          <span style={{ fontSize: 9, color: '#64748B', fontWeight: 600 }}>{formatMeasurement(x, unit, 0)}</span>
        </div>
      );
    }

    const ticksY = [];
    const stepY = 5;
    for (let y = 0; y <= plotL; y += stepY) {
      const scr = worldToScreen(0, y);
      ticksY.push(
        <div key={`ry-${y}`} style={{ position: 'absolute', top: scr.y, left: 0, width: 24, borderTop: '1px solid #94A3B8', paddingTop: 2 }}>
          <span style={{ fontSize: 9, color: '#64748B', fontWeight: 600 }}>{formatMeasurement(y, unit, 0)}</span>
        </div>
      );
    }

    return (
      <>
        {/* Horizontal Top Ruler */}
        <div style={{ position: 'absolute', top: 0, left: 24, right: 0, height: 22, backgroundColor: '#F1F5F9', borderBottom: '1.2px solid #CBD5E1', overflow: 'hidden', zIndex: 10 }}>
          {ticksX}
        </div>
        {/* Vertical Left Ruler */}
        <div style={{ position: 'absolute', top: 22, left: 0, bottom: 0, width: 24, backgroundColor: '#F1F5F9', borderRight: '1.2px solid #CBD5E1', overflow: 'hidden', zIndex: 10 }}>
          {ticksY}
        </div>
      </>
    );
  };

  // Outer Plot Dimension Lines (selectable + editable annotations)
  const renderPlotDimensions = () => {
    if (!layout || !showDimensions) return null;
    const W = layout.plot?.width || 30;
    const L = layout.plot?.length || 40;
    const w = getPlotDimensionMeta(layout, 'width');
    const l = getPlotDimensionMeta(layout, 'length');
    const wSel = selectedElement?.type === 'dimension' && selectedElement.data?.axis === 'width';
    const lSel = selectedElement?.type === 'dimension' && selectedElement.data?.axis === 'length';
    const baseColor = '#B45309';
    const selColor = '#2563EB';

    const renderLabel = (scr, text, selected, axis) => {
      const isEditing = editingDim && editingDim.axis === axis;
      return (
        <g>
          <rect
            x={scr.x - 34}
            y={scr.y - 10}
            width="68"
            height="20"
            rx="3"
            fill={selected ? selColor : '#FFFFFF'}
            stroke={selected ? selColor : baseColor}
            strokeWidth="1.2"
            opacity={isEditing ? 0.3 : 1}
          />
          <text
            x={scr.x}
            y={scr.y + 4}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill={selected ? '#FFFFFF' : baseColor}
            fontFamily="Segoe UI, sans-serif"
            opacity={isEditing ? 0.3 : 1}
          >
            {text}
          </text>
        </g>
      );
    };

    const renderDimension = (axis, selected) => {
      const color = selected ? selColor : baseColor;
      const lsc = worldToScreen(getDimLabelWorld(axis).x, getDimLabelWorld(axis).y);

      if (axis === 'width') {
        const y = -w.offset;
        const a = worldToScreen(0, y);
        const b = worldToScreen(W, y);
        const e1a = worldToScreen(0, 0.4);
        const e1b = worldToScreen(0, y - 0.6);
        const e2a = worldToScreen(W, 0.4);
        const e2b = worldToScreen(W, y - 0.6);
        return (
          <g key="dim-width">
            {selected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(37,99,235,0.22)" strokeWidth="12" />}
            <line x1={e1a.x} y1={e1a.y} x2={e1b.x} y2={e1b.y} stroke={color} strokeWidth="1" strokeDasharray="3,2" />
            <line x1={e2a.x} y1={e2a.y} x2={e2b.x} y2={e2b.y} stroke={color} strokeWidth="1" strokeDasharray="3,2" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={selected ? 2 : 1.4} strokeDasharray="5,4" />
            <polygon points={`${a.x},${a.y} ${a.x + 11},${a.y - 4} ${a.x + 11},${a.y + 4}`} fill={color} />
            <polygon points={`${b.x},${b.y} ${b.x - 11},${b.y - 4} ${b.x - 11},${b.y + 4}`} fill={color} />
            {selected && <rect x={a.x - 4} y={a.y - 4} width="8" height="8" fill={selColor} stroke="#FFFFFF" strokeWidth="1.5" />}
            {selected && <rect x={b.x - 4} y={b.y - 4} width="8" height="8" fill={selColor} stroke="#FFFFFF" strokeWidth="1.5" />}
            {renderLabel(lsc, formatMeasurement(W, unit), selected, 'width')}
          </g>
        );
      }

      const x = -l.offset;
      const a = worldToScreen(x, 0);
      const b = worldToScreen(x, L);
      const e1a = worldToScreen(0.4, 0);
      const e1b = worldToScreen(x - 0.6, 0);
      const e2a = worldToScreen(0.4, L);
      const e2b = worldToScreen(x - 0.6, L);
      return (
        <g key="dim-length">
          {selected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(37,99,235,0.22)" strokeWidth="12" />}
          <line x1={e1a.x} y1={e1a.y} x2={e1b.x} y2={e1b.y} stroke={color} strokeWidth="1" strokeDasharray="3,2" />
          <line x1={e2a.x} y1={e2a.y} x2={e2b.x} y2={e2b.y} stroke={color} strokeWidth="1" strokeDasharray="3,2" />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={selected ? 2 : 1.4} strokeDasharray="5,4" />
          <polygon points={`${a.x},${a.y} ${a.x - 4},${a.y + 11} ${a.x + 4},${a.y + 11}`} fill={color} />
          <polygon points={`${b.x},${b.y} ${b.x - 4},${b.y - 11} ${b.x + 4},${b.y - 11}`} fill={color} />
          {selected && <rect x={a.x - 4} y={a.y - 4} width="8" height="8" fill={selColor} stroke="#FFFFFF" strokeWidth="1.5" />}
          {selected && <rect x={b.x - 4} y={b.y - 4} width="8" height="8" fill={selColor} stroke="#FFFFFF" strokeWidth="1.5" />}
          {renderLabel(lsc, formatMeasurement(L, unit), selected, 'length')}
        </g>
      );
    };

    return (
      <g>
        {renderDimension('width', wSel)}
        {renderDimension('length', lSel)}
      </g>
    );
  };

  const plotW = layout?.plot?.width || 30;
  const plotL = layout?.plot?.length || 40;
  const plotScr = worldToScreen(0, 0);
  const plotWidthPx = plotW * viewport.scale;
  const plotHeightPx = plotL * viewport.scale;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        backgroundColor: '#F8FAFC',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        cursor: activeTool === 'pan' || isPanning ? 'grabbing' : (activeTool === 'wall' || activeTool === 'room' ? 'crosshair' : 'default'),
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Top & Left Architectural Precision Rulers */}
      {renderRulers()}

      {/* SVG Canvas Elements */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        {/* Background CAD Grid */}
        {showGrid && (
          <g opacity="0.35">
            {Array.from({ length: Math.ceil(plotW / 2) + 1 }).map((_, i) => {
              const p = worldToScreen(i * 2, 0);
              return (
                <line
                  key={`gv-${i}`}
                  x1={p.x}
                  y1={plotScr.y - 100}
                  x2={p.x}
                  y2={plotScr.y + plotHeightPx + 100}
                  stroke="#CBD5E1"
                  strokeWidth="0.8"
                />
              );
            })}
            {Array.from({ length: Math.ceil(plotL / 2) + 1 }).map((_, i) => {
              const p = worldToScreen(0, i * 2);
              return (
                <line
                  key={`gh-${i}`}
                  x1={plotScr.x - 100}
                  y1={p.y}
                  x2={plotScr.x + plotWidthPx + 100}
                  y2={p.y}
                  stroke="#CBD5E1"
                  strokeWidth="0.8"
                />
              );
            })}
          </g>
        )}

        {/* Plot Boundary Outline (Amber dashed) */}
        <rect
          x={plotScr.x}
          y={plotScr.y}
          width={plotWidthPx}
          height={plotHeightPx}
          fill="#FFFFFF"
          stroke="#D97706"
          strokeWidth="2.5"
          strokeDasharray="6,4"
        />

        {/* Vastu Quadrant Badges */}
        <g fontSize="10" fontWeight="bold" fill="#B45309">
          <text x={plotScr.x + plotWidthPx - 26} y={plotScr.y + 18}>NE</text>
          <text x={plotScr.x + 10} y={plotScr.y + 18}>NW</text>
          <text x={plotScr.x + plotWidthPx - 26} y={plotScr.y + plotHeightPx - 10}>SE</text>
          <text x={plotScr.x + 10} y={plotScr.y + plotHeightPx - 10}>SW</text>
        </g>

        {/* Outer Plot Dimension Lines (interactive) */}
        {renderPlotDimensions()}

        {/* Live alignment guides while dragging wall endpoints */}
        {alignmentGuides.map((g, i) => {
          if (g.orientation === 'v') {
            const p = worldToScreen(g.pos, 0);
            return (
              <line
                key={`ag-${i}`}
                x1={p.x}
                y1={plotScr.y - 60}
                x2={p.x}
                y2={plotScr.y + plotHeightPx + 60}
                stroke="#EC4899"
                strokeWidth="1"
                strokeDasharray="5,4"
              />
            );
          }
          const p = worldToScreen(0, g.pos);
          return (
            <line
              key={`ag-${i}`}
              x1={plotScr.x - 60}
              y1={p.y}
              x2={plotScr.x + plotWidthPx + 60}
              y2={p.y}
              stroke="#EC4899"
              strokeWidth="1"
              strokeDasharray="5,4"
            />
          );
        })}

        {/* Rooms Layer */}
        {(layout?.rooms || []).map(room => {
          const rPos = worldToScreen(room.x, room.y);
          const rW = room.width * viewport.scale;
          const rH = room.length * viewport.scale;
          const isSel = selectedElement?.type === 'room' && selectedElement.data.id === room.id;
          const area = room.width * room.length;

          return (
            <g key={room.id}>
              {/* Room floor tile */}
              <rect
                x={rPos.x}
                y={rPos.y}
                width={rW}
                height={rH}
                fill={room.color || '#F8FAFC'}
                stroke={isSel ? '#2563EB' : '#CBD5E1'}
                strokeWidth={isSel ? 2.5 : 1}
              />

              {/* Room Centered Labels & Measurements */}
              <text
                x={rPos.x + rW / 2}
                y={rPos.y + rH / 2 - 8}
                textAnchor="middle"
                fontSize={Math.max(10, Math.min(14, 11 * (viewport.scale / 18)))}
                fontWeight="700"
                fill="#1E293B"
                fontFamily="Segoe UI, sans-serif"
              >
                {room.label || room.name}
              </text>

              {showDimensions && (
                <>
                  <text
                    x={rPos.x + rW / 2}
                    y={rPos.y + rH / 2 + 7}
                    textAnchor="middle"
                    fontSize={Math.max(8.5, Math.min(12, 9.5 * (viewport.scale / 18)))}
                    fontWeight="500"
                    fill="#64748B"
                    fontFamily="Segoe UI, sans-serif"
                  >
                    {formatMeasurement(room.width, unit)} × {formatMeasurement(room.length, unit)}
                  </text>
                  <text
                    x={rPos.x + rW / 2}
                    y={rPos.y + rH / 2 + 20}
                    textAnchor="middle"
                    fontSize={Math.max(8, Math.min(11, 8.5 * (viewport.scale / 18)))}
                    fontWeight="700"
                    fill="#0284C7"
                    fontFamily="Segoe UI, sans-serif"
                  >
                    {formatArea(area, unit)}
                  </text>
                </>
              )}

              {/* Selection Corner Resize Handle */}
              {isSel && (
                <rect
                  x={rPos.x + rW - 6}
                  y={rPos.y + rH - 6}
                  width="12"
                  height="12"
                  fill="#2563EB"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  cursor="nwse-resize"
                />
              )}
            </g>
          );
        })}

        {/* Utilities, Parking, Staircases */}
        {(layout?.parking || []).map(p => {
          const pPos = worldToScreen(p.x, p.y);
          const pW = p.width * viewport.scale;
          const pH = p.length * viewport.scale;
          const isSel = selectedElement?.type === 'parking' && selectedElement.data.id === p.id;
          return (
            <g key={p.id}>
              <rect
                x={pPos.x}
                y={pPos.y}
                width={pW}
                height={pH}
                fill="#F1F5F9"
                stroke={isSel ? '#2563EB' : '#94A3B8'}
                strokeWidth={isSel ? 2 : 1.2}
                strokeDasharray="4,3"
              />
              <text x={pPos.x + pW / 2} y={pPos.y + pH / 2 + 4} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#64748B">
                {p.label || 'PARKING'}
              </text>
            </g>
          );
        })}

        {(layout?.utilities || []).map(u => {
          const uPos = worldToScreen(u.x, u.y);
          const uW = u.width * viewport.scale;
          const uH = u.length * viewport.scale;
          const isSel = selectedElement?.type === 'utility' && selectedElement.data.id === u.id;
          return (
            <g key={u.id}>
              <rect
                x={uPos.x}
                y={uPos.y}
                width={uW}
                height={uH}
                fill="#E0F2FE"
                stroke={isSel ? '#2563EB' : '#0284C7'}
                strokeWidth={isSel ? 2 : 1.5}
                rx="4"
              />
              <text x={uPos.x + uW / 2} y={uPos.y + uH / 2 + 4} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#0369A1">
                {u.name || 'Utility'}
              </text>
            </g>
          );
        })}

        {(layout?.staircases || []).map(s => {
          const sPos = worldToScreen(s.x, s.y);
          const sW = s.width * viewport.scale;
          const sH = s.length * viewport.scale;
          const isSel = selectedElement?.type === 'staircase' && selectedElement.data.id === s.id;
          const steps = s.steps || 12;
          return (
            <g key={s.id}>
              <rect
                x={sPos.x}
                y={sPos.y}
                width={sW}
                height={sH}
                fill="#F8FAFC"
                stroke={isSel ? '#2563EB' : '#475569'}
                strokeWidth={isSel ? 2 : 1.5}
              />
              {Array.from({ length: steps - 1 }).map((_, idx) => (
                <line
                  key={`st-${idx}`}
                  x1={sPos.x}
                  y1={sPos.y + (sH / steps) * (idx + 1)}
                  x2={sPos.x + sW}
                  y2={sPos.y + (sH / steps) * (idx + 1)}
                  stroke="#94A3B8"
                  strokeWidth="1"
                />
              ))}
              <text x={sPos.x + sW / 2} y={sPos.y + sH / 2 + 3} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#0F172A">
                {s.label || 'STAIRS'}
              </text>
            </g>
          );
        })}

        {/* Columns */}
        {(layout?.columns || []).map(col => {
          const cPos = worldToScreen(col.x, col.y);
          const cSize = (col.size || 0.75) * viewport.scale;
          const isSel = selectedElement?.type === 'column' && selectedElement.data.id === col.id;
          return (
            <g key={col.id}>
              <rect
                x={cPos.x - cSize / 2}
                y={cPos.y - cSize / 2}
                width={cSize}
                height={cSize}
                fill="#475569"
                stroke={isSel ? '#2563EB' : '#0F172A'}
                strokeWidth={isSel ? 2 : 1}
              />
            </g>
          );
        })}

        {/* Walls Layer (Solid architectural CAD lines) */}
        {(layout?.walls || []).map(wall => {
          const p1 = worldToScreen(wall.x1, wall.y1);
          const p2 = worldToScreen(wall.x2, wall.y2);
          const strokeW = Math.max(3, (wall.thickness || 0.75) * viewport.scale);
          const isSel = selectedElement?.type === 'wall' && selectedElement.data.id === wall.id;

          return (
            <g key={wall.id}>
              {/* Highlight halo when selected */}
              {isSel && (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="rgba(37, 99, 235, 0.35)"
                  strokeWidth={strokeW + 10}
                  strokeLinecap="round"
                />
              )}

              {/* Main Solid Wall Line */}
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={isSel ? '#2563EB' : (wall.color || '#0F172A')}
                strokeWidth={strokeW}
                strokeLinecap="round"
              />

              {/* Interactive Endpoint Handles when Selected */}
              {isSel && (
                <>
                  <circle cx={p1.x} cy={p1.y} r="7" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" cursor="move" />
                  <circle cx={p2.x} cy={p2.y} r="7" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" cursor="move" />
                </>
              )}
            </g>
          );
        })}

        {/* Doors Layer */}
        {(layout?.doors || []).map(door => {
          const dPos = worldToScreen(door.x, door.y);
          const dW = (door.width || 3.0) * viewport.scale;
          const isSel = selectedElement?.type === 'door' && selectedElement.data.id === door.id;

          return (
            <g key={door.id} transform={`rotate(${door.rotation || 0}, ${dPos.x}, ${dPos.y})`}>
              {/* Door Gap Opening Clear */}
              <circle cx={dPos.x} cy={dPos.y} r={dW / 2} fill="#FFFFFF" opacity="0.8" />
              {/* Hinge point */}
              <circle cx={dPos.x} cy={dPos.y} r="4" fill={isSel ? '#2563EB' : '#B45309'} />
              {/* Door Leaf line */}
              <line
                x1={dPos.x}
                y1={dPos.y}
                x2={dPos.x + dW * 0.7}
                y2={dPos.y - dW * 0.7}
                stroke={isSel ? '#2563EB' : '#B45309'}
                strokeWidth="2.5"
              />
              {/* Swing Arc */}
              <path
                d={`M ${dPos.x} ${dPos.y - dW} A ${dW} ${dW} 0 0 1 ${dPos.x + dW} ${dPos.y}`}
                fill="none"
                stroke={isSel ? '#2563EB' : '#B45309'}
                strokeWidth="1.2"
                strokeDasharray="3,3"
              />
            </g>
          );
        })}

        {/* Windows Layer */}
        {(layout?.windows || []).map(win => {
          const wPos = worldToScreen(win.x, win.y);
          const wW = (win.width || 4.0) * viewport.scale;
          const isSel = selectedElement?.type === 'window' && selectedElement.data.id === win.id;

          return (
            <g key={win.id} transform={`rotate(${win.rotation || 0}, ${wPos.x}, ${wPos.y})`}>
              {/* Glass Block */}
              <rect
                x={wPos.x - wW / 2}
                y={wPos.y - 4}
                width={wW}
                height="8"
                fill="#0EA5E9"
                stroke={isSel ? '#2563EB' : '#0284C7'}
                strokeWidth="1.5"
                rx="2"
              />
              {/* Sunshade Chajja Line */}
              {win.chajja && (
                <rect
                  x={wPos.x - wW / 2 - 4}
                  y={wPos.y - 14}
                  width={wW + 8}
                  height="10"
                  fill="none"
                  stroke="#64748B"
                  strokeWidth="1"
                  strokeDasharray="3,2"
                />
              )}
              <text x={wPos.x} y={wPos.y - 7} fontSize="8" fontWeight="bold" fill="#0284C7" textAnchor="middle">
                {win.isBathroom ? 'V' : 'W'}
              </text>
            </g>
          );
        })}

        {/* Wall Drawing Live Preview */}
        {activeTool === 'wall' && wallDrawStart && (
          <line
            x1={worldToScreen(wallDrawStart.x, wallDrawStart.y).x}
            y1={worldToScreen(wallDrawStart.x, wallDrawStart.y).y}
            x2={worldToScreen(snap(mouseWorldPos.x), snap(mouseWorldPos.y)).x}
            y2={worldToScreen(snap(mouseWorldPos.x), snap(mouseWorldPos.y)).y}
            stroke="#2563EB"
            strokeWidth="4"
            strokeDasharray="5,4"
          />
        )}

        {/* Measure Tool Line */}
        {activeTool === 'measure' && measureStart && (
          <g>
            <line
              x1={worldToScreen(measureStart.x, measureStart.y).x}
              y1={worldToScreen(measureStart.x, measureStart.y).y}
              x2={worldToScreen(mouseWorldPos.x, mouseWorldPos.y).x}
              y2={worldToScreen(mouseWorldPos.y, mouseWorldPos.y).y}
              stroke="#DC2626"
              strokeWidth="2"
              strokeDasharray="4,4"
            />
            <text
              x={(worldToScreen(measureStart.x, measureStart.y).x + worldToScreen(mouseWorldPos.x, mouseWorldPos.y).x) / 2}
              y={(worldToScreen(measureStart.x, measureStart.y).y + worldToScreen(mouseWorldPos.x, mouseWorldPos.y).y) / 2 - 10}
              fontSize="12"
              fontWeight="bold"
              fill="#DC2626"
              textAnchor="middle"
            >
              {formatMeasurement(Math.hypot(mouseWorldPos.x - measureStart.x, mouseWorldPos.y - measureStart.y), unit)}
            </text>
          </g>
        )}
      </svg>

      {/* Inline numeric editor for a selected plot dimension label (Mode B) */}
      {editingDim && (
        <input
          ref={dimInputRef}
          value={dimInputValue}
          autoFocus
          onChange={(e) => setDimInputValue(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitDimensionEdit();
            else if (e.key === 'Escape') cancelDimensionEdit();
          }}
          onBlur={commitDimensionEdit}
          style={{
            position: 'absolute',
            left: editingDim.screenX - 48,
            top: editingDim.screenY - 15,
            width: 96,
            height: 30,
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: '#0F172A',
            border: '2px solid #2563EB',
            borderRadius: 5,
            background: '#FFFFFF',
            outline: 'none',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.2)',
          }}
        />
      )}
    </div>
  );
}
