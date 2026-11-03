/**
 * AutoPlot Interactive 2D Architectural CAD Canvas
 * Features:
 * - Real world coordinates (feet) <-> screen pixel transformation
 * - Mouse wheel zoom centered at cursor & mouse drag panning
 * - Rulers (Top & Left) with real-world unit tick marks
 * - Grid with toggleable snapping (endpoint, midpoint, center, intersection, perpendicular, wall, room, site, grid)
 * - Hit detection, box selection and multi-selection for all architectural elements
 * - Live interactive handles (Wall endpoints, Room resize corners, Door/Window jambs, Entity vertices)
 * - Drawing tools: Wall, Room, Line, Polyline, Rectangle, Circle, Arc, Polygon, Door, Window, Staircase, Column, Parking, Text, Dimension, Measure
 * - Modify tools: Move, Copy, Rotate, Mirror, Scale, Offset, Trim, Extend, Fillet, Chamfer, Stretch, Break, Polar Array, Delete
 *
 * Every drag is solved from the geometry captured at pointer-down, so nothing
 * accumulates between pointer moves and the result does not depend on zoom.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  snapValue,
  createRoom,
  createDoor,
  createWindow,
  createStaircase,
  createColumn,
  createParking,
  createDimension,
  createAnnotation,
  cloneLayout,
  getPlotDimensionMeta,
  syncPlotDimensions,
  resizePlot,
  MIN_ROOM_DIMENSION,
  checkRoomPlotFit,
  findRoomSnapping,
  createRoomBoundaryWalls,
  resizePlotBoundary,
  describeOutsidePlot,
  getPlotRect,
  calculateStaircaseGeometry,
  getStaircaseBounds,
  resizeStaircaseWorld,
} from './layoutModel';
import { formatMeasurement, formatArea, parseToFeet } from './units';
import {
  resizeRoom,
  moveRoom,
  setRoomDimension,
  edgeTargetsForHandle,
  screenToWorldPoint,
  worldToScreenPoint,
} from './roomResize';
import {
  buildWall,
  getOpeningGeometry,
  moveOpening,
  moveWallBody,
  moveWallEndpointTo,
  orthoPoint,
  placeOpeningOnWall,
  resizeOpening,
} from './wallOps';
import {
  COLLECTIONS,
  breakAtClick,
  chamferElements,
  copySelection,
  createArcEntity,
  createCircleEntity,
  createLineEntity,
  createPolylineEntity,
  createRectangleEntity,
  createRegularPolygonEntity,
  deleteSelection,
  extendElement,
  filletElements,
  getElement,
  isPlotDimension,
  makeMirror,
  makeRotate,
  makeScale,
  makeTranslate,
  offsetElement,
  pickOutline,
  polarArray,
  stretchInBox,
  transformElement,
  transformSelection,
  trimElement,
} from './cadCommands';
import {
  annotationBox,
  boxSelect,
  hitTestAll,
  dimensionLine,
  isItemSelected,
  nextOverlappingHit,
  selectionFromItems,
  selectionItems,
  toSelection,
  toggleInSelection,
} from './selectionModel';
import { findPointSnap } from './snapEngine';
import { pointAtAngle, arcSweep } from './cadGeometry';

const DRAG_THRESHOLD_PX = 3;
const OPENING_PICK_PX = 40;
const OUTLINE_PICK_PX = 8;
const HANDLE_PICK_PX = 10;

// Tools that act on the current selection and refuse to start without one.
const NEEDS_SELECTION = new Set(['move', 'copy', 'rotate', 'mirror', 'scale', 'polar-array']);

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
  toolParams = {},
  notice = null,
  onNotice,
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
  const [draggingHandle, setDraggingHandle] = useState(null); // 'wall-p1' | 'wall-p2' | 'room-nw'...'room-se' | 'room-body' | 'element-body' | 'multi-body' | 'opening-a' | 'opening-b' | 'entity-vertex' | 'entity-radius' | 'dimension-line' | 'plot-edge' | 'stair-*'
  const [dragStartInfo, setDragStartInfo] = useState(null);
  const [alignmentGuides, setAlignmentGuides] = useState([]);
  const [snapBadges, setSnapBadges] = useState([]);
  const [roomWarnings, setRoomWarnings] = useState([]);
  const [activeMeasurements, setActiveMeasurements] = useState(null);
  const [resizeConflict, setResizeConflict] = useState(null); // reason a room / wall drag stopped short
  const [sitePreview, setSitePreview] = useState(null); // { width, length, conflicts, change, success } while dragging a plot edge

  // Pending room placement confirmation (room drawn outside buildable area)
  const [pendingRoomPlacement, setPendingRoomPlacement] = useState(null); // { room, warnings, buildable, exceeds }

  // Inline dimension label editing (Mode B)
  const [editingDim, setEditingDim] = useState(null); // { axis, value, screenX, screenY }
  const [dimInputValue, setDimInputValue] = useState('');

  // Inline Room Dimension label editing
  const [editingRoomDim, setEditingRoomDim] = useState(null); // { roomId, field, screenX, screenY }
  const [roomDimInputValue, setRoomDimInputValue] = useState('');

  // Drawing Tools State
  const [roomDrawStart, setRoomDrawStart] = useState(null);
  const [toolPoints, setToolPoints] = useState([]); // points picked so far by the active tool
  const [toolRefs, setToolRefs] = useState([]); // objects picked so far by the active tool
  const [measureResult, setMeasureResult] = useState(null); // { a, b } kept on screen after the second click
  const [cursorSnap, setCursorSnap] = useState(null); // { x, y, kind, label }
  const [boxDrag, setBoxDrag] = useState(null); // { start, end, purpose: 'select' | 'stretch', additive }
  const [stretchBox, setStretchBox] = useState(null); // committed stretch window { x1, y1, x2, y2 }

  const movedRef = useRef(false); // has the active drag passed the click threshold?
  const sitePreviewRef = useRef(null);
  const activePointerRef = useRef(null);
  const spaceHeldRef = useRef(false);
  const pendingMoveRef = useRef(null);
  const rafRef = useRef(null);
  const processMoveRef = useRef(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // The latest committed geometry. An inspector field that commits on blur has
  // already updated this by the time a canvas pointer-down reads it.
  const liveLayout = () => historyManager?.getCurrent?.() || layout;

  // Convert World Coordinates (ft) to Screen Pixels
  const worldToScreen = useCallback((wx, wy) => worldToScreenPoint(viewport, wx, wy), [viewport]);

  // Convert Screen Pixels to World Coordinates (ft) - the only conversion drags use
  const screenToWorld = useCallback((sx, sy) => screenToWorldPoint(viewport, sx, sy), [viewport]);

  // Snap to grid if enabled
  const snap = useCallback((val) => {
    if (!snapEnabled) return val;
    return snapValue(val, snapStep);
  }, [snapEnabled, snapStep]);

  // Snap tolerance in screen pixels, driven by the configurable snap tolerance
  // control so it stays consistent at every zoom level.
  const roomSnapPixelTolerance = Math.max(6, Math.min(40, (snapTolerance / 0.75) * 12));

  const showNotice = (text) => {
    if (onNotice) onNotice(text);
  };

  /** Resolve a pointer position through the snap engine. `from` enables perpendicular and ortho. */
  const resolvePoint = (world, { from = null, ortho = false, excludeWallId = null, excludeEntityId = null, base = layout } = {}) => {
    const hit = findPointSnap(world, base, {
      scale: viewport.scale,
      pixelTolerance: roomSnapPixelTolerance,
      snapEnabled,
      snapStep,
      from,
      excludeWallId,
      excludeEntityId,
    });
    if (ortho && from) {
      const o = orthoPoint(from, hit);
      return { ...hit, x: o.x, y: o.y };
    }
    return hit;
  };

  const resetToolState = () => {
    setToolPoints([]);
    setToolRefs([]);
    setStretchBox(null);
    setBoxDrag(null);
    setMeasureResult(null);
    setRoomDrawStart(null);
  };

  useEffect(() => {
    resetToolState();
    if (activeTool !== 'select' && NEEDS_SELECTION.has(activeTool) && selectionItems(selectedElement).length === 0) {
      showNotice('Select the objects first, then choose this command.');
    }
  }, [activeTool]);

  // ----- Committing -----

  const commit = (next, selection) => {
    historyManager.pushState(next);
    onUpdateLayout(next);
    if (selection !== undefined) onSelectElement(selection);
  };

  /** Commit a command result and report whatever it could not do. */
  const applyResult = (res, { selectCreated = false, keepSelection = true } = {}) => {
    if (res.reason) showNotice(res.reason);
    else if (res.skipped?.length) showNotice(res.skipped[0]);
    if (!res.layout || res.layout === liveLayout()) return false;
    let selection;
    if (selectCreated && res.created?.length) selection = selectionFromItems(res.layout, res.created);
    else if (!keepSelection) selection = null;
    commit(res.layout, selection);
    return true;
  };

  // Commit a room into the layout (history + boundary walls + selection)
  const commitRoomPlacement = (room) => {
    const base = liveLayout();
    const newRoom = createRoom({
      name: `Room ${base.rooms?.length ? base.rooms.length + 1 : 1}`,
      x: room.x,
      y: room.y,
      width: room.width,
      length: room.length,
    });
    const nextWalls = createRoomBoundaryWalls(base, newRoom);
    commit({ ...base, rooms: [...(base.rooms || []), newRoom], walls: nextWalls }, { type: 'room', data: newRoom });
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
    commitRoomPlacement({ ...room, x: Number(newX.toFixed(4)), y: Number(newY.toFixed(4)) });
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
      width: Number(w.toFixed(4)),
      length: Number(l.toFixed(4)),
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
    });
    setPendingRoomPlacement(null);
  };

  // Auto-fit drawing to screen on initial mount
  const fitToScreen = useCallback(() => {
    if (!containerRef.current || !layout) return;
    const rect = containerRef.current.getBoundingClientRect();
    const site = getPlotRect(layout);
    const plotW = site.width;
    const plotL = site.length;

    const availableW = Math.max(200, rect.width - 160);
    const availableH = Math.max(200, rect.height - 160);

    const scaleX = availableW / plotW;
    const scaleY = availableH / plotL;
    const newScale = Math.max(8, Math.min(scaleX, scaleY, 28));

    const newPanX = (rect.width - plotW * newScale) / 2 - site.x0 * newScale;
    const newPanY = (rect.height - plotL * newScale) / 2 - site.y0 * newScale;

    setViewport({
      scale: newScale,
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

  // Mouse Wheel Zoom centered at cursor. Attached natively because React's
  // wheel listener is passive, where preventDefault cannot stop the page scrolling.
  const siteDragActiveRef = useRef(false);
  siteDragActiveRef.current = draggingHandle === 'plot-edge';
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      // A site-edge drag is measured in the viewport it started with.
      if (siteDragActiveRef.current) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setViewport((prev) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const scale = Math.max(6, Math.min(80, prev.scale * factor));
        const wx = (sx - prev.panX) / prev.scale;
        const wy = (sy - prev.panY) / prev.scale;
        return { scale, panX: sx - wx * scale, panY: sy - wy * scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- Outer plot dimension annotation helpers (width / height lines) ----
  const getDimLabelWorld = (axis) => {
    const site = getPlotRect(layout);
    const meta = getPlotDimensionMeta(layout, axis);
    if (axis === 'width') return { x: site.x0 + site.width / 2, y: site.y0 - meta.offset };
    return { x: site.x0 - meta.offset, y: site.y0 + site.length / 2 };
  };

  const findDimensionAtWorldPoint = (wx, wy) => {
    if (!layout?.plot) return null;
    const site = getPlotRect(layout);
    const w = getPlotDimensionMeta(layout, 'width');
    const l = getPlotDimensionMeta(layout, 'length');

    const clickScr = worldToScreen(wx, wy);
    const isLabel = (axis) => {
      const lw = getDimLabelWorld(axis);
      const scr = worldToScreen(lw.x, lw.y);
      return Math.abs(clickScr.x - scr.x) <= 38 && Math.abs(clickScr.y - scr.y) <= 13;
    };

    const lineTol = 8 / viewport.scale;
    if (isLabel('width')) return { axis: 'width', meta: w, onLabel: true };
    if (isLabel('length')) return { axis: 'length', meta: l, onLabel: true };
    const widthLineY = site.y0 - w.offset;
    const lengthLineX = site.x0 - l.offset;
    if (Math.abs(wy - widthLineY) < lineTol && wx > site.x0 - lineTol && wx < site.x1 + lineTol) {
      return { axis: 'width', meta: w, onLabel: false };
    }
    if (Math.abs(wx - lengthLineX) < lineTol && wy > site.y0 - lineTol && wy < site.y1 + lineTol) {
      return { axis: 'length', meta: l, onLabel: false };
    }
    return null;
  };

  const openDimensionEditor = (axis) => {
    const meta = getPlotDimensionMeta(layout, axis);
    const lw = getDimLabelWorld(axis);
    const scr = worldToScreen(lw.x, lw.y);
    setEditingDim({ axis, screenX: scr.x, screenY: scr.y, original: formatMeasurement(meta.value, unit) });
    setDimInputValue(formatMeasurement(meta.value, unit));
    onSelectElement({ type: 'dimension', data: meta });
  };

  const commitDimensionEdit = () => {
    if (!editingDim) return;
    const { axis, original } = editingDim;
    setEditingDim(null);
    if (dimInputValue.trim() === original) return; // untouched: never round the plot to the display precision
    const feet = parseToFeet(dimInputValue, unit);
    if (feet !== null && feet > 0) {
      if (onRequestPlotResize) {
        // Routed through LayoutEditor so unsafe shrinks can be confirmed first.
        onRequestPlotResize(axis, feet);
      } else {
        commit(resizePlot(layout, axis, feet));
      }
    } else {
      showNotice('That is not a valid measurement, so the plot was not changed.');
    }
  };

  const cancelDimensionEdit = () => setEditingDim(null);

  // Inline Room Dimension Editing
  const openRoomDimensionEditor = (roomId, field, sx, sy, curVal) => {
    setEditingRoomDim({ roomId, field, screenX: sx, screenY: sy, original: formatMeasurement(curVal, unit) });
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
    const { roomId, field, original } = editingRoomDim;
    setEditingRoomDim(null);
    if (roomDimInputValue.trim() === original) return;
    const feet = parseToFeet(roomDimInputValue, unit);
    if (feet === null || feet < MIN_ROOM_DIMENSION) {
      showNotice(`Enter a size of at least ${formatMeasurement(MIN_ROOM_DIMENSION, unit)}.`);
      return;
    }
    const res = setRoomDimension(liveLayout(), roomId, field, Number(feet.toFixed(4)));
    if (res.room) {
      commit(res.layout, { type: 'room', data: res.room });
      if (res.conflicts.length) showNotice(`Stopped at the nearest valid size: ${res.conflicts[0]}`);
    }
  };

  const cancelRoomDimensionEdit = () => setEditingRoomDim(null);

  const cancelActiveDrag = () => {
    const restored = historyManager.cancelDrag();
    onUpdateLayout(restored);
    if (dragStartInfo?.startViewport) setViewport(dragStartInfo.startViewport);
    setDraggingHandle(null);
    setDragStartInfo(null);
    setSitePreview(null);
    setResizeConflict(null);
    setAlignmentGuides([]);
    setSnapBadges([]);
    setRoomWarnings([]);
    setActiveMeasurements(null);
    movedRef.current = false;
  };

  const finishPolyline = () => {
    if (activeTool === 'polyline' && toolPoints.length >= 2) {
      const base = liveLayout();
      const ent = createPolylineEntity(toolPoints);
      commit({ ...base, cadEntities: [...(base.cadEntities || []), ent] }, { type: 'entity', data: ent });
    }
    setToolPoints([]);
  };

  // Keyboard: Escape cancels from the innermost state out; Enter finishes a polyline; Space pans.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const typing = (e) => ['INPUT', 'TEXTAREA'].includes(e.target?.tagName);
    const consume = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const handleKeyDown = (e) => {
      if (e.key === ' ' && !typing(e)) {
        spaceHeldRef.current = true;
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && !typing(e) && activeTool === 'polyline') {
        finishPolyline();
        consume(e);
        return;
      }
      if (e.key !== 'Escape') return;
      if (draggingHandle) { cancelActiveDrag(); consume(e); return; }
      if (boxDrag) { setBoxDrag(null); consume(e); return; }
      if (pendingRoomPlacement) { setPendingRoomPlacement(null); consume(e); return; }
      if (roomDrawStart) {
        setRoomDrawStart(null);
        setAlignmentGuides([]);
        setSnapBadges([]);
        setRoomWarnings([]);
        setActiveMeasurements(null);
        consume(e);
        return;
      }
      if (toolPoints.length || toolRefs.length || stretchBox || measureResult) { resetToolState(); consume(e); return; }
      if (editingRoomDim) { setEditingRoomDim(null); consume(e); return; }
      if (editingDim) { setEditingDim(null); consume(e); }
    };
    const handleKeyUp = (e) => {
      if (e.key === ' ') spaceHeldRef.current = false;
    };
    // Capture phase: this runs before the editor's own Escape handling.
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [pendingRoomPlacement, roomDrawStart, toolPoints, toolRefs, stretchBox, measureResult, editingRoomDim, editingDim, draggingHandle, boxDrag, activeTool, layout]);

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
    const c = corners.find((k) => Math.hypot(sx - k.x, sy - k.y) <= HANDLE_PICK_PX);
    if (c) return c.id;
    const m = mids.find((k) => Math.hypot(sx - k.x, sy - k.y) <= HANDLE_PICK_PX);
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
    const { x0, y0, x1, y1 } = getPlotRect(layout);
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const p = (x, y) => worldToScreen(x, y);
    return [
      { edge: 'top', ...p(midX, y0) },
      { edge: 'bottom', ...p(midX, y1) },
      { edge: 'left', ...p(x0, midY) },
      { edge: 'right', ...p(x1, midY) },
      { edge: 'corner-nw', ...p(x0, y0) },
      { edge: 'corner-ne', ...p(x1, y0) },
      { edge: 'corner-sw', ...p(x0, y1) },
      { edge: 'corner-se', ...p(x1, y1) },
    ];
  };

  const findPlotEdgeHandle = (sx, sy) => {
    if (!layout?.plot) return null;
    const hit = getPlotHandlePositions().find((h) => Math.hypot(sx - h.x, sy - h.y) <= PLOT_EDGE_HANDLE_PX);
    if (hit) return hit.edge;
    if (selectedElement?.type !== 'plot') return null;
    const site = getPlotRect(layout);
    const a = worldToScreen(site.x0, site.y0);
    const b = worldToScreen(site.x1, site.y1);
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
    // Snap to the grid step; the plot keeps a minimum size of 5 ft
    width = Math.max(5, snapEnabled ? snapValue(width, snapStep) : Number(width.toFixed(2)));
    length = Math.max(5, snapEnabled ? snapValue(length, snapStep) : Number(length.toFixed(2)));
    return { width, length, edge: symmetric ? 'symmetric' : e };
  };

  /** Handle of the selected element under the pointer. Handles outrank object bodies. */
  const findSelectedHandle = (base, sx, sy) => {
    if (!selectedElement || selectedElement.type === 'multi' || !selectedElement.data?.id) return null;
    const { type } = selectedElement;
    const el = getElement(base, { type, id: selectedElement.data.id });
    if (!el || el.isLocked) return null;
    const near = (wx, wy, px = HANDLE_PICK_PX) => {
      const q = worldToScreen(wx, wy);
      return Math.hypot(sx - q.x, sy - q.y) <= px;
    };
    if (type === 'room') {
      const id = findRoomHandle(el, sx, sy);
      return id ? { kind: 'room', id, el } : null;
    }
    if (type === 'wall') {
      if (near(el.x1, el.y1)) return { kind: 'wall', id: 'wall-p1', el };
      if (near(el.x2, el.y2)) return { kind: 'wall', id: 'wall-p2', el };
      return null;
    }
    if (type === 'door' || type === 'window') {
      const g = getOpeningGeometry(el, base.walls);
      if (near(g.a.x, g.a.y, 8)) return { kind: 'opening', id: 'opening-a', el, geometry: g };
      if (near(g.b.x, g.b.y, 8)) return { kind: 'opening', id: 'opening-b', el, geometry: g };
      return null;
    }
    if (type === 'staircase') {
      const b = getStaircaseBounds(el);
      const handles = [
        { id: 'stair-e', x: b.x + b.width, y: b.y + b.length / 2 },
        { id: 'stair-w', x: b.x, y: b.y + b.length / 2 },
        { id: 'stair-s', x: b.x + b.width / 2, y: b.y + b.length },
        { id: 'stair-n', x: b.x + b.width / 2, y: b.y },
      ];
      const h = handles.find((k) => near(k.x, k.y));
      return h ? { kind: 'stair', id: h.id, el, bounds: b } : null;
    }
    if (type === 'entity') {
      if (el.kind === 'line') {
        if (near(el.x1, el.y1)) return { kind: 'vertex', id: 'entity-vertex', el, index: 0 };
        if (near(el.x2, el.y2)) return { kind: 'vertex', id: 'entity-vertex', el, index: 1 };
      } else if (el.points) {
        const index = el.points.findIndex((p) => near(p.x, p.y));
        if (index >= 0) return { kind: 'vertex', id: 'entity-vertex', el, index };
      } else if (near(el.cx + el.r, el.cy) && el.kind === 'circle') {
        return { kind: 'radius', id: 'entity-radius', el };
      } else if (el.kind === 'arc') {
        const m = pointAtAngle(el, el.start + arcSweep(el) / 2);
        if (near(m.x, m.y)) return { kind: 'radius', id: 'entity-radius', el };
      }
    }
    return null;
  };

  // ---------------------------------------------------------------------
  // Tool actions: a point was picked with the active tool
  // ---------------------------------------------------------------------

  const addEntity = (base, entity) => commit({ ...base, cadEntities: [...(base.cadEntities || []), entity] }, { type: 'entity', data: entity });

  const handleToolPick = (world, e, base) => {
    const tool = activeTool;
    const prev = toolPoints[toolPoints.length - 1] || null;
    const wantsOrtho = (tool === 'wall' && !allowDiagonal) || e.shiftKey;
    const pt = resolvePoint(world, { from: prev, ortho: wantsOrtho, base });
    const p = { x: pt.x, y: pt.y };
    const pickTol = OUTLINE_PICK_PX / viewport.scale;
    const selection = selectionItems(selectedElement);
    const addPoint = () => setToolPoints((list) => [...list, p]);
    const done = () => setToolPoints([]);

    switch (tool) {
      case 'wall': {
        if (!prev) { addPoint(); return; }
        const wall = buildWall(prev, p);
        if (!wall) { showNotice('A wall needs two different points.'); return; }
        commit({ ...base, walls: [...(base.walls || []), wall] }, { type: 'wall', data: wall });
        done();
        return;
      }
      case 'line': {
        if (!prev) { addPoint(); return; }
        if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-3) { showNotice('A line needs two different points.'); return; }
        addEntity(base, createLineEntity(prev, p));
        done();
        return;
      }
      case 'polyline': {
        // A double-click lands twice on one point: that finishes the polyline.
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-3) { finishPolyline(); return; }
        addPoint();
        return;
      }
      case 'rectangle': {
        if (!prev) { addPoint(); return; }
        if (Math.abs(p.x - prev.x) < 1e-3 || Math.abs(p.y - prev.y) < 1e-3) { showNotice('A rectangle needs a width and a length.'); return; }
        addEntity(base, createRectangleEntity(prev, p));
        done();
        return;
      }
      case 'circle': {
        if (!prev) { addPoint(); return; }
        const r = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (r < 1e-3) { showNotice('A circle needs a radius.'); return; }
        addEntity(base, createCircleEntity(prev, r));
        done();
        return;
      }
      case 'arc': {
        if (toolPoints.length < 2) { addPoint(); return; }
        const arc = createArcEntity(toolPoints[0], toolPoints[1], p);
        if (!arc) { showNotice('Those three points are in a straight line, so they do not define an arc.'); return; }
        addEntity(base, arc);
        done();
        return;
      }
      case 'polygon': {
        if (!prev) { addPoint(); return; }
        if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-3) { showNotice('A polygon needs a radius.'); return; }
        addEntity(base, createRegularPolygonEntity(prev, p, toolParams.sides ?? 6));
        done();
        return;
      }
      case 'text': {
        const anno = createAnnotation({ x: p.x, y: p.y, text: toolParams.text || 'Text' });
        commit({ ...base, annotations: [...(base.annotations || []), anno] }, { type: 'annotation', data: anno });
        return;
      }
      case 'dimension': {
        if (!prev) { addPoint(); return; }
        if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-3) { showNotice('A dimension needs two different points.'); return; }
        const dim = createDimension({ x1: prev.x, y1: prev.y, x2: p.x, y2: p.y, offset: 1.5 });
        commit({ ...base, dimensions: [...(base.dimensions || []), dim] }, { type: 'dimension', data: dim });
        done();
        return;
      }
      case 'door':
      case 'window': {
        const proto = tool === 'door' ? createDoor({ width: 3.0 }) : createWindow({ width: 4.0 });
        const place = placeOpeningOnWall(base, proto, world, { maxDist: OPENING_PICK_PX / viewport.scale });
        if (!place) { showNotice(`Click on a wall with enough free length to add a ${tool}.`); return; }
        const opening = { ...proto, ...place };
        const key = COLLECTIONS[tool];
        commit({ ...base, [key]: [...(base[key] || []), opening] }, { type: tool, data: opening });
        return;
      }
      case 'column': {
        const col = createColumn({ x: p.x, y: p.y, size: 0.75 });
        commit({ ...base, columns: [...(base.columns || []), col] }, { type: 'column', data: col });
        return;
      }
      case 'parking': {
        const pk = createParking({ x: p.x, y: p.y });
        commit({ ...base, parking: [...(base.parking || []), pk] }, { type: 'parking', data: pk });
        return;
      }
      case 'staircase': {
        const stair = createStaircase({ x: p.x, y: p.y, width: 6.0 });
        commit({ ...base, staircases: [...(base.staircases || []), stair] }, { type: 'staircase', data: stair });
        return;
      }
      case 'measure': {
        if (!prev) { setMeasureResult(null); addPoint(); return; }
        setMeasureResult({ a: prev, b: p });
        done();
        return;
      }
      case 'move':
      case 'copy': {
        if (!selection.length) { showNotice('Select the objects first.'); return; }
        if (!prev) { addPoint(); return; }
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (tool === 'move') applyResult(transformSelection(base, selection, makeTranslate(dx, dy)));
        else applyResult(copySelection(base, selection, dx, dy), { selectCreated: true });
        done();
        return;
      }
      case 'rotate':
        if (!selection.length) { showNotice('Select the objects first.'); return; }
        applyResult(transformSelection(base, selection, makeRotate(p, Number(toolParams.angle) || 0)));
        return;
      case 'scale':
        if (!selection.length) { showNotice('Select the objects first.'); return; }
        if (!(Number(toolParams.factor) > 0)) { showNotice('The scale factor must be greater than zero.'); return; }
        applyResult(transformSelection(base, selection, makeScale(p, Number(toolParams.factor))));
        return;
      case 'mirror': {
        if (!selection.length) { showNotice('Select the objects first.'); return; }
        if (!prev) { addPoint(); return; }
        if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-3) { showNotice('The mirror line needs two different points.'); return; }
        applyResult(transformSelection(base, selection, makeMirror(prev, p)));
        done();
        return;
      }
      case 'polar-array':
        if (!selection.length) { showNotice('Select the objects first.'); return; }
        applyResult(polarArray(base, selection, { count: Number(toolParams.count) || 4, angle: Number(toolParams.polarAngle) || 360, center: p }), { selectCreated: false });
        return;
      case 'offset': {
        if (!toolRefs.length) {
          const pick = pickOutline(base, world, pickTol);
          if (!pick) { showNotice('Click a wall, line, polyline, circle or arc to offset.'); return; }
          setToolRefs([pick]);
          return;
        }
        applyResult(offsetElement(base, toolRefs[0], Number(toolParams.offset) || 0, world), { selectCreated: true });
        setToolRefs([]);
        return;
      }
      case 'trim':
      case 'extend': {
        const pick = pickOutline(base, world, pickTol);
        if (!pick) { showNotice(tool === 'trim' ? 'Click the piece to remove.' : 'Click near the end to extend.'); return; }
        applyResult((tool === 'trim' ? trimElement : extendElement)(base, pick, world));
        return;
      }
      case 'break': {
        const pick = pickOutline(base, world, pickTol);
        if (!pick) { showNotice('Click the object to break.'); return; }
        applyResult(breakAtClick(base, pick, world, Number(toolParams.gap) || 0));
        return;
      }
      case 'fillet':
      case 'chamfer': {
        const pick = pickOutline(base, world, pickTol);
        if (!pick) { showNotice('Click a wall or line.'); return; }
        if (!toolRefs.length) {
          setToolRefs([{ ...pick, click: world }]);
          return;
        }
        const first = toolRefs[0];
        const res = tool === 'fillet'
          ? filletElements(base, first, pick, Number(toolParams.radius) || 0, first.click, world)
          : chamferElements(base, first, pick, Number(toolParams.chamferA) || 0, Number(toolParams.chamferB) || 0, first.click, world);
        applyResult(res);
        setToolRefs([]);
        return;
      }
      case 'stretch': {
        // The window is dragged first; then a base point and a destination.
        if (!stretchBox) return;
        if (!prev) { addPoint(); return; }
        applyResult(stretchInBox(base, stretchBox, p.x - prev.x, p.y - prev.y));
        setStretchBox(null);
        done();
        return;
      }
      case 'delete': {
        const hits = hitTestAll(base, world.x, world.y, viewport.scale, { includePlot: false });
        if (!hits.length) return;
        applyResult(deleteSelection(base, [{ type: hits[0].type, id: hits[0].data.id }]), { keepSelection: false });
        return;
      }
      default:
    }
  };

  // ---------------------------------------------------------------------
  // Pointer Down
  // ---------------------------------------------------------------------

  const beginDrag = (handle, info) => {
    movedRef.current = false;
    setDraggingHandle(handle);
    setDragStartInfo(info);
    setResizeConflict(null);
    historyManager.beginDrag();
  };

  const handlePointerDown = (e) => {
    if (!containerRef.current) return;
    if (e.button === 2) return; // context menu
    // A second finger or button must not disturb the operation in progress.
    if (activePointerRef.current !== null && activePointerRef.current !== e.pointerId) return;

    // Commit any inspector field first, then work from the geometry it produced.
    const focused = typeof document !== 'undefined' ? document.activeElement : null;
    if (focused && ['INPUT', 'TEXTAREA'].includes(focused.tagName)) focused.blur();
    const base = liveLayout();

    const rect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = screenToWorld(sx, sy);

    // Capture the pointer so drags and draws keep receiving events even if
    // the cursor/finger leaves the canvas mid-operation.
    if (e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function' && e.pointerId !== undefined) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    }
    activePointerRef.current = e.pointerId ?? null;

    // Middle click or spacebar or Pan Tool -> start panning
    if (e.button === 1 || spaceHeldRef.current || activeTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewport.panX, y: e.clientY - viewport.panY });
      return;
    }

    // Add Room: click and drag to create
    if (activeTool === 'room') {
      const snapRes = findRoomSnapping(
        { x: worldPos.x, y: worldPos.y, width: 0, length: 0 },
        base,
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
      setActiveMeasurements({ width: 0, length: 0, x: startPt.x, y: startPt.y, area: 0 });
      return;
    }

    // Stretch: the first drag defines the window
    if (activeTool === 'stretch' && !stretchBox) {
      setBoxDrag({ start: worldPos, end: worldPos, purpose: 'stretch', startScreen: { x: sx, y: sy } });
      return;
    }

    if (activeTool !== 'select') {
      handleToolPick(worldPos, e, base);
      return;
    }

    // ----- Select tool. Priority: the selected object's handles, the site
    // handles, dimension annotations, then object bodies. -----
    const handle = findSelectedHandle(base, sx, sy);
    if (handle) {
      const info = { startWorld: worldPos, initial: { ...handle.el }, snapshot: base, layoutSnapshot: base };
      if (handle.kind === 'stair') info.bounds = handle.bounds;
      if (handle.kind === 'opening') {
        info.openingType = selectedElement.type;
        info.geometry = handle.geometry;
      }
      if (handle.kind === 'vertex') info.vertexIndex = handle.index;
      beginDrag(handle.id, info);
      return;
    }

    const edgeHit = findPlotEdgeHandle(sx, sy);
    if (edgeHit) {
      onSelectElement({ type: 'plot', data: base.plot });
      beginDrag('plot-edge', {
        startWorld: worldPos,
        edge: edgeHit,
        snapshot: cloneLayout(base),
        startViewport: { ...viewport },
      });
      return;
    }

    const dimHit = findDimensionAtWorldPoint(worldPos.x, worldPos.y);
    if (dimHit) {
      if (dimHit.onLabel) {
        openDimensionEditor(dimHit.axis);
        return;
      }
      onSelectElement({ type: 'dimension', data: dimHit.meta });
      beginDrag('dimension-line', {
        startWorld: worldPos,
        axis: dimHit.axis,
        initialOffset: dimHit.meta.offset,
        snapshot: base,
      });
      return;
    }

    const hits = hitTestAll(base, worldPos.x, worldPos.y, viewport.scale);
    const objectHits = hits.filter((h) => h.type !== 'plot');

    // Shift adds to / removes from the selection and starts no drag.
    if (e.shiftKey && objectHits.length) {
      onSelectElement(toggleInSelection(base, selectedElement, objectHits[0]));
      return;
    }

    if (objectHits.length === 0) {
      // Empty plot or empty canvas: a drag draws a selection box, a click (see
      // pointer-up) selects the plot or clears the selection.
      setBoxDrag({
        start: worldPos,
        end: worldPos,
        purpose: 'select',
        additive: e.shiftKey,
        startScreen: { x: sx, y: sy },
        onPlot: hits.some((h) => h.type === 'plot'),
      });
      return;
    }

    // Clicking inside a multi-selection keeps it and drags all of it.
    const selected = selectionItems(selectedElement);
    if (selectedElement?.type === 'multi' && objectHits.some((h) => isItemSelected(selectedElement, h.type, h.data.id))) {
      beginDrag('multi-body', { startWorld: worldPos, items: selected, snapshot: base });
      return;
    }

    // Keep hold of the selected object when it is among the hits, so a drag never
    // jumps to whatever overlaps it; a plain click then cycles (see pointer-up).
    const already = objectHits.find((h) => isItemSelected(selectedElement, h.type, h.data.id));
    const hit = already || objectHits[0];
    const cycle = already && objectHits.length > 1 ? objectHits : null;
    onSelectElement(toSelection(hit));
    const el = hit.data;
    if (el.isLocked) {
      if (cycle) setDragStartInfo({ cycle, current: toSelection(hit), snapshot: base });
      return;
    }
    if (hit.type === 'room') {
      beginDrag('room-body', { startWorld: worldPos, hitType: 'room', initial: { ...el }, layoutSnapshot: base, snapshot: base, cycle, current: toSelection(hit) });
      return;
    }
    beginDrag('element-body', { startWorld: worldPos, hitType: hit.type, initial: { ...el }, layoutSnapshot: base, snapshot: base, cycle, current: toSelection(hit) });
  };

  const handleDoubleClick = (e) => {
    if (activeTool === 'polyline') { finishPolyline(); return; }
    if (activeTool !== 'select' || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    const base = liveLayout();
    const hit = hitTestAll(base, world.x, world.y, viewport.scale, { includePlot: false }).find((h) => h.type === 'room');
    if (!hit || hit.data.isLocked) return;
    // The label reads "width × length": the side you double-click picks the field.
    const room = hit.data;
    const p0 = worldToScreen(room.x, room.y);
    const cx = p0.x + (room.width * viewport.scale) / 2;
    const cy = p0.y + (room.length * viewport.scale) / 2 + 7;
    const field = sx <= cx ? 'width' : 'length';
    onSelectElement({ type: 'room', data: room });
    openRoomDimensionEditor(room.id, field, cx, cy, room[field]);
  };

  // ---------------------------------------------------------------------
  // Pointer Move (coalesced to one geometry update per animation frame)
  // ---------------------------------------------------------------------

  const processMove = ({ clientX, clientY, shiftKey, altKey }) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const worldPos = screenToWorld(sx, sy);
    setMouseWorldPos(worldPos);

    if (onCursorMove) {
      onCursorMove(worldPos);
    }

    // Panning
    if (isPanning) {
      setViewport((prev) => ({
        ...prev,
        panX: clientX - panStart.x,
        panY: clientY - panStart.y,
      }));
      return;
    }

    if (boxDrag) {
      setBoxDrag((prev) => (prev ? { ...prev, end: worldPos } : prev));
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

    // Snap indicator for tools that pick points
    if (!draggingHandle) {
      const pickingPoints = activeTool !== 'select' && activeTool !== 'pan' && activeTool !== 'room' && activeTool !== 'delete' &&
        !['trim', 'extend', 'fillet', 'chamfer', 'break'].includes(activeTool) && !(activeTool === 'stretch' && !stretchBox);
      if (pickingPoints) {
        const prev = toolPoints[toolPoints.length - 1] || null;
        setCursorSnap(resolvePoint(worldPos, { from: prev, ortho: (activeTool === 'wall' && !allowDiagonal) || shiftKey }));
      } else if (cursorSnap) {
        setCursorSnap(null);
      }
      return;
    }

    if (!dragStartInfo) return;

    // Below the click threshold nothing moves, so a click can never nudge geometry.
    if (!movedRef.current) {
      const start = worldToScreen(dragStartInfo.startWorld.x, dragStartInfo.startWorld.y);
      if (Math.hypot(sx - start.x, sy - start.y) < DRAG_THRESHOLD_PX) return;
      movedRef.current = true;
    }

    const dx = worldPos.x - dragStartInfo.startWorld.x;
    const dy = worldPos.y - dragStartInfo.startWorld.y;
    const publish = (next) => {
      historyManager.updateDuringDrag(next);
      onUpdateLayout(next);
    };

    // Site boundary drag: always recomputed from the drag-start snapshot so
    // the preview is deterministic and never accumulates drift.
    if (draggingHandle === 'plot-edge') {
      const sv = dragStartInfo.startViewport;
      const dragWorld = { x: (sx - sv.panX) / sv.scale, y: (sy - sv.panY) / sv.scale };
      const change = computeSiteDragChange(dragStartInfo, dragWorld, shiftKey || altKey);
      const res = resizePlotBoundary(dragStartInfo.snapshot, change);
      const preview = {
        width: res.nextLayout.plot.width,
        length: res.nextLayout.plot.length,
        outside: res.outside,
      };
      sitePreviewRef.current = preview;
      setSitePreview(preview);
      publish(res.nextLayout);
      return;
    }

    const snapshot = dragStartInfo.snapshot;

    // Staircase resize: regenerates the steps (step count is preserved)
    if (draggingHandle.startsWith('stair-')) {
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
      const nb = getStaircaseBounds(next);
      setActiveMeasurements({ width: nb.width, length: nb.length, x: nb.x, y: nb.y, area: nb.width * nb.length });
      publish({ ...snapshot, staircases: snapshot.staircases.map((st) => (st.id === initial.id ? next : st)) });
      return;
    }

    // Dimension annotation move (changes offset only, never plot size)
    if (draggingHandle === 'dimension-line') {
      const { axis } = dragStartInfo;
      const lineDelta = axis === 'width' ? -dy : -dx;
      const newOffset = Math.max(0.5, dragStartInfo.initialOffset + lineDelta);
      const dimId = axis === 'width' ? 'dim-plot-width' : 'dim-plot-length';
      const nextLayout = {
        ...snapshot,
        dimensions: (snapshot.dimensions || []).map((d) => (d.id === dimId ? { ...d, offset: newOffset } : d)),
      };
      syncPlotDimensions(nextLayout);
      publish(nextLayout);
      return;
    }

    // Wall endpoint drag: the opposite endpoint stays where it is
    if (draggingHandle === 'wall-p1' || draggingHandle === 'wall-p2') {
      const which = draggingHandle === 'wall-p1' ? 'p1' : 'p2';
      const wall = dragStartInfo.initial;
      const fixed = which === 'p1' ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
      const target = resolvePoint(worldPos, { from: fixed, excludeWallId: wall.id, base: snapshot, ortho: shiftKey });
      setCursorSnap(target);
      const res = moveWallEndpointTo(snapshot, wall.id, which, target, { allowDiagonal });
      setResizeConflict(res.reason);
      publish(res.layout);
      return;
    }

    // Door / window jamb drag: the opposite jamb stays where it is
    if (draggingHandle === 'opening-a' || draggingHandle === 'opening-b') {
      const { geometry: g, initial, openingType } = dragStartInfo;
      const fixedEnd = draggingHandle === 'opening-a' ? 'b' : 'a';
      const fixed = fixedEnd === 'b' ? g.b : g.a;
      const along = Math.abs((worldPos.x - fixed.x) * g.ux + (worldPos.y - fixed.y) * g.uy);
      const res = resizeOpening(snapshot, openingType, initial.id, snap(along), fixedEnd);
      setResizeConflict(res.reason);
      publish(res.layout);
      return;
    }

    // Line / polyline vertex drag
    if (draggingHandle === 'entity-vertex') {
      const { initial, vertexIndex } = dragStartInfo;
      const p = resolvePoint(worldPos, { excludeEntityId: initial.id, base: snapshot, ortho: false });
      setCursorSnap(p);
      let next;
      if (initial.kind === 'line') {
        next = vertexIndex === 0 ? { ...initial, x1: p.x, y1: p.y } : { ...initial, x2: p.x, y2: p.y };
      } else {
        next = {
          ...initial,
          shape: initial.shape === 'rect' ? 'polygon' : initial.shape,
          points: initial.points.map((q, i) => (i === vertexIndex ? { x: p.x, y: p.y } : q)),
        };
      }
      publish({ ...snapshot, cadEntities: snapshot.cadEntities.map((c) => (c.id === initial.id ? next : c)) });
      return;
    }

    // Circle / arc radius drag
    if (draggingHandle === 'entity-radius') {
      const { initial } = dragStartInfo;
      const r = Math.max(0.1, snap(Math.hypot(worldPos.x - initial.cx, worldPos.y - initial.cy)));
      publish({ ...snapshot, cadEntities: snapshot.cadEntities.map((c) => (c.id === initial.id ? { ...initial, r } : c)) });
      return;
    }

    // Room body drag (whole room, smart alignment snapping, walls follow)
    if (draggingHandle === 'room-body') {
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
      publish(nextLayout);
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

    // Room resizing (edges and corners). dx / dy are world-feet deltas from the
    // pointer-down position; geometry comes from the pointer-down snapshot.
    if (draggingHandle.startsWith('room-')) {
      const handleCode = draggingHandle.replace('room-', '');
      const init = dragStartInfo.initial;
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
      publish(res.layout);
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

    // Several objects together
    if (draggingHandle === 'multi-body') {
      const res = transformSelection(snapshot, dragStartInfo.items, makeTranslate(snap(dx), snap(dy)));
      setResizeConflict(res.skipped[0] || null);
      publish(res.layout);
      return;
    }

    // General object body move
    if (draggingHandle === 'element-body') {
      const type = dragStartInfo.hitType;
      const init = dragStartInfo.initial;
      if (type === 'wall') {
        const res = moveWallBody(snapshot, init.id, snap(dx), snap(dy), { allowDiagonal });
        setResizeConflict(res.clamped ? res.reason : null);
        publish(res.layout);
        return;
      }
      if (type === 'door' || type === 'window') {
        // An opening can only travel along walls; off-wall it waits at its last valid spot.
        const res = moveOpening(snapshot, type, init.id, { x: snap(init.x + dx), y: snap(init.y + dy) }, { maxDist: OPENING_PICK_PX / viewport.scale });
        if (res.moved) publish(res.layout);
        setResizeConflict(res.moved ? null : res.reason);
        return;
      }
      // Rigid objects: the object's own position lands on the grid, keeping its shape.
      const anchorX = type === 'entity' ? (init.kind === 'line' ? init.x1 : init.points ? init.points[0].x : init.cx)
        : type === 'dimension' ? init.x1 : init.x;
      const anchorY = type === 'entity' ? (init.kind === 'line' ? init.y1 : init.points ? init.points[0].y : init.cy)
        : type === 'dimension' ? init.y1 : init.y;
      const T = makeTranslate(snap(anchorX + dx) - anchorX, snap(anchorY + dy) - anchorY);
      const res = transformElement(init, type, T);
      if (res.el) {
        const key = COLLECTIONS[type];
        publish({ ...snapshot, [key]: (snapshot[key] || []).map((o) => (o.id === init.id ? res.el : o)) });
      }
    }
  };
  processMoveRef.current = processMove;

  const flushPendingMove = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingMoveRef.current) {
      const move = pendingMoveRef.current;
      pendingMoveRef.current = null;
      processMoveRef.current(move);
    }
  };

  const handlePointerMove = (e) => {
    if (activePointerRef.current !== null && e.pointerId !== activePointerRef.current) return;
    pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const move = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (move) processMoveRef.current(move);
      });
    }
  };

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  // ---------------------------------------------------------------------
  // Pointer Up
  // ---------------------------------------------------------------------

  const handlePointerUp = (e) => {
    if (activePointerRef.current !== null && e?.pointerId !== undefined && e.pointerId !== activePointerRef.current) return;
    activePointerRef.current = null;
    siteDragActiveRef.current = false;

    // Apply the final pointer position even if its frame had not run yet: the
    // state setters below take effect on the next render, so read through refs.
    if (pendingMoveRef.current) flushPendingMove();

    if (isPanning) {
      setIsPanning(false);
    }

    if (e && e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function' && e.pointerId !== undefined) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    if (boxDrag) {
      const box = boxDrag;
      setBoxDrag(null);
      const a = worldToScreen(box.start.x, box.start.y);
      const rect = containerRef.current?.getBoundingClientRect();
      const upWorld = rect && e?.clientX !== undefined ? screenToWorld(e.clientX - rect.left, e.clientY - rect.top) : box.end;
      const b = worldToScreen(upWorld.x, upWorld.y);
      const isDrag = Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_THRESHOLD_PX;
      if (box.purpose === 'stretch') {
        if (isDrag) setStretchBox({ x1: box.start.x, y1: box.start.y, x2: upWorld.x, y2: upWorld.y });
        return;
      }
      if (!isDrag) {
        onSelectElement(box.onPlot ? { type: 'plot', data: layout.plot } : null);
        return;
      }
      const items = boxSelect(liveLayout(), box.start, upWorld, viewport.scale);
      onSelectElement(selectionFromItems(liveLayout(), items));
      return;
    }

    if (activeTool === 'room' && roomDrawStart) {
      const end = (() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return rect && e?.clientX !== undefined ? screenToWorld(e.clientX - rect.left, e.clientY - rect.top) : mouseWorldPos;
      })();
      const rawBox = {
        x: Math.min(roomDrawStart.x, end.x),
        y: Math.min(roomDrawStart.y, end.y),
        width: Math.abs(end.x - roomDrawStart.x),
        length: Math.abs(end.y - roomDrawStart.y),
        freeX: end.x,
        freeY: end.y,
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

      const dragDist = Math.hypot(end.x - roomDrawStart.x, end.y - roomDrawStart.y);
      if (dragDist < 0.6) {
        finalW = 12;
        finalL = 10;
        finalX = roomDrawStart.x;
        finalY = roomDrawStart.y;
      }

      if (finalW >= MIN_ROOM_DIMENSION && finalL >= MIN_ROOM_DIMENSION) {
        finalizeRoomPlacement({ x: finalX, y: finalY, width: finalW, length: finalL });
      } else {
        showNotice(`Room too small - minimum ${formatMeasurement(MIN_ROOM_DIMENSION, unit)} × ${formatMeasurement(MIN_ROOM_DIMENSION, unit)} required`);
      }

      setRoomDrawStart(null);
      setAlignmentGuides([]);
      setSnapBadges([]);
      setRoomWarnings([]);
      setActiveMeasurements(null);
      return;
    }

    if (draggingHandle === 'plot-edge' && dragStartInfo) {
      const preview = sitePreviewRef.current;
      sitePreviewRef.current = null;
      setSitePreview(null);
      setDraggingHandle(null);
      setDragStartInfo(null);
      // One undoable step for the whole boundary drag
      historyManager.endDrag(historyManager.getCurrent());
      if (preview?.outside?.length) showNotice(describeOutsidePlot(preview.outside));
      return;
    }

    if (draggingHandle) {
      if (resizeConflict) showNotice(`Stopped at the nearest valid position: ${resizeConflict}`);
      const wasClick = !movedRef.current;
      const info = dragStartInfo;
      setResizeConflict(null);
      historyManager.endDrag(historyManager.getCurrent());
      setDraggingHandle(null);
      setDragStartInfo(null);
      setAlignmentGuides([]);
      setSnapBadges([]);
      setRoomWarnings([]);
      setActiveMeasurements(null);
      setCursorSnap(null);
      movedRef.current = false;
      if (wasClick && info?.cycle) onSelectElement(toSelection(nextOverlappingHit(info.cycle, info.current)));
      return;
    }

    // A locked object has no drag, but a click still cycles through overlaps.
    if (dragStartInfo?.cycle) {
      onSelectElement(toSelection(nextOverlappingHit(dragStartInfo.cycle, dragStartInfo.current)));
      setDragStartInfo(null);
    }
  };

  // Rulers Rendering (Top and Left)
  const renderRulers = () => {
    if (!layout) return null;
    // Rulers read world coordinates, matching the cursor and object positions.
    const site = getPlotRect(layout);

    const ticksX = [];
    const stepX = 5; // 5 ft major ticks
    for (let x = Math.ceil(site.x0 / stepX) * stepX; x <= site.x1; x += stepX) {
      const scr = worldToScreen(x, 0);
      ticksX.push(
        <div key={`rx-${x}`} style={{ position: 'absolute', left: scr.x - 24, top: 0, height: 18, borderLeft: '1px solid #94A3B8', paddingLeft: 3 }}>
          <span style={{ fontSize: 9, color: '#64748B', fontWeight: 600 }}>{formatMeasurement(x, unit, 0)}</span>
        </div>
      );
    }

    const ticksY = [];
    const stepY = 5;
    for (let y = Math.ceil(site.y0 / stepY) * stepY; y <= site.y1; y += stepY) {
      const scr = worldToScreen(0, y);
      ticksY.push(
        <div key={`ry-${y}`} style={{ position: 'absolute', top: scr.y - 22, left: 0, width: 24, borderTop: '1px solid #94A3B8', paddingTop: 2 }}>
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
    const { x0, y0, x1, y1, width: W, length: L } = getPlotRect(layout);
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
        const y = y0 - w.offset;
        const a = worldToScreen(x0, y);
        const b = worldToScreen(x1, y);
        const e1a = worldToScreen(x0, y0 + 0.4);
        const e1b = worldToScreen(x0, y - 0.6);
        const e2a = worldToScreen(x1, y0 + 0.4);
        const e2b = worldToScreen(x1, y - 0.6);
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

      const x = x0 - l.offset;
      const a = worldToScreen(x, y0);
      const b = worldToScreen(x, y1);
      const e1a = worldToScreen(x0 + 0.4, y0);
      const e1b = worldToScreen(x - 0.6, y0);
      const e2a = worldToScreen(x0 + 0.4, y1);
      const e2b = worldToScreen(x - 0.6, y1);
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

  const plotRect = getPlotRect(layout);
  const plotW = plotRect.width;
  const plotL = plotRect.length;
  const plotScr = worldToScreen(plotRect.x0, plotRect.y0);
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
        cursor: activeTool === 'pan' || isPanning ? 'grabbing' : (activeTool === 'select' ? 'default' : 'crosshair'),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={(e) => { if (activePointerRef.current !== null) handlePointerUp(e); }}
      onDoubleClick={handleDoubleClick}
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
              const p = worldToScreen(plotRect.x0 + i * 2, plotRect.y0);
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
              const p = worldToScreen(plotRect.x0, plotRect.y0 + i * 2);
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
          const p0 = worldToScreen(plotRect.x0 + bx0, plotRect.y0 + by0);
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
          const outsideCount = sitePreview.outside.length;
          const text = `${formatMeasurement(sitePreview.width, unit)} × ${formatMeasurement(sitePreview.length, unit)}` +
            (outsideCount ? `  ·  ${outsideCount} outside plot` : '');
          const c = worldToScreen(plotRect.x0 + plotW / 2, plotRect.y0 + plotL / 2);
          return (
            <g key="site-preview" transform={`translate(${c.x}, ${c.y})`}>
              <rect x={-(text.length * 3.4 + 14)} y="-12" width={text.length * 6.8 + 28} height="22" rx="11"
                fill={outsideCount ? '#991B1B' : '#0F172A'} opacity="0.92" />
              <text x="0" y="3" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700" fontFamily="Segoe UI, sans-serif">{text}</text>
            </g>
          );
        })()}

        {/* Rooms Layer */}
        {(layout?.rooms || []).map(room => {
          const rPos = worldToScreen(room.x, room.y);
          const rW = room.width * viewport.scale;
          const rH = room.length * viewport.scale;
          const isSel = isItemSelected(selectedElement, 'room', room.id);
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
                <g>
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
              {isSel && selectedElement.type === 'room' && !room.isLocked && (
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
          const isSel = isItemSelected(selectedElement, 'parking', p.id);
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
          const isSel = isItemSelected(selectedElement, 'utility', u.id);
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
          const isSel = isItemSelected(selectedElement, 'staircase', s.id);
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
              {isSel && selectedElement.type === 'staircase' && !s.isLocked && [
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
          const isSel = isItemSelected(selectedElement, 'column', col.id);
          const stroke = isSel ? '#2563EB' : '#0F172A';
          return (
            <g key={col.id}>
              {col.shape === 'round'
                ? <circle cx={cPos.x} cy={cPos.y} r={cSize / 2} fill="#475569" stroke={stroke} strokeWidth={isSel ? 2 : 1} />
                : <rect x={cPos.x - cSize / 2} y={cPos.y - cSize / 2} width={cSize} height={cSize} fill="#475569" stroke={stroke} strokeWidth={isSel ? 2 : 1} />}
            </g>
          );
        })}

        {/* Walls Layer (Solid architectural CAD lines) */}
        {(layout?.walls || []).map(wall => {
          const p1 = worldToScreen(wall.x1, wall.y1);
          const p2 = worldToScreen(wall.x2, wall.y2);
          const strokeW = Math.max(3, (wall.thickness || 0.75) * viewport.scale);
          const isSel = isItemSelected(selectedElement, 'wall', wall.id);

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
              {isSel && selectedElement.type === 'wall' && !wall.isLocked && (
                <>
                  <circle cx={p1.x} cy={p1.y} r="7" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" cursor="move" />
                  <circle cx={p2.x} cy={p2.y} r="7" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" cursor="move" />
                </>
              )}
            </g>
          );
        })}

        {/* CAD Entities */}
        {(layout?.cadEntities || []).map((ent) => {
          const isSel = isItemSelected(selectedElement, 'entity', ent.id);
          const color = isSel ? '#2563EB' : (ent.color || '#0F172A');
          const props = { fill: 'none', stroke: color, strokeWidth: isSel ? 2.5 : 1.5 };
          const single = isSel && selectedElement.type === 'entity' && !ent.isLocked;
          const pts = (list) => list.map((p) => { const q = worldToScreen(p.x, p.y); return `${q.x},${q.y}`; }).join(' ');
          const dot = (key, x, y) => {
            const q = worldToScreen(x, y);
            return <rect key={key} x={q.x - 4} y={q.y - 4} width="8" height="8" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" style={{ cursor: 'move', pointerEvents: 'all' }} />;
          };
          if (ent.kind === 'line') {
            const a = worldToScreen(ent.x1, ent.y1);
            const b = worldToScreen(ent.x2, ent.y2);
            return (
              <g key={ent.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...props} />
                {single && dot('v0', ent.x1, ent.y1)}
                {single && dot('v1', ent.x2, ent.y2)}
              </g>
            );
          }
          if (ent.points) {
            return (
              <g key={ent.id}>
                {ent.closed ? <polygon points={pts(ent.points)} {...props} /> : <polyline points={pts(ent.points)} {...props} />}
                {single && ent.points.map((p, i) => dot(`v${i}`, p.x, p.y))}
              </g>
            );
          }
          const c = worldToScreen(ent.cx, ent.cy);
          const r = ent.r * viewport.scale;
          if (ent.kind === 'circle') {
            return (
              <g key={ent.id}>
                <circle cx={c.x} cy={c.y} r={r} {...props} />
                {single && dot('r', ent.cx + ent.r, ent.cy)}
              </g>
            );
          }
          const sweep = arcSweep(ent);
          const a = pointAtAngle(ent, ent.start);
          const b = pointAtAngle(ent, ent.end);
          const m = pointAtAngle(ent, ent.start + sweep / 2);
          const sa = worldToScreen(a.x, a.y);
          const sb = worldToScreen(b.x, b.y);
          return (
            <g key={ent.id}>
              <path d={`M ${sa.x} ${sa.y} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${sb.x} ${sb.y}`} {...props} />
              {single && dot('r', m.x, m.y)}
            </g>
          );
        })}

        {/* User dimensions (the value always comes from the real distance) */}
        {(layout?.dimensions || []).filter((d) => !isPlotDimension(d.id)).map((d) => {
          const isSel = isItemSelected(selectedElement, 'dimension', d.id);
          const color = isSel ? '#2563EB' : '#B45309';
          const line = dimensionLine(d);
          const p1 = worldToScreen(d.x1, d.y1);
          const p2 = worldToScreen(d.x2, d.y2);
          const a = worldToScreen(line.x1, line.y1);
          const b = worldToScreen(line.x2, line.y2);
          const text = formatMeasurement(Math.hypot(d.x2 - d.x1, d.y2 - d.y1), unit);
          return (
            <g key={d.id}>
              <line x1={p1.x} y1={p1.y} x2={a.x} y2={a.y} stroke={color} strokeWidth="0.8" strokeDasharray="3,2" />
              <line x1={p2.x} y1={p2.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="0.8" strokeDasharray="3,2" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={isSel ? 2 : 1.2} />
              <circle cx={a.x} cy={a.y} r="2.5" fill={color} />
              <circle cx={b.x} cy={b.y} r="2.5" fill={color} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill={color} fontFamily="Segoe UI, sans-serif">{text}</text>
            </g>
          );
        })}

        {/* Text annotations */}
        {(layout?.annotations || []).map((a) => {
          const isSel = isItemSelected(selectedElement, 'annotation', a.id);
          const q = worldToScreen(a.x, a.y);
          const box = annotationBox(a, viewport.scale);
          const tl = worldToScreen(box.x, box.y);
          return (
            <g key={a.id}>
              {isSel && <rect x={tl.x - 2} y={tl.y - 2} width={box.width * viewport.scale + 4} height={box.length * viewport.scale + 4} fill="rgba(37,99,235,0.12)" stroke="#2563EB" strokeWidth="1" strokeDasharray="3,2" />}
              <text x={q.x} y={q.y} fontSize={a.fontSize || 12} fontWeight="600" fill={a.color || '#334155'} fontFamily="Segoe UI, sans-serif">{a.text}</text>
            </g>
          );
        })}

        {/* Doors Layer */}
        {(layout?.doors || []).map(door => {
          const g = getOpeningGeometry(door, layout.walls);
          const isSel = isItemSelected(selectedElement, 'door', door.id);
          const color = isSel ? '#2563EB' : '#B45309';
          const a = worldToScreen(g.a.x, g.a.y);
          const b = worldToScreen(g.b.x, g.b.y);
          const gap = Math.max(3, g.thickness * viewport.scale) + 1;
          const single = isSel && selectedElement.type === 'door' && !door.isLocked;
          return (
            <g key={door.id}>
              {/* The opening cuts the wall */}
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FFFFFF" strokeWidth={gap} />
              {door.type === 'sliding' && (() => {
                const off = (Math.max(3, g.thickness * viewport.scale)) / 3;
                const nx = g.nx * off;
                const ny = g.ny * off;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                return (
                  <>
                    <line x1={a.x + nx} y1={a.y + ny} x2={mx + nx} y2={my + ny} stroke={color} strokeWidth="2.5" />
                    <line x1={mx - nx} y1={my - ny} x2={b.x - nx} y2={b.y - ny} stroke={color} strokeWidth="2.5" />
                  </>
                );
              })()}
              {g.leaves.map((leaf, i) => {
                const h = worldToScreen(leaf.hinge.x, leaf.hinge.y);
                const tip = worldToScreen(leaf.tip.x, leaf.tip.y);
                const free = worldToScreen(leaf.free.x, leaf.free.y);
                const r = leaf.radius * viewport.scale;
                const cross = (tip.x - h.x) * (free.y - h.y) - (tip.y - h.y) * (free.x - h.x);
                return (
                  <g key={`leaf-${i}`}>
                    <line x1={h.x} y1={h.y} x2={tip.x} y2={tip.y} stroke={color} strokeWidth="2.5" />
                    <path d={`M ${tip.x} ${tip.y} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${free.x} ${free.y}`} fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="3,3" />
                  </g>
                );
              })}
              {single && [a, b].map((p, i) => (
                <rect key={`j-${i}`} x={p.x - 4} y={p.y - 4} width="8" height="8" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" style={{ cursor: 'ew-resize', pointerEvents: 'all' }} />
              ))}
            </g>
          );
        })}

        {/* Windows Layer */}
        {(layout?.windows || []).map(win => {
          const g = getOpeningGeometry(win, layout.walls);
          const isSel = isItemSelected(selectedElement, 'window', win.id);
          const a = worldToScreen(g.a.x, g.a.y);
          const b = worldToScreen(g.b.x, g.b.y);
          const c = worldToScreen(win.x, win.y);
          const half = Math.max(3, (g.thickness * viewport.scale) / 2);
          const nx = g.nx * half;
          const ny = g.ny * half;
          const corners = `${a.x + nx},${a.y + ny} ${b.x + nx},${b.y + ny} ${b.x - nx},${b.y - ny} ${a.x - nx},${a.y - ny}`;
          const shade = (win.chajjaDepth || 1) * viewport.scale;
          const single = isSel && selectedElement.type === 'window' && !win.isLocked;
          return (
            <g key={win.id}>
              <polygon points={corners} fill="#BAE6FD" stroke={isSel ? '#2563EB' : '#0284C7'} strokeWidth="1.5" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isSel ? '#2563EB' : '#0284C7'} strokeWidth="1" />
              {win.chajja && (
                <line x1={a.x - g.nx * shade} y1={a.y - g.ny * shade} x2={b.x - g.nx * shade} y2={b.y - g.ny * shade} stroke="#64748B" strokeWidth="1" strokeDasharray="3,2" />
              )}
              <text x={c.x} y={c.y + 3} fontSize="8" fontWeight="bold" fill="#0369A1" textAnchor="middle">
                {win.isBathroom || win.type === 'ventilator' ? 'V' : 'W'}
              </text>
              {single && [a, b].map((p, i) => (
                <rect key={`j-${i}`} x={p.x - 4} y={p.y - 4} width="8" height="8" fill="#FFFFFF" stroke="#2563EB" strokeWidth="1.5" style={{ cursor: 'ew-resize', pointerEvents: 'all' }} />
              ))}
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

        {/* Live preview of the shape being drawn or the command in progress */}
        {toolPoints.length > 0 && (() => {
          const cur = cursorSnap || mouseWorldPos;
          const last = toolPoints[toolPoints.length - 1];
          const color = activeTool === 'measure' ? '#DC2626' : '#2563EB';
          const seg = (p, q, key) => {
            const a = worldToScreen(p.x, p.y);
            const b = worldToScreen(q.x, q.y);
            return <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="2" strokeDasharray="5,4" />;
          };
          const label = (p, text) => {
            const q = worldToScreen(p.x, p.y);
            return <text x={q.x} y={q.y - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill={color} fontFamily="Segoe UI, sans-serif">{text}</text>;
          };
          const mid = { x: (last.x + cur.x) / 2, y: (last.y + cur.y) / 2 };
          const dist = Math.hypot(cur.x - last.x, cur.y - last.y);
          if (activeTool === 'rectangle') {
            const pts = [last, { x: cur.x, y: last.y }, cur, { x: last.x, y: cur.y }];
            return (
              <g>
                {pts.map((p, i) => seg(p, pts[(i + 1) % 4], `r${i}`))}
                {label(mid, `${formatMeasurement(Math.abs(cur.x - last.x), unit)} × ${formatMeasurement(Math.abs(cur.y - last.y), unit)}`)}
              </g>
            );
          }
          if (activeTool === 'circle') {
            const c = worldToScreen(last.x, last.y);
            return (
              <g>
                <circle cx={c.x} cy={c.y} r={dist * viewport.scale} fill="none" stroke={color} strokeWidth="2" strokeDasharray="5,4" />
                {seg(last, cur, 'r')}
                {label(mid, `R ${formatMeasurement(dist, unit)}`)}
              </g>
            );
          }
          if (activeTool === 'polygon' && dist > 1e-3) {
            const ghost = createRegularPolygonEntity(last, cur, toolParams.sides ?? 6);
            return <g>{ghost.points.map((p, i) => seg(p, ghost.points[(i + 1) % ghost.points.length], `p${i}`))}</g>;
          }
          if (activeTool === 'arc' && toolPoints.length === 2) {
            const ghost = createArcEntity(toolPoints[0], toolPoints[1], cur);
            if (ghost) {
              const a = worldToScreen(pointAtAngle(ghost, ghost.start).x, pointAtAngle(ghost, ghost.start).y);
              const b = worldToScreen(pointAtAngle(ghost, ghost.end).x, pointAtAngle(ghost, ghost.end).y);
              const r = ghost.r * viewport.scale;
              return <path d={`M ${a.x} ${a.y} A ${r} ${r} 0 ${arcSweep(ghost) > 180 ? 1 : 0} 1 ${b.x} ${b.y}`} fill="none" stroke={color} strokeWidth="2" strokeDasharray="5,4" />;
            }
          }
          return (
            <g>
              {toolPoints.slice(1).map((p, i) => seg(toolPoints[i], p, `s${i}`))}
              {seg(last, cur, 'live')}
              {label(mid, formatMeasurement(dist, unit))}
            </g>
          );
        })()}

        {/* Measurement stays on screen until the next measurement or Escape */}
        {activeTool === 'measure' && measureResult && (() => {
          const a = worldToScreen(measureResult.a.x, measureResult.a.y);
          const b = worldToScreen(measureResult.b.x, measureResult.b.y);
          const dx = measureResult.b.x - measureResult.a.x;
          const dy = measureResult.b.y - measureResult.a.y;
          return (
            <g>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#DC2626" strokeWidth="2" />
              <circle cx={a.x} cy={a.y} r="3" fill="#DC2626" />
              <circle cx={b.x} cy={b.y} r="3" fill="#DC2626" />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10} fontSize="12" fontWeight="bold" fill="#DC2626" textAnchor="middle">
                {`${formatMeasurement(Math.hypot(dx, dy), unit)}  (ΔX ${formatMeasurement(Math.abs(dx), unit)}, ΔY ${formatMeasurement(Math.abs(dy), unit)})`}
              </text>
            </g>
          );
        })()}

        {/* Snap indicator: the marker shape names the kind of point */}
        {cursorSnap && cursorSnap.kind && cursorSnap.kind !== 'grid' && (() => {
          const q = worldToScreen(cursorSnap.x, cursorSnap.y);
          const k = cursorSnap.kind;
          const common = { fill: 'none', stroke: '#16A34A', strokeWidth: 2 };
          let marker;
          if (k === 'endpoint') marker = <rect x={q.x - 6} y={q.y - 6} width="12" height="12" {...common} />;
          else if (k === 'midpoint') marker = <polygon points={`${q.x},${q.y - 7} ${q.x + 7},${q.y + 6} ${q.x - 7},${q.y + 6}`} {...common} />;
          else if (k === 'center') marker = <circle cx={q.x} cy={q.y} r="6" {...common} />;
          else if (k === 'intersection') marker = <path d={`M ${q.x - 6} ${q.y - 6} L ${q.x + 6} ${q.y + 6} M ${q.x + 6} ${q.y - 6} L ${q.x - 6} ${q.y + 6}`} {...common} />;
          else if (k === 'perpendicular') marker = <path d={`M ${q.x - 7} ${q.y + 6} L ${q.x + 7} ${q.y + 6} M ${q.x} ${q.y + 6} L ${q.x} ${q.y - 7}`} {...common} />;
          else marker = <polygon points={`${q.x},${q.y - 7} ${q.x + 7},${q.y} ${q.x},${q.y + 7} ${q.x - 7},${q.y}`} {...common} />;
          return (
            <g>
              {marker}
              <text x={q.x + 10} y={q.y - 8} fontSize="10" fontWeight="700" fill="#15803D" fontFamily="Segoe UI, sans-serif">{cursorSnap.label}</text>
            </g>
          );
        })()}

        {/* Selection box: solid = fully inside, dashed green = touching. Stretch window is amber. */}
        {boxDrag && (() => {
          const a = worldToScreen(boxDrag.start.x, boxDrag.start.y);
          const b = worldToScreen(boxDrag.end.x, boxDrag.end.y);
          const crossing = boxDrag.end.x < boxDrag.start.x;
          const stretch = boxDrag.purpose === 'stretch';
          const stroke = stretch ? '#D97706' : (crossing ? '#16A34A' : '#2563EB');
          return (
            <rect
              x={Math.min(a.x, b.x)}
              y={Math.min(a.y, b.y)}
              width={Math.abs(b.x - a.x)}
              height={Math.abs(b.y - a.y)}
              fill={stretch ? 'rgba(217,119,6,0.08)' : (crossing ? 'rgba(22,163,74,0.08)' : 'rgba(37,99,235,0.08)')}
              stroke={stroke}
              strokeWidth="1.2"
              strokeDasharray={crossing || stretch ? '5,3' : undefined}
            />
          );
        })()}
        {stretchBox && (() => {
          const a = worldToScreen(stretchBox.x1, stretchBox.y1);
          const b = worldToScreen(stretchBox.x2, stretchBox.y2);
          return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="rgba(217,119,6,0.08)" stroke="#D97706" strokeWidth="1.2" strokeDasharray="5,3" />;
        })()}
      </svg>

      {notice && (
        <div
          role="status"
          data-testid="editor-notice"
          style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', maxWidth: '80%', padding: '8px 14px', borderRadius: 6, background: '#0F172A', color: '#FFFFFF', fontSize: 12, fontWeight: 600, zIndex: 90, pointerEvents: 'none' }}
        >
          {notice}
        </div>
      )}

      {pendingRoomPlacement && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 340, padding: 16, borderRadius: 10, background: '#FFFFFF', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.35)', zIndex: 110, fontFamily: 'Segoe UI, sans-serif' }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Room is outside the buildable area</div>
          {pendingRoomPlacement.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#991B1B', marginBottom: 4 }}>{w}</div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={handlePlaceAsIs}>Place as drawn</button>
            {!pendingRoomPlacement.exceeds && <button type="button" onClick={handleFitInsidePlot}>Move inside</button>}
            <button type="button" onClick={handleResizeToFitPlot}>Resize to fit</button>
            <button type="button" onClick={() => setPendingRoomPlacement(null)}>Cancel</button>
          </div>
        </div>
      )}

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
