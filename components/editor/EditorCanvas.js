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
  MIN_ROOM_DIMENSION,
  getPlotAndBuildableBounds,
  checkRoomPlotFit,
  collectAlignmentTargets,
  findRoomSnapping,
  createRoomBoundaryWalls,
  syncRoomWithWallsAndOpenings,
  applySiteChange,
  calculateStaircaseGeometry,
  getStaircaseBounds,
  resizeStaircaseWorld,
} from './layoutModel';
import { formatMeasurement, formatArea, parseToFeet } from './units';
import {
  resizeRoom,
  moveRoom,
  setRoomDimension,
  moveWallBoundary,
  edgeTargetsForHandle,
  screenToWorldPoint,
  worldToScreenPoint,
} from './roomResize';

export default function EditorCanvas({
  layout,
  onUpdateLayout,
  selectedElement,
  onSelectElement,
  activeTool = 'select',
  onSelectTool,
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
  onRequestSiteChange,
}) {
  const containerRef = useRef(null);
  const dimInputRef = useRef(null);
  const roomDimInputRef = useRef(null);

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
  const [draggingHandle, setDraggingHandle] = useState(null); // 'wall-p1' | 'wall-p2' | 'room-nw'...'room-se' | 'room-body' | 'dimension-line'
  const [dragStartInfo, setDragStartInfo] = useState(null);
  const [alignmentGuides, setAlignmentGuides] = useState([]);
  const [snapBadges, setSnapBadges] = useState([]);
  const [roomWarnings, setRoomWarnings] = useState([]);
  const [activeMeasurements, setActiveMeasurements] = useState(null);
  const [resizeConflict, setResizeConflict] = useState(null); // reason a room / wall drag stopped short
  const [sitePreview, setSitePreview] = useState(null); // { width, length, conflicts, change, success } while dragging a plot edge

  // Pending room placement confirmation (room drawn outside buildable area)
  const [pendingRoomPlacement, setPendingRoomPlacement] = useState(null); // { room, warnings, buildable, exceeds }
  const [placementNotice, setPlacementNotice] = useState(null);
  const placementNoticeTimer = useRef(null);

  // Inline dimension label editing (Mode B)
  const [editingDim, setEditingDim] = useState(null); // { axis, value, screenX, screenY }
  const [dimInputValue, setDimInputValue] = useState('');

  // Inline Room Dimension label editing
  const [editingRoomDim, setEditingRoomDim] = useState(null); // { roomId, field, screenX, screenY }
  const [roomDimInputValue, setRoomDimInputValue] = useState('');

  // Drawing Tools State
  const [wallDrawStart, setWallDrawStart] = useState(null); // { x, y }
  const [roomDrawStart, setRoomDrawStart] = useState(null);
  const [measureStart, setMeasureStart] = useState(null);

  // Convert World Coordinates (ft) to Screen Pixels
  const worldToScreen = useCallback((wx, wy) => worldToScreenPoint(viewport, wx, wy), [viewport]);

  // Convert Screen Pixels to World Coordinates (ft) - the only conversion drags use
  const screenToWorld = useCallback((sx, sy) => screenToWorldPoint(viewport, sx, sy), [viewport]);

  // Snap to grid if enabled
  const snap = useCallback((val) => {
    if (!snapEnabled) return val;
    return snapValue(val, snapStep);
  }, [snapEnabled, snapStep]);

  // Room smart-snap tolerance in screen pixels, driven by the configurable
  // snap tolerance control so it stays consistent at every zoom level.
  const roomSnapPixelTolerance = Math.max(6, Math.min(40, (snapTolerance / 0.75) * 12));

  const showPlacementNotice = (text) => {
    setPlacementNotice(text);
    if (placementNoticeTimer.current) clearTimeout(placementNoticeTimer.current);
    placementNoticeTimer.current = setTimeout(() => setPlacementNotice(null), 4500);
  };

  // Commit a room into the layout (history + boundary walls + selection)
  const commitRoomPlacement = (room) => {
    const newRoom = createRoom({
      name: `Room ${layout.rooms?.length ? layout.rooms.length + 1 : 1}`,
      x: room.x,
      y: room.y,
      width: room.width,
      length: room.length,
    });
    const nextWalls = createRoomBoundaryWalls(layout, newRoom);
    const nextLayout = {
      ...layout,
      rooms: [...(layout.rooms || []), newRoom],
      walls: nextWalls,
    };
    historyManager.pushState(nextLayout);
    onUpdateLayout(nextLayout);
    onSelectElement({ type: 'room', data: newRoom });
    if (onSelectTool) onSelectTool('select');
  };

  // Finish a draw: if the room violates plot/buildable constraints, ask the
  // user how to resolve it instead of silently placing or shrinking it.
  const finalizeRoomPlacement = (room) => {
    const fit = checkRoomPlotFit(room, layout);
    if (fit.warnings.length > 0) {
      setPendingRoomPlacement({
        room,
        warnings: fit.warnings,
        buildable: fit.buildable,
        exceeds: !!fit.exceedsBuildableDimensions,
      });
      return;
    }
    commitRoomPlacement(room);
  };

  const handlePlaceAsIs = () => {
    if (!pendingRoomPlacement) return;
    commitRoomPlacement(pendingRoomPlacement.room);
    setPendingRoomPlacement(null);
  };

  const handleFitInsidePlot = () => {
    if (!pendingRoomPlacement) return;
    const { room, buildable, exceeds } = pendingRoomPlacement;
    if (exceeds) return; // dimensions don't fit — only "Resize to Fit" is allowed
    const newX = Math.max(buildable.minX, Math.min(room.x, buildable.maxX - room.width));
    const newY = Math.max(buildable.minY, Math.min(room.y, buildable.maxY - room.length));
    commitRoomPlacement({ ...room, x: Number(newX.toFixed(2)), y: Number(newY.toFixed(2)) });
    setPendingRoomPlacement(null);
  };

  const handleResizeToFitPlot = () => {
    if (!pendingRoomPlacement) return;
    const { room, buildable } = pendingRoomPlacement;
    const w = Math.min(room.width, buildable.width);
    const l = Math.min(room.length, buildable.length);
    const x = Math.max(buildable.minX, Math.min(room.x, buildable.maxX - w));
    const y = Math.max(buildable.minY, Math.min(room.y, buildable.maxY - l));
    commitRoomPlacement({
      ...room,
      width: Number(w.toFixed(2)),
      length: Number(l.toFixed(2)),
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    });
    setPendingRoomPlacement(null);
  };

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
      const b = getStaircaseBounds(s);
      if (wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.length) {
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

  // Inline Room Dimension Editing
  const openRoomDimensionEditor = (roomId, field, sx, sy, curVal) => {
    setEditingRoomDim({ roomId, field, screenX: sx, screenY: sy });
    setRoomDimInputValue(formatMeasurement(curVal, unit));
    setTimeout(() => {
      if (roomDimInputRef.current) {
        roomDimInputRef.current.focus();
        roomDimInputRef.current.select();
      }
    }, 50);
  };

  const commitRoomDimensionEdit = () => {
    if (!editingRoomDim) return;
    const { roomId, field } = editingRoomDim;
    const feet = parseToFeet(roomDimInputValue, unit);
    setEditingRoomDim(null);
    if (feet !== null && feet >= MIN_ROOM_DIMENSION) {
      const res = setRoomDimension(layout, roomId, field, Number(feet.toFixed(4)));
      if (res.room) {
        historyManager.pushState(res.layout);
        onUpdateLayout(res.layout);
        onSelectElement({ type: 'room', data: res.room });
        if (res.conflicts.length) showPlacementNotice(`Stopped at the nearest valid size: ${res.conflicts[0]}`);
      }
    }
  };

  const cancelRoomDimensionEdit = () => setEditingRoomDim(null);

  // Escape key cancels placement, drawing, or dimension editing
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (pendingRoomPlacement) {
          setPendingRoomPlacement(null);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (roomDrawStart) {
          setRoomDrawStart(null);
          setAlignmentGuides([]);
          setSnapBadges([]);
          setRoomWarnings([]);
          setActiveMeasurements(null);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (wallDrawStart) {
          setWallDrawStart(null);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (measureStart) {
          setMeasureStart(null);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (editingRoomDim) {
          setEditingRoomDim(null);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (editingDim) {
          setEditingDim(null);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingRoomPlacement, roomDrawStart, wallDrawStart, measureStart, editingRoomDim, editingDim]);

  // Pointer Down
  // Resize handle under the pointer for a selected room: corners first, then
  // the edge midpoint squares, then anywhere along an edge line.
  const findRoomHandle = (room, sx, sy) => {
    if (!room) return null;
    const p0 = worldToScreen(room.x, room.y);
    const w = room.width * viewport.scale;
    const h = room.length * viewport.scale;
    const corners = [
      { id: 'room-nw', x: p0.x, y: p0.y }, { id: 'room-ne', x: p0.x + w, y: p0.y },
      { id: 'room-se', x: p0.x + w, y: p0.y + h }, { id: 'room-sw', x: p0.x, y: p0.y + h },
    ];
    const mids = [
      { id: 'room-n', x: p0.x + w / 2, y: p0.y }, { id: 'room-e', x: p0.x + w, y: p0.y + h / 2 },
      { id: 'room-s', x: p0.x + w / 2, y: p0.y + h }, { id: 'room-w', x: p0.x, y: p0.y + h / 2 },
    ];
    const c = corners.find((k) => Math.hypot(sx - k.x, sy - k.y) <= 10);
    if (c) return c.id;
    const m = mids.find((k) => Math.hypot(sx - k.x, sy - k.y) <= 10);
    if (m) return m.id;
    const tol = 5;
    const inX = sx > p0.x + tol && sx < p0.x + w - tol;
    const inY = sy > p0.y + tol && sy < p0.y + h - tol;
    if (inX && Math.abs(sy - p0.y) <= tol) return 'room-n';
    if (inX && Math.abs(sy - (p0.y + h)) <= tol) return 'room-s';
    if (inY && Math.abs(sx - p0.x) <= tol) return 'room-w';
    if (inY && Math.abs(sx - (p0.x + w)) <= tol) return 'room-e';
    return null;
  };

  // Site boundary handles: edge midpoints and corners are always grabbable;
  // the whole edge line is grabbable while the plot is selected.
  const PLOT_EDGE_HANDLE_PX = 9;
  const getPlotHandlePositions = () => {
    const W = layout?.plot?.width || 30;
    const L = layout?.plot?.length || 40;
    const p = (x, y) => worldToScreen(x, y);
    return [
      { edge: 'top', ...p(W / 2, 0) },
      { edge: 'bottom', ...p(W / 2, L) },
      { edge: 'left', ...p(0, L / 2) },
      { edge: 'right', ...p(W, L / 2) },
      { edge: 'corner-nw', ...p(0, 0) },
      { edge: 'corner-ne', ...p(W, 0) },
      { edge: 'corner-sw', ...p(0, L) },
      { edge: 'corner-se', ...p(W, L) },
    ];
  };

  const findPlotEdgeHandle = (sx, sy) => {
    if (!layout?.plot) return null;
    const hit = getPlotHandlePositions().find((h) => Math.hypot(sx - h.x, sy - h.y) <= PLOT_EDGE_HANDLE_PX);
    if (hit) return hit.edge;
    if (selectedElement?.type !== 'plot') return null;
    const W = layout.plot.width || 30;
    const L = layout.plot.length || 40;
    const a = worldToScreen(0, 0);
    const b = worldToScreen(W, L);
    const tol = 5;
    const inX = sx > a.x - tol && sx < b.x + tol;
    const inY = sy > a.y - tol && sy < b.y + tol;
    if (inX && Math.abs(sy - a.y) <= tol) return 'top';
    if (inX && Math.abs(sy - b.y) <= tol) return 'bottom';
    if (inY && Math.abs(sx - a.x) <= tol) return 'left';
    if (inY && Math.abs(sx - b.x) <= tol) return 'right';
    return null;
  };

  // Proposed site change for a boundary drag. The opposite edge stays fixed;
  // Shift (or Alt) resizes symmetrically about the centre.
  const computeSiteDragChange = (info, worldPos, symmetric) => {
    const plot = info.snapshot.plot;
    const sb = plot.setbacks || {};
    const dx = worldPos.x - info.startWorld.x;
    const dy = worldPos.y - info.startWorld.y;
    const e = info.edge;
    const k = symmetric ? 2 : 1;
    let width = plot.width;
    let length = plot.length;
    if (e === 'right' || e === 'corner-ne' || e === 'corner-se') width = plot.width + k * dx;
    if (e === 'left' || e === 'corner-nw' || e === 'corner-sw') width = plot.width - k * dx;
    if (e === 'bottom' || e === 'corner-sw' || e === 'corner-se') length = plot.length + k * dy;
    if (e === 'top' || e === 'corner-nw' || e === 'corner-ne') length = plot.length - k * dy;
    // Snap to the grid step and keep at least 1 ft of buildable area
    const minW = (Number(sb.west) || 0) + (Number(sb.east) || 0) + 1;
    const minL = (Number(sb.north) || 0) + (Number(sb.south) || 0) + 1;
    width = Math.max(minW, 5, snapEnabled ? snapValue(width, snapStep) : Number(width.toFixed(2)));
    length = Math.max(minL, 5, snapEnabled ? snapValue(length, snapStep) : Number(length.toFixed(2)));
    return { width, length, edge: symmetric ? 'symmetric' : e };
  };

  const handlePointerDown = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = screenToWorld(sx, sy);
    const snappedPos = { x: snap(worldPos.x), y: snap(worldPos.y) };

    // Capture the pointer so drags and draws keep receiving events even if
    // the cursor/finger leaves the canvas mid-operation.
    if (e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function' && e.pointerId !== undefined) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    }

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

    // 2. Tool: Add Room (Click & Drag to Create)
    if (activeTool === 'room') {
      const snapRes = findRoomSnapping(
        { x: worldPos.x, y: worldPos.y, width: 0, length: 0 },
        layout,
        {
          handle: 'draw',
          viewportScale: viewport.scale,
          screenTolerancePixels: roomSnapPixelTolerance,
          snapEnabled,
          snapStep,
        }
      );
      const startPt = { x: snapRes.snappedRoom.x, y: snapRes.snappedRoom.y };
      setRoomDrawStart(startPt);
      setAlignmentGuides(snapRes.guides);
      setSnapBadges(snapRes.snapBadges);
      setRoomWarnings(snapRes.warnings);
      setActiveMeasurements({
        width: 0,
        length: 0,
        x: startPt.x,
        y: startPt.y,
        area: 0,
      });
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

    // 8a. Site boundary edge / corner handles (select tool). A selected room's
    //     own handles take priority so a room resize never resizes the site.
    const selectedRoomHandle = selectedElement?.type === 'room'
      ? findRoomHandle((layout.rooms || []).find((r) => r.id === selectedElement.data.id), sx, sy)
      : null;
    if (activeTool === 'select' && !selectedRoomHandle) {
      const edgeHit = findPlotEdgeHandle(sx, sy);
      if (edgeHit) {
        onSelectElement({ type: 'plot', data: layout.plot });
        setDraggingHandle('plot-edge');
        setDragStartInfo({
          startWorld: worldPos,
          edge: edgeHit,
          snapshot: cloneLayout(layout),
          startViewport: { ...viewport },
        });
        historyManager.beginDrag();
        return;
      }
    }

    // 8b. Staircase width / length handles
    if (activeTool === 'select' && selectedElement?.type === 'staircase') {
      const stair = (layout.staircases || []).find((st) => st.id === selectedElement.data.id);
      if (stair && !stair.isLocked) {
        const b = getStaircaseBounds(stair);
        const p0 = worldToScreen(b.x, b.y);
        const bw = b.width * viewport.scale;
        const bh = b.length * viewport.scale;
        const handles = [
          { id: 'stair-e', x: p0.x + bw, y: p0.y + bh / 2 },
          { id: 'stair-w', x: p0.x, y: p0.y + bh / 2 },
          { id: 'stair-s', x: p0.x + bw / 2, y: p0.y + bh },
          { id: 'stair-n', x: p0.x + bw / 2, y: p0.y },
        ];
        const h = handles.find((hh) => Math.hypot(sx - hh.x, sy - hh.y) <= 10);
        if (h) {
          setDraggingHandle(h.id);
          setDragStartInfo({ startWorld: worldPos, initial: { ...stair }, bounds: b });
          historyManager.beginDrag();
          return;
        }
      }
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

    // 9. Tool: Select / Move / 8-Point Resizing
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
        const room = (layout.rooms || []).find((r) => r.id === selectedElement.data.id) || selectedElement.data;
        const rPos = worldToScreen(room.x, room.y);
        const rW = room.width * viewport.scale;
        const rH = room.length * viewport.scale;

        // Resize: capture the pointer-down world position, the room and the
        // whole layout. Every move is solved from this snapshot.
        if (selectedRoomHandle && !room.isLocked) {
          setDraggingHandle(selectedRoomHandle);
          setDragStartInfo({
            startWorld: worldPos,
            initial: { ...room },
            layoutSnapshot: cloneLayout(layout),
          });
          setResizeConflict(null);
          historyManager.beginDrag();
          return;
        }

        // Inline click-to-edit room dimension label
        const labelCenter = { x: rPos.x + rW / 2, y: rPos.y + rH / 2 + 7 };
        if (Math.hypot(sx - labelCenter.x, sy - labelCenter.y) <= 24) {
          openRoomDimensionEditor(room.id, 'width', labelCenter.x, labelCenter.y, room.width);
          return;
        }
      }
    }

    // General element hit detection
    const hit = findElementAtWorldPoint(worldPos.x, worldPos.y);
    if (hit) {
      onSelectElement(hit);
      if (hit.type === 'room') {
        setDraggingHandle('room-body');
        setDragStartInfo({
          startWorld: worldPos,
          hitType: 'room',
          initial: { ...hit.data },
          layoutSnapshot: cloneLayout(layout),
        });
        historyManager.beginDrag();
        return;
      }
      setDraggingHandle('element-body');
      setDragStartInfo({
        startWorld: worldPos,
        hitType: hit.type,
        initial: { ...hit.data },
        wallSnapshot: hit.type === 'wall' ? cloneLayout(layout.walls || []) : null,
        layoutSnapshot: hit.type === 'wall' ? cloneLayout(layout) : null,
      });
      setResizeConflict(null);
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
      setViewport((prev) => ({
        ...prev,
        panX: e.clientX - panStart.x,
        panY: e.clientY - panStart.y,
      }));
      return;
    }

    // 1. Live preview when drawing a new room with mouse
    if (activeTool === 'room' && roomDrawStart) {
      const rawBox = {
        x: Math.min(roomDrawStart.x, worldPos.x),
        y: Math.min(roomDrawStart.y, worldPos.y),
        width: Math.abs(worldPos.x - roomDrawStart.x),
        length: Math.abs(worldPos.y - roomDrawStart.y),
        freeX: worldPos.x,
        freeY: worldPos.y,
      };
      const snapRes = findRoomSnapping(rawBox, layout, {
        handle: 'draw',
        anchor: roomDrawStart,
        viewportScale: viewport.scale,
        screenTolerancePixels: roomSnapPixelTolerance,
        snapEnabled,
        snapStep,
      });
      setAlignmentGuides(snapRes.guides);
      setSnapBadges(snapRes.snapBadges);
      setRoomWarnings(snapRes.warnings);
      setActiveMeasurements({
        width: snapRes.snappedRoom.width,
        length: snapRes.snappedRoom.length,
        x: snapRes.snappedRoom.x,
        y: snapRes.snappedRoom.y,
        area: snapRes.snappedRoom.width * snapRes.snappedRoom.length,
      });
      return;
    }

    // Dragging / Resizing Handles
    if (draggingHandle && dragStartInfo && selectedElement) {
      const dx = worldPos.x - dragStartInfo.startWorld.x;
      const dy = worldPos.y - dragStartInfo.startWorld.y;

      // Site boundary drag: always recomputed from the drag-start snapshot so
      // the preview is deterministic and never accumulates drift.
      if (draggingHandle === 'plot-edge') {
        // Measure the drag in the drag-start viewport: the live viewport is
        // shifted below (to pin the fixed edge), which would otherwise feed back.
        const sv = dragStartInfo.startViewport;
        const dragWorld = { x: (sx - sv.panX) / sv.scale, y: (sy - sv.panY) / sv.scale };
        const change = computeSiteDragChange(dragStartInfo, dragWorld, e.shiftKey || e.altKey);
        const res = applySiteChange(dragStartInfo.snapshot, change);
        // Keep the fixed edge still on screen when the west / north edge moves.
        setViewport((prev) => ({
          ...prev,
          panX: sv.panX - res.shift.x * prev.scale,
          panY: sv.panY - res.shift.y * prev.scale,
        }));
        setSitePreview({
          width: res.nextLayout.plot.width,
          length: res.nextLayout.plot.length,
          conflicts: res.conflicts.filter((c) => c.severity !== 'info'),
          change,
          success: res.success,
        });
        historyManager.updateDuringDrag(res.nextLayout);
        onUpdateLayout(res.nextLayout);
        return;
      }

      // Staircase resize: regenerates the steps (step count is preserved)
      if (draggingHandle && draggingHandle.startsWith('stair-')) {
        const { initial, bounds } = dragStartInfo;
        const side = draggingHandle.slice(6);
        const minSize = 2;
        let next;
        if (side === 'e' || side === 'w') {
          const raw = side === 'e' ? bounds.width + dx : bounds.width - dx;
          next = resizeStaircaseWorld(initial, 'x', Math.max(minSize, snap(raw)));
          const nb = getStaircaseBounds(next);
          next = { ...next, x: side === 'w' ? bounds.x + bounds.width - nb.width : bounds.x, y: bounds.y };
        } else {
          const raw = side === 's' ? bounds.length + dy : bounds.length - dy;
          next = resizeStaircaseWorld(initial, 'y', Math.max(minSize, snap(raw)));
          const nb = getStaircaseBounds(next);
          next = { ...next, y: side === 'n' ? bounds.y + bounds.length - nb.length : bounds.y, x: bounds.x };
        }
        const nextLayout = {
          ...layout,
          staircases: layout.staircases.map((st) => (st.id === initial.id ? next : st)),
        };
        const nb = getStaircaseBounds(next);
        setActiveMeasurements({ width: nb.width, length: nb.length, x: nb.x, y: nb.y, area: nb.width * nb.length });
        historyManager.updateDuringDrag(nextLayout);
        onUpdateLayout(nextLayout);
        return;
      }

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
        const sel = snapshot.find((w) => w.id === wallId) || dragStartInfo.initial;
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
          const axis = orientation === 'horizontal' ? 'x' : 'y';
          const aligned = findAlignmentGuides(target, snapshot, axis, snapTolerance * 0.7, wallId);
          if (aligned.guides.length > 0) {
            target[axis] = aligned[axis];
            guides = aligned.guides;
          }
        }

        if (lockAxis && orientation === 'horizontal') target.y = orig.y;
        if (lockAxis && orientation === 'vertical') target.x = orig.x;

        const newSel = moveWallEndpoint(sel, which, target, { allowDiagonal });
        const newEndpoint = which === 'p1' ? { x: newSel.x1, y: newSel.y1 } : { x: newSel.x2, y: newSel.y2 };

        let nextWalls = snapshot.map((w) => (w.id === wallId ? newSel : w));
        nextWalls = moveConnectedEndpoints(nextWalls, orig, newEndpoint, wallId, 0.3);

        setAlignmentGuides(guides);
        const nextLayout = { ...layout, walls: nextWalls };
        historyManager.updateDuringDrag(nextLayout);
        onUpdateLayout(nextLayout);
        return;
      }

      // 3. Room Body Drag (Move whole room with smart alignment snapping & wall sync)
      if (draggingHandle === 'room-body' && selectedElement.type === 'room') {
        const snapshot = dragStartInfo.layoutSnapshot;
        const init = dragStartInfo.initial;
        const proposed = { ...init, x: init.x + dx, y: init.y + dy };
        const snapRes = findRoomSnapping(proposed, snapshot, {
          excludeRoomId: init.id,
          handle: 'body',
          viewportScale: viewport.scale,
          screenTolerancePixels: roomSnapPixelTolerance,
          snapEnabled,
          snapStep,
        });
        const target = snapRes.snappedRoom;
        const { layout: nextLayout, room: updatedRoom } = moveRoom(snapshot, init.id, target.x - init.x, target.y - init.y);
        historyManager.updateDuringDrag(nextLayout);
        onUpdateLayout(nextLayout);
        setAlignmentGuides(snapRes.guides);
        setSnapBadges(snapRes.snapBadges);
        setRoomWarnings(snapRes.warnings);
        setActiveMeasurements({
          width: updatedRoom.width,
          length: updatedRoom.length,
          x: updatedRoom.x,
          y: updatedRoom.y,
          area: updatedRoom.width * updatedRoom.length,
        });
        return;
      }

      // 4. Room resizing (edges and corners). dx / dy are world-feet deltas from
      //    the pointer-down position; geometry comes from the pointer-down
      //    snapshot, so nothing accumulates between move events.
      if (draggingHandle.startsWith('room-') && selectedElement.type === 'room') {
        const handleCode = draggingHandle.replace('room-', '');
        const init = dragStartInfo.initial;
        const snapshot = dragStartInfo.layoutSnapshot;
        const raw = edgeTargetsForHandle(init, handleCode, dx, dy);

        // Snap the moving edge(s) to grid / alignment targets of the snapshot
        const proposed = {
          x: raw.left ?? init.x,
          y: raw.top ?? init.y,
          width: (raw.right ?? init.x + init.width) - (raw.left ?? init.x),
          length: (raw.bottom ?? init.y + init.length) - (raw.top ?? init.y),
        };
        const snapRes = findRoomSnapping(proposed, snapshot, {
          excludeRoomId: init.id,
          handle: handleCode,
          anchor: {
            x: handleCode.includes('w') ? init.x + init.width : init.x,
            y: handleCode.includes('n') ? init.y + init.length : init.y,
          },
          viewportScale: viewport.scale,
          screenTolerancePixels: roomSnapPixelTolerance,
          snapEnabled,
          snapStep,
        });
        const sr = snapRes.snappedRoom;
        const targets = {};
        if (raw.left !== undefined) targets.left = sr.x;
        if (raw.right !== undefined) targets.right = sr.x + sr.width;
        if (raw.top !== undefined) targets.top = sr.y;
        if (raw.bottom !== undefined) targets.bottom = sr.y + sr.length;

        const res = resizeRoom(snapshot, init.id, targets);
        const updatedRoom = res.room;
        historyManager.updateDuringDrag(res.layout);
        onUpdateLayout(res.layout);
        setAlignmentGuides(snapRes.guides);
        setSnapBadges(snapRes.snapBadges);
        setRoomWarnings(snapRes.warnings);
        setResizeConflict(res.conflicts[0] || null);
        setActiveMeasurements({
          width: updatedRoom.width,
          length: updatedRoom.length,
          x: updatedRoom.x,
          y: updatedRoom.y,
          area: updatedRoom.width * updatedRoom.length,
        });
        return;
      }

      // 5. General Element Body Move (wall, door, window, staircase, etc.)
      if (draggingHandle === 'element-body') {
        const elemType = dragStartInfo.hitType;
        const id = dragStartInfo.initial.id;

        if (elemType === 'wall' && dragStartInfo.layoutSnapshot) {
          const w0 = dragStartInfo.initial;
          const vertical = Math.abs(w0.x1 - w0.x2) < 0.02;
          const horizontal = Math.abs(w0.y1 - w0.y2) < 0.02;
          if (vertical || horizontal) {
            const res = moveWallBoundary(dragStartInfo.layoutSnapshot, id, vertical ? snap(dx) : snap(dy));
            if (res) {
              historyManager.updateDuringDrag(res.layout);
              onUpdateLayout(res.layout);
              setResizeConflict(res.clamped ? res.reason : null);
              return;
            }
          }
        }
        if (elemType === 'wall') {
          const moveX = snap(dx);
          const moveY = snap(dy);
          const snapshot = dragStartInfo.wallSnapshot || layout.walls || [];
          const orig = snapshot.find((w) => w.id === id) || dragStartInfo.initial;
          const newA = { x: orig.x1 + moveX, y: orig.y1 + moveY };
          const newB = { x: orig.x2 + moveX, y: orig.y2 + moveY };
          const tolerance = 0.25;

          const nextWalls = snapshot.map((w) => {
            if (w.id === id) {
              return { ...w, x1: newA.x, y1: newA.y, x2: newB.x, y2: newB.y };
            }
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
          const nextDoors = layout.doors.map((d) => (d.id === id ? { ...d, x: newX, y: newY } : d));
          const nextLayout = { ...layout, doors: nextDoors };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'window') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextWins = layout.windows.map((w) => (w.id === id ? { ...w, x: newX, y: newY } : w));
          const nextLayout = { ...layout, windows: nextWins };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'staircase') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextStairs = layout.staircases.map((s) => (s.id === id ? { ...s, x: newX, y: newY } : s));
          const nextLayout = { ...layout, staircases: nextStairs };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'utility') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextUtils = layout.utilities.map((u) => (u.id === id ? { ...u, x: newX, y: newY } : u));
          const nextLayout = { ...layout, utilities: nextUtils };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        } else if (elemType === 'parking') {
          const newX = snap(dragStartInfo.initial.x + dx);
          const newY = snap(dragStartInfo.initial.y + dy);
          const nextParks = layout.parking.map((p) => (p.id === id ? { ...p, x: newX, y: newY } : p));
          const nextLayout = { ...layout, parking: nextParks };
          historyManager.updateDuringDrag(nextLayout);
          onUpdateLayout(nextLayout);
        }
      }
    }
  };

  // Pointer Up
  const handlePointerUp = (e) => {
    if (isPanning) {
      setIsPanning(false);
    }

    if (e && e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function' && e.pointerId !== undefined) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    if (activeTool === 'room' && roomDrawStart) {
      const rawBox = {
        x: Math.min(roomDrawStart.x, mouseWorldPos.x),
        y: Math.min(roomDrawStart.y, mouseWorldPos.y),
        width: Math.abs(mouseWorldPos.x - roomDrawStart.x),
        length: Math.abs(mouseWorldPos.y - roomDrawStart.y),
        freeX: mouseWorldPos.x,
        freeY: mouseWorldPos.y,
      };
      const snapRes = findRoomSnapping(rawBox, layout, {
        handle: 'draw',
        anchor: roomDrawStart,
        viewportScale: viewport.scale,
        screenTolerancePixels: roomSnapPixelTolerance,
        snapEnabled,
        snapStep,
      });
      const r = snapRes.snappedRoom;
      let finalW = r.width;
      let finalL = r.length;
      let finalX = r.x;
      let finalY = r.y;

      const dragDist = Math.hypot(mouseWorldPos.x - roomDrawStart.x, mouseWorldPos.y - roomDrawStart.y);
      if (dragDist < 0.6) {
        finalW = 12;
        finalL = 10;
        finalX = roomDrawStart.x;
        finalY = roomDrawStart.y;
      }

      if (finalW >= MIN_ROOM_DIMENSION && finalL >= MIN_ROOM_DIMENSION) {
        finalizeRoomPlacement({ x: finalX, y: finalY, width: finalW, length: finalL });
      } else {
        showPlacementNotice(`Room too small - minimum ${formatMeasurement(MIN_ROOM_DIMENSION, unit)} × ${formatMeasurement(MIN_ROOM_DIMENSION, unit)} required`);
      }

      setRoomDrawStart(null);
      setAlignmentGuides([]);
      setSnapBadges([]);
      setRoomWarnings([]);
      setActiveMeasurements(null);
      return;
    }

    if (draggingHandle === 'plot-edge' && dragStartInfo) {
      const preview = sitePreview;
      const startViewport = dragStartInfo.startViewport;
      setSitePreview(null);
      setDraggingHandle(null);
      setDragStartInfo(null);
      if (preview && !preview.success) {
        // Reject the live preview: restore the last valid layout (no history
        // step) and hand the change to the editor's conflict dialog.
        const restored = historyManager.cancelDrag();
        onUpdateLayout(restored);
        setViewport((prev) => ({ ...prev, panX: startViewport.panX, panY: startViewport.panY }));
        if (onRequestSiteChange) onRequestSiteChange(preview.change, restored);
        return;
      }
      // One undoable transaction for the whole resize + reflow
      historyManager.endDrag(layout);
      return;
    }

    if (draggingHandle) {
      if (resizeConflict) showPlacementNotice(`Stopped at the nearest valid size: ${resizeConflict}`);
      setResizeConflict(null);
      historyManager.endDrag(layout);
      setDraggingHandle(null);
      setDragStartInfo(null);
      setAlignmentGuides([]);
      setSnapBadges([]);
      setRoomWarnings([]);
      setActiveMeasurements(null);
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
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: activeTool === 'pan' || isPanning ? 'grabbing' : (activeTool === 'wall' || activeTool === 'room' ? 'crosshair' : 'default'),
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
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

        {/* Setback line / buildable area (derived from the plot and setbacks) */}
        {(() => {
          const sb = layout?.plot?.setbacks || {};
          const bx0 = Number(sb.west) || 0;
          const by0 = Number(sb.north) || 0;
          const bw = plotW - bx0 - (Number(sb.east) || 0);
          const bl = plotL - by0 - (Number(sb.south) || 0);
          if (bw <= 0 || bl <= 0) return null;
          const p0 = worldToScreen(bx0, by0);
          return (
            <rect
              key="buildable-area"
              x={p0.x}
              y={p0.y}
              width={bw * viewport.scale}
              height={bl * viewport.scale}
              fill="none"
              stroke="#94A3B8"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
          );
        })()}

        {/* Vastu Quadrant Badges */}
        <g fontSize="10" fontWeight="bold" fill="#B45309">
          <text x={plotScr.x + plotWidthPx - 26} y={plotScr.y + 18}>NE</text>
          <text x={plotScr.x + 10} y={plotScr.y + 18}>NW</text>
          <text x={plotScr.x + plotWidthPx - 26} y={plotScr.y + plotHeightPx - 10}>SE</text>
          <text x={plotScr.x + 10} y={plotScr.y + plotHeightPx - 10}>SW</text>
        </g>

        {/* Outer Plot Dimension Lines (interactive) */}
        {renderPlotDimensions()}

        {/* Site boundary resize handles (drag an edge; Shift = symmetric) */}
        {activeTool === 'select' && getPlotHandlePositions().map((h) => {
          const isCorner = h.edge.startsWith('corner');
          const cursor = isCorner
            ? (h.edge === 'corner-nw' || h.edge === 'corner-se' ? 'nwse-resize' : 'nesw-resize')
            : (h.edge === 'left' || h.edge === 'right' ? 'ew-resize' : 'ns-resize');
          const active = draggingHandle === 'plot-edge' && dragStartInfo?.edge === h.edge;
          return (
            <rect
              key={`plot-h-${h.edge}`}
              x={h.x - 5}
              y={h.y - 5}
              width="10"
              height="10"
              rx={isCorner ? 0 : 2}
              fill={active ? '#D97706' : '#FFFFFF'}
              stroke="#D97706"
              strokeWidth="1.5"
              style={{ cursor, pointerEvents: 'all' }}
            />
          );
        })}
        {sitePreview && (() => {
          const text = `${formatMeasurement(sitePreview.width, unit)} × ${formatMeasurement(sitePreview.length, unit)}` +
            (sitePreview.success ? '' : `  ·  ${sitePreview.conflicts.length} conflict${sitePreview.conflicts.length === 1 ? '' : 's'}`);
          const c = worldToScreen(plotW / 2, plotL / 2);
          return (
            <g key="site-preview" transform={`translate(${c.x}, ${c.y})`}>
              <rect x={-(text.length * 3.4 + 14)} y="-12" width={text.length * 6.8 + 28} height="22" rx="11"
                fill={sitePreview.success ? '#0F172A' : '#991B1B'} opacity="0.92" />
              <text x="0" y="3" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700" fontFamily="Segoe UI, sans-serif">{text}</text>
            </g>
          );
        })()}

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
                <g
                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openRoomDimensionEditor(room.id, 'width', rPos.x + rW / 2, rPos.y + rH / 2 + 7, room.width);
                  }}
                >
                  <text
                    x={rPos.x + rW / 2}
                    y={rPos.y + rH / 2 + 7}
                    textAnchor="middle"
                    fontSize={Math.max(8.5, Math.min(12, 9.5 * (viewport.scale / 18)))}
                    fontWeight="600"
                    fill="#334155"
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
                </g>
              )}

              {/* 8-Point Selection & Resize Handles */}
              {isSel && (
                <g key={`room-handles-${room.id}`}>
                  {/* Subtle selection outer glow */}
                  <rect
                    x={rPos.x - 2}
                    y={rPos.y - 2}
                    width={rW + 4}
                    height={rH + 4}
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                    opacity="0.8"
                  />

                  {/* Corner Handles */}
                  {/* NW */}
                  <rect
                    x={rPos.x - 6}
                    y={rPos.y - 6}
                    width="12"
                    height="12"
                    rx="2"
                    fill="#2563EB"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    style={{ cursor: 'nwse-resize', pointerEvents: 'all' }}
                  />
                  {/* NE */}
                  <rect
                    x={rPos.x + rW - 6}
                    y={rPos.y - 6}
                    width="12"
                    height="12"
                    rx="2"
                    fill="#2563EB"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    style={{ cursor: 'nesw-resize', pointerEvents: 'all' }}
                  />
                  {/* SE */}
                  <rect
                    x={rPos.x + rW - 6}
                    y={rPos.y + rH - 6}
                    width="12"
                    height="12"
                    rx="2"
                    fill="#2563EB"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    style={{ cursor: 'nwse-resize', pointerEvents: 'all' }}
                  />
                  {/* SW */}
                  <rect
                    x={rPos.x - 6}
                    y={rPos.y + rH - 6}
                    width="12"
                    height="12"
                    rx="2"
                    fill="#2563EB"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    style={{ cursor: 'nesw-resize', pointerEvents: 'all' }}
                  />

                  {/* Edge Handles */}
                  {/* N (Top) */}
                  <rect
                    x={rPos.x + rW / 2 - 8}
                    y={rPos.y - 5}
                    width="16"
                    height="10"
                    rx="3"
                    fill="#FFFFFF"
                    stroke="#2563EB"
                    strokeWidth="2"
                    style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
                  />
                  {/* S (Bottom) */}
                  <rect
                    x={rPos.x + rW / 2 - 8}
                    y={rPos.y + rH - 5}
                    width="16"
                    height="10"
                    rx="3"
                    fill="#FFFFFF"
                    stroke="#2563EB"
                    strokeWidth="2"
                    style={{ cursor: 'ns-resize', pointerEvents: 'all' }}
                  />
                  {/* W (Left) */}
                  <rect
                    x={rPos.x - 5}
                    y={rPos.y + rH / 2 - 8}
                    width="10"
                    height="16"
                    rx="3"
                    fill="#FFFFFF"
                    stroke="#2563EB"
                    strokeWidth="2"
                    style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
                  />
                  {/* E (Right) */}
                  <rect
                    x={rPos.x + rW - 5}
                    y={rPos.y + rH / 2 - 8}
                    width="10"
                    height="16"
                    rx="3"
                    fill="#FFFFFF"
                    stroke="#2563EB"
                    strokeWidth="2"
                    style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
                  />
                </g>
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
          const geo = calculateStaircaseGeometry(s);
          const isSel = selectedElement?.type === 'staircase' && selectedElement.data.id === s.id;
          const pts = (poly) => poly.map((pt) => { const q = worldToScreen(pt.x, pt.y); return `${q.x},${q.y}`; }).join(' ');
          const ln = (l, key, stroke, w) => {
            const a = worldToScreen(l.x1, l.y1);
            const b = worldToScreen(l.x2, l.y2);
            return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={w} />;
          };
          const label = worldToScreen(geo.labelPos.x, geo.labelPos.y);
          const b = geo.bounds;
          const p0 = worldToScreen(b.x, b.y);
          const bw = b.width * viewport.scale;
          const bh = b.length * viewport.scale;
          return (
            <g key={s.id}>
              <polygon points={pts(geo.outline)} fill={s.color || '#F8FAFC'} stroke={isSel ? '#2563EB' : '#475569'} strokeWidth={isSel ? 2 : 1.5} />
              {geo.landings.map((l, i) => (
                <polygon key={`ld-${i}`} points={pts(l.polygon)} fill="#EEF2F7" stroke="#64748B" strokeWidth="1" />
              ))}
              {geo.flights.map((f) => (
                <g key={`fl-${f.index}`}>
                  <polygon points={pts(f.polygon)} fill="none" stroke="#64748B" strokeWidth="1" />
                  {f.treads.map((t, i) => ln(t, `tr-${f.index}-${i}`, '#94A3B8', 1))}
                </g>
              ))}
              {geo.dividers.map((d, i) => ln(d, `dv-${i}`, '#334155', 1.5))}
              <polyline points={pts(geo.arrow.points)} fill="none" stroke="#0F172A" strokeWidth="1.2" />
              <polyline points={pts(geo.arrow.arrowHead)} fill="none" stroke="#0F172A" strokeWidth="1.2" />
              <text x={label.x} y={label.y + 3} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#0F172A">
                {`${geo.labelText} · ${geo.metrics.totalRisers}R`}
              </text>
              {isSel && !s.isLocked && [
                { id: 'e', x: p0.x + bw, y: p0.y + bh / 2, c: 'ew-resize' },
                { id: 'w', x: p0.x, y: p0.y + bh / 2, c: 'ew-resize' },
                { id: 's', x: p0.x + bw / 2, y: p0.y + bh, c: 'ns-resize' },
                { id: 'n', x: p0.x + bw / 2, y: p0.y, c: 'ns-resize' },
              ].map((h) => (
                <rect key={`sh-${h.id}`} x={h.x - 5} y={h.y - 5} width="10" height="10" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" style={{ cursor: h.c, pointerEvents: 'all' }} />
              ))}
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

        {/* Real-time Alignment Guides */}
        {alignmentGuides.map((g, idx) => {
          if (g.orientation === 'v') {
            const sx = worldToScreen(g.pos, 0).x;
            return (
              <g key={`guide-v-${idx}-${g.pos}`}>
                <line
                  x1={sx}
                  y1={0}
                  x2={sx}
                  y2={3000}
                  stroke="#2563EB"
                  strokeWidth="1.2"
                  strokeDasharray="4,3"
                  opacity="0.85"
                />
                {g.label && (
                  <g transform={`translate(${sx + 4}, 28)`}>
                    <rect x="0" y="-11" width={g.label.length * 6.5 + 8} height="15" rx="3" fill="#0F172A" opacity="0.88" />
                    <text x="4" y="0" fill="#93C5FD" fontSize="9" fontWeight="600" fontFamily="Segoe UI, sans-serif">
                      {g.label}
                    </text>
                  </g>
                )}
              </g>
            );
          } else {
            const sy = worldToScreen(0, g.pos).y;
            return (
              <g key={`guide-h-${idx}-${g.pos}`}>
                <line
                  x1={0}
                  y1={sy}
                  x2={3000}
                  y2={sy}
                  stroke="#2563EB"
                  strokeWidth="1.2"
                  strokeDasharray="4,3"
                  opacity="0.85"
                />
                {g.label && (
                  <g transform={`translate(28, ${sy - 4})`}>
                    <rect x="0" y="-11" width={g.label.length * 6.5 + 8} height="15" rx="3" fill="#0F172A" opacity="0.88" />
                    <text x="4" y="0" fill="#93C5FD" fontSize="9" fontWeight="600" fontFamily="Segoe UI, sans-serif">
                      {g.label}
                    </text>
                  </g>
                )}
              </g>
            );
          }
        })}

        {/* Visible Snap Indicators */}
        {snapBadges.map((badge, idx) => {
          const scr = worldToScreen(badge.pos.x, badge.pos.y);
          return (
            <g key={`snap-badge-${idx}`} transform={`translate(${scr.x + 8}, ${scr.y - 14})`}>
              <rect
                x="0"
                y="-13"
                width={badge.text.length * 6.5 + 12}
                height="18"
                rx="9"
                fill="#0F172A"
                stroke="#3B82F6"
                strokeWidth="1.2"
                opacity="0.95"
              />
              <text
                x="6"
                y="0"
                fill="#FFFFFF"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="Segoe UI, sans-serif"
              >
                {badge.text}
              </text>
            </g>
          );
        })}

        {/* Room Drawing Live Preview (Add Room Tool) */}
        {activeTool === 'room' && roomDrawStart && (() => {
          const rawBox = {
            x: Math.min(roomDrawStart.x, mouseWorldPos.x),
            y: Math.min(roomDrawStart.y, mouseWorldPos.y),
            width: Math.abs(mouseWorldPos.x - roomDrawStart.x),
            length: Math.abs(mouseWorldPos.y - roomDrawStart.y),
            freeX: mouseWorldPos.x,
            freeY: mouseWorldPos.y,
          };
          const snapRes = findRoomSnapping(rawBox, layout, {
            handle: 'draw',
            anchor: roomDrawStart,
            viewportScale: viewport.scale,
            screenTolerancePixels: roomSnapPixelTolerance,
            snapEnabled,
            snapStep,
          });
          const r = snapRes.snappedRoom;
          const scr = worldToScreen(r.x, r.y);
          const scrW = r.width * viewport.scale;
          const scrH = r.length * viewport.scale;
          const area = r.width * r.length;
          const hasWarning = snapRes.warnings.length > 0;
          const color = hasWarning ? '#EF4444' : '#2563EB';

          return (
            <g key="room-draw-live-preview">
              <rect
                x={scr.x}
                y={scr.y}
                width={scrW}
                height={scrH}
                fill={hasWarning ? 'rgba(239, 68, 68, 0.12)' : 'rgba(37, 99, 235, 0.14)'}
                stroke={color}
                strokeWidth="2.5"
                strokeDasharray="6,4"
              />
              {/* Corner handles */}
              <circle cx={scr.x} cy={scr.y} r="3.5" fill={color} />
              <circle cx={scr.x + scrW} cy={scr.y} r="3.5" fill={color} />
              <circle cx={scr.x + scrW} cy={scr.y + scrH} r="3.5" fill={color} />
              <circle cx={scr.x} cy={scr.y + scrH} r="3.5" fill={color} />

              {/* Center dimension overlay badge */}
              {scrW > 40 && scrH > 30 && (
                <g transform={`translate(${scr.x + scrW / 2}, ${scr.y + scrH / 2})`}>
                  <rect
                    x="-70"
                    y="-20"
                    width="140"
                    height="40"
                    rx="6"
                    fill="#0F172A"
                    stroke={color}
                    strokeWidth="1.2"
                    opacity="0.92"
                  />
                  <text x="0" y="-4" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700" fontFamily="Segoe UI, sans-serif">
                    {formatMeasurement(r.width, unit)} × {formatMeasurement(r.length, unit)}
                  </text>
                  <text x="0" y="11" textAnchor="middle" fill={hasWarning ? '#FCA5A5' : '#38BDF8'} fontSize="10" fontWeight="600" fontFamily="Segoe UI, sans-serif">
                    {formatArea(area, unit)}
                  </text>
                </g>
              )}

              {/* Warning badge if exceeds bounds */}
              {hasWarning && (
                <g transform={`translate(${scr.x + scrW / 2}, ${scr.y - 12})`}>
                  <rect
                    x={-Math.min(160, snapRes.warnings[0].length * 3.4 + 14)}
                    y="-11"
                    width={Math.min(320, snapRes.warnings[0].length * 6.8 + 28)}
                    height="18"
                    rx="4"
                    fill="#7F1D1D"
                    stroke="#EF4444"
                    strokeWidth="1"
                  />
                  <text x="0" y="2" textAnchor="middle" fill="#FEE2E2" fontSize="9" fontWeight="700" fontFamily="Segoe UI, sans-serif">
                    ⚠️ {snapRes.warnings[0]}
                  </text>
                </g>
              )}
            </g>
          );
        })()}

        {/* Floating Measurements Pill while dragging/resizing a room */}
        {activeMeasurements && (draggingHandle && (draggingHandle.startsWith('room-') || draggingHandle.startsWith('stair-'))) && (() => {
          const scr = worldToScreen(activeMeasurements.x, activeMeasurements.y);
          const scrW = activeMeasurements.width * viewport.scale;
          const text = `${formatMeasurement(activeMeasurements.width, unit)} × ${formatMeasurement(activeMeasurements.length, unit)}  |  ${formatArea(activeMeasurements.area, unit)}` +
            (resizeConflict ? '  ·  limit reached' : '');
          return (
            <g key="active-measurements-pill" transform={`translate(${scr.x + scrW / 2}, ${scr.y - 18})`}>
              <rect
                x={-Math.min(160, text.length * 3.4 + 14)}
                y="-11"
                width={Math.min(320, text.length * 6.8 + 28)}
                height="20"
                rx="10"
                fill="#0F172A"
                stroke="#3B82F6"
                strokeWidth="1.2"
                opacity="0.95"
              />
              <text x="0" y="3" textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="700" fontFamily="Segoe UI, sans-serif">
                {text}
              </text>
            </g>
          );
        })()}

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

      {/* Inline numeric editor for a room dimension label */}
      {editingRoomDim && (
        <input
          ref={roomDimInputRef}
          value={roomDimInputValue}
          autoFocus
          onChange={(e) => setRoomDimInputValue(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRoomDimensionEdit();
            else if (e.key === 'Escape') cancelRoomDimensionEdit();
          }}
          onBlur={commitRoomDimensionEdit}
          style={{
            position: 'absolute',
            left: editingRoomDim.screenX - 48,
            top: editingRoomDim.screenY - 15,
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
