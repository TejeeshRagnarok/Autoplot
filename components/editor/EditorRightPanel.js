/**
 * AutoPlot Layout Editor - Right Properties Panel (Inspector)
 * Provides real-time numerical and visual property editing for all architectural elements:
 * - Room (dimensions with inch precision, area calculation, fill color, Aya-Vyaya score)
 * - Wall (thickness, length, endpoints X1/Y1/X2/Y2, split wall, join walls)
 * - Door (type, width, flip hinge, flip swing direction)
 * - Window (type, width, sunshade chajja)
 * - Plot & Setbacks (width, length, setbacks, ground coverage %)
 * - Element Actions: Duplicate, Delete, Lock/Unlock
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMeasurement, formatArea, parseToFeet } from './units';
import {
  calculateWallLength,
  calculateWallAngle,
  ROOM_PALETTE,
  setPlotDimensionOffset,
  checkRoomPlotFit,
  getPlotAndBuildableBounds,
  normalizeStaircase,
  rotateStaircase,
  calculateStaircaseGeometry,
  validateStaircaseFit,
  STAIRCASE_TYPES,
  inferRoomConstraintType,
  getRoomTypeMinimum,
  CONSTRAINT_TYPES,
  cloneLayout,
} from './layoutModel';
import { checkAyaVyayaYoni } from '../../constants/vastuData';
import { setRoomDimension, moveRoom } from './roomResize';
import DraftInput, { MeasureInput, NumberInput, TextField } from './DraftInput';
import {
  getOpeningHost,
  getOpeningPosition,
  moveWallEndpointTo,
  resizeOpening,
  setOpeningPosition,
  setWallLength,
  setWallProps,
  splitWall,
} from './wallOps';
import {
  COLLECTIONS,
  copySelection,
  deleteSelection,
  isPlotDimension,
  makeRotate,
  transformSelection,
} from './cadCommands';
import { selectionFromItems, selectionItems } from './selectionModel';
import { entityArea, entityLength } from './cadGeometry';

const ROOM_TYPES = ['Bedroom', 'Living', 'Kitchen', 'Dining', 'Bathroom', 'Pooja', 'Store', 'Study', 'Balcony', 'Other'];

export default function EditorRightPanel({
  layout,
  onUpdateLayout,
  selectedElement,
  onSelectElement,
  unit = 'ft-in',
  validationIssues = [],
  historyManager,
  onRequestPlotResize,
  onRequestSiteChange,
  onNotice,
}) {
  const [tab, setTab] = useState('properties'); // 'properties' | 'validation'
  // Which side stays fixed when the plot size is typed in numerically
  const [resizeAnchorX, setResizeAnchorX] = useState('right'); // 'right' keeps west edge | 'left' keeps east edge | 'symmetric'
  const [resizeAnchorY, setResizeAnchorY] = useState('bottom'); // 'bottom' keeps north edge | 'top' keeps south edge | 'symmetric'

  // Small segmented chooser used by several inspectors
  const renderChoice = (options, value, onPick, keyPrefix) => (
    <View style={styles.chipRow}>
      {options.map((o) => (
        <TouchableOpacity
          key={`${keyPrefix}-${o.value}`}
          style={[styles.chip, value === o.value && styles.chipActive]}
          onPress={() => onPick(o.value)}
        >
          <Text style={[styles.chipText, value === o.value && styles.chipTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // Generic updater
  const updateLayoutAndRecord = (nextLayout) => {
    historyManager.pushState(nextLayout);
    onUpdateLayout(nextLayout);
  };

  const notify = (text) => { if (onNotice) onNotice(text); };

  // ---------------------------------------------------------
  // DUPLICATE, DELETE & LOCK ACTIONS (one object or a multi-selection)
  // ---------------------------------------------------------
  const handleDuplicate = () => {
    const items = selectionItems(selectedElement);
    if (!items.length) return;
    const res = copySelection(layout, items, 2, 2);
    if (res.skipped.length) notify(res.skipped[0]);
    if (res.created.length) {
      updateLayoutAndRecord(res.layout);
      onSelectElement(selectionFromItems(res.layout, res.created));
    }
  };

  const handleDelete = () => {
    const items = selectionItems(selectedElement);
    if (!items.length) return;
    const res = deleteSelection(layout, items);
    if (res.skipped.length) notify(res.skipped[0]);
    if (res.removed) {
      updateLayoutAndRecord(res.layout);
      onSelectElement(null);
    }
  };

  const handleToggleLock = () => {
    const items = selectionItems(selectedElement);
    if (!items.length) return;
    const find = (r) => (layout[COLLECTIONS[r.type]] || []).find((e) => e.id === r.id);
    const lock = !items.every((r) => find(r)?.isLocked);
    const next = { ...layout };
    for (const r of items) {
      const key = COLLECTIONS[r.type];
      next[key] = next[key].map((e) => (e.id === r.id ? { ...e, isLocked: lock } : e));
    }
    updateLayoutAndRecord(next);
    onSelectElement(selectionFromItems(next, items));
  };

  const renderActions = (locked) => (
    <View style={styles.actionsBar}>
      <TouchableOpacity style={styles.actionBtn} onPress={handleDuplicate}>
        <Ionicons name="copy-outline" size={14} color="#334155" />
        <Text style={styles.actionBtnText}>Duplicate</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtn} onPress={handleToggleLock}>
        <Ionicons name={locked ? 'lock-closed' : 'lock-open-outline'} size={14} color="#334155" />
        <Text style={styles.actionBtnText}>{locked ? 'Unlock' : 'Lock'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={handleDelete}>
        <Ionicons name="trash-outline" size={14} color="#DC2626" />
        <Text style={[styles.actionBtnText, { color: '#DC2626' }]}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  const measureField = (label, value, onCommit, opts = {}) => (
    <View style={[styles.inputGroup, { flex: 1 }]}>
      <Text style={styles.inputLabel}>{label}</Text>
      <MeasureInput style={styles.textInput} value={value} unit={unit} onCommit={onCommit} {...opts} />
    </View>
  );

  const numberField = (label, value, onCommit, opts = {}) => (
    <View style={[styles.inputGroup, { flex: 1 }]}>
      <Text style={styles.inputLabel}>{label}</Text>
      <NumberInput style={styles.textInput} value={value} onCommit={onCommit} {...opts} />
    </View>
  );

  // Optional limit: empty clears it
  const optionalMeasure = (label, value, placeholder, onCommit, editable = true) => {
    const display = value !== undefined ? formatMeasurement(value, unit) : '';
    return (
      <View style={[styles.inputGroup, { flex: 1 }]}>
        <Text style={styles.inputLabel}>{label}</Text>
        <DraftInput
          style={styles.textInput}
          editable={editable}
          placeholder={placeholder}
          display={display}
          resolve={(text) => {
            const t = String(text).trim();
            if (t === display) return { action: 'none' };
            if (t === '') return { action: 'commit', value: undefined };
            const feet = parseToFeet(t, unit);
            return feet !== null && feet > 0 ? { action: 'commit', value: feet } : { action: 'revert', reason: 'Enter a positive size, or leave empty.' };
          }}
          onCommit={onCommit}
        />
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER ROOM INSPECTOR
  // ---------------------------------------------------------
  const renderRoomInspector = (room) => {
    const area = room.width * room.length;
    const vastuResult = checkAyaVyayaYoni(room.width, room.length);
    const fitStatus = checkRoomPlotFit(room, layout);

    const handleRoomField = (field, val) => {
      const patch = field === 'name' ? { name: val, label: val } : { [field]: val };
      const updatedRoom = { ...room, ...patch };
      let nextLayout = {
        ...layout,
        rooms: layout.rooms.map((r) => (r.id === room.id ? updatedRoom : r)),
      };
      // Geometry edits go through the room solver: neighbours and shared walls
      // follow, and the outer site boundary never moves.
      if (field === 'width' || field === 'length') {
        const res = setRoomDimension(layout, room.id, field, val);
        if (res.room) {
          updateLayoutAndRecord(res.layout);
          onSelectElement({ type: 'room', data: res.room });
          if (res.conflicts.length) notify(`Stopped at the nearest valid size: ${res.conflicts[0]}`);
        }
        return;
      }
      if (field === 'x' || field === 'y') {
        const res = moveRoom(layout, room.id, field === 'x' ? val - room.x : 0, field === 'y' ? val - room.y : 0);
        if (room.isLocked) { notify('This room is locked.'); return; }
        updateLayoutAndRecord(res.layout);
        onSelectElement({ type: 'room', data: res.room });
        return;
      }
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'room', data: updatedRoom });
    };

    const handleRotateRoom = () => {
      const c = { x: room.x + room.width / 2, y: room.y + room.length / 2 };
      const res = transformSelection(layout, [{ type: 'room', id: room.id }], makeRotate(c, 90));
      if (res.skipped.length) notify(res.skipped[0]);
      if (res.changed) {
        updateLayoutAndRecord(res.layout);
        onSelectElement({ type: 'room', data: res.layout.rooms.find((r) => r.id === room.id) });
      }
    };

    const handleAutoFitToBuildable = () => {
      const { buildable } = fitStatus;
      const newX = Math.max(buildable.minX, Math.min(room.x, buildable.maxX - room.width));
      const newY = Math.max(buildable.minY, Math.min(room.y, buildable.maxY - room.length));
      const res = moveRoom(layout, room.id, Number((newX - room.x).toFixed(4)), Number((newY - room.y).toFixed(4)));
      updateLayoutAndRecord(res.layout);
      onSelectElement({ type: 'room', data: res.room });
    };

    return (
      <View key={`inspector-room-${room?.id || 'room'}`} style={styles.inspectorContent}>
        {/* Header */}
        <View style={styles.elemHeader}>
          <Ionicons name="crop" size={18} color="#2563EB" />
          <Text style={styles.elemTitle}>Room Properties</Text>
        </View>

        {/* Plot & Buildable Bounds Warning */}
        {fitStatus.warnings.length > 0 && (
          <View style={styles.fitWarningCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Ionicons name="warning" size={16} color="#DC2626" />
              <Text style={styles.fitWarningTitle}>Boundary Constraint Alert</Text>
            </View>
            <Text style={styles.fitWarningText}>{fitStatus.warnings[0]}</Text>
            {fitStatus.isOutsideBuildable && !fitStatus.exceedsBuildableDimensions && (
              <TouchableOpacity style={styles.fitActionBtn} onPress={handleAutoFitToBuildable}>
                <Ionicons name="scan-outline" size={13} color="#2563EB" />
                <Text style={styles.fitActionBtnText}>Align Inside Buildable Area</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Room Name */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Room Name</Text>
          <TextField style={styles.textInput} value={room?.name ?? ''} onCommit={(val) => handleRoomField('name', val)} />
        </View>

        {/* Room Type (drives the default constraints and minimum size) */}
        <Text style={styles.inputLabel}>Room Type</Text>
        {renderChoice(
          [{ value: 'auto', label: 'Auto (from name)' }, ...ROOM_TYPES.map((t) => ({ value: t, label: t }))],
          room.roomType || 'auto',
          (v) => handleRoomField('roomType', v === 'auto' ? undefined : v),
          `rt-${room.id}`
        )}

        {/* Dimensions */}
        <View style={styles.rowTwo}>
          {measureField(`Width (${unit})`, room.width, (v) => handleRoomField('width', v), { min: 2.5, editable: !room.isLocked })}
          {measureField(`Length (${unit})`, room.length, (v) => handleRoomField('length', v), { min: 2.5, editable: !room.isLocked })}
        </View>

        {/* Calculated Area Display */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Calculated Carpet Area</Text>
          <Text style={styles.statValue}>{formatArea(area, unit)}</Text>
        </View>

        {/* Position X and Y */}
        <View style={styles.rowTwo}>
          {measureField(`Position X (${unit})`, room.x, (v) => handleRoomField('x', v), { editable: !room.isLocked })}
          {measureField(`Position Y (${unit})`, room.y, (v) => handleRoomField('y', v), { editable: !room.isLocked })}
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={handleRotateRoom}>
          <Ionicons name="refresh-outline" size={14} color="#2563EB" />
          <Text style={styles.secondaryBtnText}>Rotate 90° (swaps width and length)</Text>
        </TouchableOpacity>

        {/* Site-resize constraints */}
        <Text style={styles.subHeading}>Resize Behaviour</Text>
        {renderChoice(
          [
            { value: 'auto', label: `Auto (${inferRoomConstraintType({ ...room, isLocked: false })})` },
            { value: CONSTRAINT_TYPES.FLEXIBLE, label: 'Flexible' },
            { value: CONSTRAINT_TYPES.FIXED, label: 'Fixed' },
          ],
          room.constraintType || 'auto',
          (v) => handleRoomField('constraintType', v === 'auto' ? undefined : v),
          `rc-${room.id}`
        )}
        <Text style={styles.hintText}>
          {room.isLocked
            ? 'Locked: never resized by site changes.'
            : 'Flexible rooms grow or shrink within their limits when the plot changes; fixed rooms keep their size.'}
        </Text>
        <View style={styles.rowTwo}>
          {optionalMeasure('Min W', room.minWidth, formatMeasurement(Math.min(room.width, getRoomTypeMinimum(room)), unit), (v) => handleRoomField('minWidth', v))}
          {optionalMeasure('Max W', room.maxWidth, 'none', (v) => handleRoomField('maxWidth', v))}
        </View>
        <View style={styles.rowTwo}>
          {optionalMeasure('Min L', room.minLength, formatMeasurement(Math.min(room.length, getRoomTypeMinimum(room)), unit), (v) => handleRoomField('minLength', v))}
          {optionalMeasure('Max L', room.maxLength, 'none', (v) => handleRoomField('maxLength', v))}
        </View>
        <View style={styles.chipRow}>
          <TouchableOpacity style={[styles.chip, room.lockWidth && styles.chipActive]} onPress={() => handleRoomField('lockWidth', !room.lockWidth)}>
            <Text style={[styles.chipText, room.lockWidth && styles.chipTextActive]}>Lock width</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, room.lockLength && styles.chipActive]} onPress={() => handleRoomField('lockLength', !room.lockLength)}>
            <Text style={[styles.chipText, room.lockLength && styles.chipTextActive]}>Lock length</Text>
          </TouchableOpacity>
        </View>

        {/* Room Fill Color Picker */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Floor Tint Color</Text>
          <View style={styles.paletteRow}>
            {ROOM_PALETTE.map((c, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.colorCircle,
                  { backgroundColor: c },
                  room.color === c && styles.colorCircleActive,
                ]}
                onPress={() => handleRoomField('color', c)}
              />
            ))}
          </View>
        </View>

        {/* Vastu Compliance Matrix */}
        <View style={styles.vastuCard}>
          <View style={styles.vastuCardHeader}>
            <Ionicons name="compass-outline" size={14} color="#070262" />
            <Text style={styles.vastuCardTitle}>Vastu Aya & Vyaya Score</Text>
          </View>
          <View style={styles.vastuRow}>
            <Text style={styles.vastuLabel}>Aya (Income):</Text>
            <Text style={styles.vastuVal}>{vastuResult.aya}</Text>
          </View>
          <View style={styles.vastuRow}>
            <Text style={styles.vastuLabel}>Vyaya (Expense):</Text>
            <Text style={styles.vastuVal}>{vastuResult.vyaya}</Text>
          </View>
          <View style={styles.vastuRow}>
            <Text style={styles.vastuLabel}>Yoni:</Text>
            <Text style={styles.vastuVal}>{vastuResult.yoni}</Text>
          </View>
          <View style={[styles.vastuStatusBadge, { backgroundColor: vastuResult.status === 'success' ? '#ECFDF5' : '#FEF2F2' }]}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: vastuResult.status === 'success' ? '#059669' : '#DC2626' }}>
              {vastuResult.resultText}
            </Text>
          </View>
        </View>

        {renderActions(room.isLocked)}
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER WALL INSPECTOR
  // ---------------------------------------------------------
  const renderWallInspector = (wall) => {
    const len = calculateWallLength(wall);
    const angle = calculateWallAngle(wall);
    const locked = !!wall.isLocked;

    const applyWall = (res) => {
      if (res.reason) notify(res.reason);
      if (res.layout !== layout) {
        updateLayoutAndRecord(res.layout);
        const fresh = res.layout.walls.find((w) => w.id === wall.id);
        if (fresh) onSelectElement({ type: 'wall', data: fresh });
      }
    };

    // Type and thickness change together, as one edit.
    const setType = (type, thickness) => applyWall({ layout: setWallProps(layout, wall.id, { type, thickness }) });

    // Numeric endpoint entry moves just that endpoint, and may tilt the wall.
    const setEnd = (which, axis, value) => {
      const point = which === 'p1' ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
      applyWall(moveWallEndpointTo(layout, wall.id, which, { ...point, [axis]: value }, { allowDiagonal: true }));
    };

    const handleSplitWall = () => {
      const res = splitWall(layout, wall.id);
      if (res.reason) { notify(res.reason); return; }
      updateLayoutAndRecord(res.layout);
      onSelectElement({ type: 'wall', data: res.segments[0] });
    };

    return (
      <View key={`inspector-wall-${wall?.id || 'wall'}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="pencil" size={18} color="#2563EB" />
          <Text style={styles.elemTitle}>Wall Properties</Text>
        </View>

        {/* Wall Type */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Wall Type</Text>
          <View style={styles.rowTwo}>
            <TouchableOpacity style={[styles.typeBtn, wall.type === 'exterior' && styles.typeBtnActive]} onPress={() => setType('exterior', 0.75)}>
              <Text style={[styles.typeBtnText, wall.type === 'exterior' && styles.typeBtnTextActive]}>Exterior (9")</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.typeBtn, wall.type === 'interior' && styles.typeBtnActive]} onPress={() => setType('interior', 0.375)}>
              <Text style={[styles.typeBtnText, wall.type === 'interior' && styles.typeBtnTextActive]}>Interior (4.5")</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.rowTwo}>
          {measureField('Thickness', wall.thickness, (v) => applyWall({ layout: setWallProps(layout, wall.id, { thickness: v }) }), { min: 0.1, editable: !locked })}
          {measureField('Length', len, (v) => applyWall(setWallLength(layout, wall.id, v)), { min: 0.25, editable: !locked })}
        </View>
        <Text style={styles.hintText}>Changing the length keeps the start point and the wall's direction.</Text>

        <View style={styles.statBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.statLabel}>Orientation Angle:</Text>
            <Text style={styles.statValue}>{angle.toFixed(1)}°</Text>
          </View>
        </View>

        {/* Start Point (X1, Y1) */}
        <Text style={styles.subHeading}>Endpoint 1 (Start)</Text>
        <View style={styles.rowTwo}>
          {measureField('X1', wall.x1, (v) => setEnd('p1', 'x', v), { editable: !locked })}
          {measureField('Y1', wall.y1, (v) => setEnd('p1', 'y', v), { editable: !locked })}
        </View>

        {/* End Point (X2, Y2) */}
        <Text style={styles.subHeading}>Endpoint 2 (End)</Text>
        <View style={styles.rowTwo}>
          {measureField('X2', wall.x2, (v) => setEnd('p2', 'x', v), { editable: !locked })}
          {measureField('Y2', wall.y2, (v) => setEnd('p2', 'y', v), { editable: !locked })}
        </View>

        {/* Split Wall Tool */}
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleSplitWall}>
          <Ionicons name="cut-outline" size={14} color="#2563EB" />
          <Text style={styles.secondaryBtnText}>Split Wall at Midpoint</Text>
        </TouchableOpacity>
        <Text style={styles.hintText}>To join walls: select two collinear walls that touch, then use Join in the Modify tools.</Text>

        {renderActions(locked)}
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER DOOR / WINDOW INSPECTOR
  // ---------------------------------------------------------
  const renderOpeningInspector = (kind, o) => {
    const key = COLLECTIONS[kind];
    const locked = !!o.isLocked;
    const host = getOpeningHost(o, layout.walls);
    const hostLength = host ? calculateWallLength(host.wall) : 0;

    const applyField = (patch) => {
      if (locked) { notify(`This ${kind} is locked.`); return; }
      const next = { ...o, ...patch };
      updateLayoutAndRecord({ ...layout, [key]: layout[key].map((e) => (e.id === o.id ? next : e)) });
      onSelectElement({ type: kind, data: next });
    };
    const applyResult = (res) => {
      if (res.reason) notify(res.reason);
      if (res.layout !== layout) {
        updateLayoutAndRecord(res.layout);
        onSelectElement({ type: kind, data: res.layout[key].find((e) => e.id === o.id) });
      }
    };

    return (
      <View key={`inspector-${kind}-${o.id}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name={kind === 'door' ? 'enter' : 'browsers'} size={18} color={kind === 'door' ? '#B45309' : '#0284C7'} />
          <Text style={styles.elemTitle}>{kind === 'door' ? 'Door' : 'Window'} Properties</Text>
        </View>

        <View style={styles.rowTwo}>
          {measureField(`Width (${unit})`, o.width, (v) => applyResult(resizeOpening(layout, kind, o.id, v)), { min: 1, editable: !locked })}
          {measureField('Along wall', getOpeningPosition(o, layout.walls), (v) => applyResult(setOpeningPosition(layout, kind, o.id, v)), { min: 0, max: hostLength || undefined, editable: !locked && !!host })}
        </View>
        <View style={styles.statBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.statLabel}>Host wall length:</Text>
            <Text style={styles.statValue}>{host ? formatMeasurement(hostLength, unit) : 'Not on a wall'}</Text>
          </View>
        </View>

        {kind === 'door' ? (
          <>
            <Text style={styles.inputLabel}>Door Type</Text>
            {renderChoice(
              [{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }, { value: 'sliding', label: 'Sliding' }],
              o.type,
              (v) => applyField({ type: v }),
              `dt-${o.id}`
            )}
            <View style={styles.rowTwo}>
              <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => applyField({ hinge: o.hinge === 'left' ? 'right' : 'left' })}>
                <Ionicons name="swap-horizontal-outline" size={14} color="#2563EB" />
                <Text style={styles.secondaryBtnText}>Hinge: {o.hinge}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => applyField({ swing: o.swing === 'inward' ? 'outward' : 'inward' })}>
                <Ionicons name="swap-vertical-outline" size={14} color="#2563EB" />
                <Text style={styles.secondaryBtnText}>Swing: {o.swing}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.inputLabel}>Window Style</Text>
            {renderChoice(
              [{ value: 'standard', label: 'Standard' }, { value: 'ventilator', label: 'Ventilator' }, { value: 'bay', label: 'Bay' }],
              o.type,
              (v) => applyField({ type: v }),
              `wt-${o.id}`
            )}
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => applyField({ chajja: !o.chajja })}>
              <Ionicons name={o.chajja ? 'checkbox' : 'square-outline'} size={16} color="#2563EB" />
              <Text style={styles.secondaryBtnText}>Sunshade (Chajja) Projection</Text>
            </TouchableOpacity>
          </>
        )}
        <Text style={styles.hintText}>Its orientation comes from the host wall. Drag it along a wall, or onto another wall.</Text>

        {renderActions(locked)}
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER COLUMN / PARKING / UTILITY / TEXT / DIMENSION / ENTITY INSPECTORS
  // ---------------------------------------------------------
  const patchElement = (type, el, patch) => {
    const key = COLLECTIONS[type];
    const next = { ...el, ...patch };
    updateLayoutAndRecord({ ...layout, [key]: layout[key].map((e) => (e.id === el.id ? next : e)) });
    onSelectElement({ type, data: next });
  };

  const renderHeader = (icon, title) => (
    <View style={styles.elemHeader}>
      <Ionicons name={icon} size={18} color="#2563EB" />
      <Text style={styles.elemTitle}>{title}</Text>
    </View>
  );

  const renderColumnInspector = (c) => {
    const opts = { editable: !c.isLocked };
    const set = (patch) => patchElement('column', c, patch);
    return (
      <View key={`inspector-col-${c.id}`} style={styles.inspectorContent}>
        {renderHeader('cube', 'Column Properties')}
        <View style={styles.rowTwo}>
          {measureField('Center X', c.x, (v) => set({ x: v }), opts)}
          {measureField('Center Y', c.y, (v) => set({ y: v }), opts)}
        </View>
        {measureField('Size', c.size, (v) => set({ size: v }), { ...opts, min: 0.25 })}
        <Text style={styles.inputLabel}>Shape</Text>
        {renderChoice([{ value: 'square', label: 'Square' }, { value: 'round', label: 'Round' }], c.shape, (v) => set({ shape: v }), `cs-${c.id}`)}
        {renderActions(c.isLocked)}
      </View>
    );
  };

  const renderRectInspector = (type, el, title, nameField) => {
    const opts = { editable: !el.isLocked };
    const set = (patch) => patchElement(type, el, patch);
    return (
      <View key={`inspector-${type}-${el.id}`} style={styles.inspectorContent}>
        {renderHeader(type === 'parking' ? 'car' : 'water', title)}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Label</Text>
          <TextField style={styles.textInput} value={el[nameField] ?? ''} onCommit={(v) => set({ [nameField]: v })} />
        </View>
        <View style={styles.rowTwo}>
          {measureField('Position X', el.x, (v) => set({ x: v }), opts)}
          {measureField('Position Y', el.y, (v) => set({ y: v }), opts)}
        </View>
        <View style={styles.rowTwo}>
          {measureField('Width', el.width, (v) => set({ width: v }), { ...opts, min: 0.5 })}
          {measureField('Length', el.length, (v) => set({ length: v }), { ...opts, min: 0.5 })}
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Area</Text>
          <Text style={styles.statValue}>{formatArea(el.width * el.length, unit)}</Text>
        </View>
        {renderActions(el.isLocked)}
      </View>
    );
  };

  const renderAnnotationInspector = (a) => {
    const set = (patch) => patchElement('annotation', a, patch);
    return (
      <View key={`inspector-anno-${a.id}`} style={styles.inspectorContent}>
        {renderHeader('text', 'Text Properties')}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Text</Text>
          <TextField style={styles.textInput} value={a.text} onCommit={(v) => set({ text: v })} />
        </View>
        <View style={styles.rowTwo}>
          {measureField('Position X', a.x, (v) => set({ x: v }), { editable: !a.isLocked })}
          {measureField('Position Y', a.y, (v) => set({ y: v }), { editable: !a.isLocked })}
        </View>
        {numberField('Font size (px)', a.fontSize, (v) => set({ fontSize: v }), { min: 6, max: 72 })}
        {renderActions(a.isLocked)}
      </View>
    );
  };

  const renderUserDimensionInspector = (d) => {
    const set = (patch) => patchElement('dimension', d, patch);
    const opts = { editable: !d.isLocked };
    return (
      <View key={`inspector-udim-${d.id}`} style={styles.inspectorContent}>
        {renderHeader('resize', 'Dimension')}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Measured distance</Text>
          <Text style={styles.statValue}>{formatMeasurement(Math.hypot(d.x2 - d.x1, d.y2 - d.y1), unit)}</Text>
        </View>
        <View style={styles.rowTwo}>
          {measureField('X1', d.x1, (v) => set({ x1: v }), opts)}
          {measureField('Y1', d.y1, (v) => set({ y1: v }), opts)}
        </View>
        <View style={styles.rowTwo}>
          {measureField('X2', d.x2, (v) => set({ x2: v }), opts)}
          {measureField('Y2', d.y2, (v) => set({ y2: v }), opts)}
        </View>
        {measureField('Line offset', d.offset, (v) => set({ offset: v }), opts)}
        {renderActions(d.isLocked)}
      </View>
    );
  };

  const renderEntityInspector = (e) => {
    const set = (patch) => patchElement('entity', e, patch);
    const opts = { editable: !e.isLocked };
    const titles = { line: 'Line', polyline: 'Polyline', polygon: e.shape === 'rect' ? 'Rectangle' : 'Polygon', circle: 'Circle', arc: 'Arc' };
    const area = entityArea(e);
    return (
      <View key={`inspector-ent-${e.id}`} style={styles.inspectorContent}>
        {renderHeader('shapes', titles[e.kind])}
        {e.kind === 'line' && (
          <>
            <View style={styles.rowTwo}>
              {measureField('X1', e.x1, (v) => set({ x1: v }), opts)}
              {measureField('Y1', e.y1, (v) => set({ y1: v }), opts)}
            </View>
            <View style={styles.rowTwo}>
              {measureField('X2', e.x2, (v) => set({ x2: v }), opts)}
              {measureField('Y2', e.y2, (v) => set({ y2: v }), opts)}
            </View>
          </>
        )}
        {(e.kind === 'circle' || e.kind === 'arc') && (
          <>
            <View style={styles.rowTwo}>
              {measureField('Center X', e.cx, (v) => set({ cx: v }), opts)}
              {measureField('Center Y', e.cy, (v) => set({ cy: v }), opts)}
            </View>
            {measureField('Radius', e.r, (v) => set({ r: v }), { ...opts, min: 0.05 })}
          </>
        )}
        {e.kind === 'arc' && (
          <View style={styles.rowTwo}>
            {numberField('Start °', e.start, (v) => set({ start: ((v % 360) + 360) % 360 }), { editable: !e.isLocked })}
            {numberField('End °', e.end, (v) => set({ end: ((v % 360) + 360) % 360 }), { editable: !e.isLocked })}
          </View>
        )}
        <View style={styles.statBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.statLabel}>{e.kind === 'polygon' || e.kind === 'circle' ? 'Perimeter:' : 'Length:'}</Text>
            <Text style={styles.statValue}>{formatMeasurement(entityLength(e), unit)}</Text>
          </View>
          {area > 0 && (
            <View style={[styles.rowBetween, { marginTop: 4 }]}>
              <Text style={styles.statLabel}>Area:</Text>
              <Text style={styles.statValue}>{formatArea(area, unit)}</Text>
            </View>
          )}
        </View>
        {e.points && <Text style={styles.hintText}>Drag a vertex handle to reshape it.</Text>}
        {renderActions(e.isLocked)}
      </View>
    );
  };

  const renderMultiInspector = (items) => {
    const counts = {};
    items.forEach((r) => { counts[r.type] = (counts[r.type] || 0) + 1; });
    const allLocked = items.every((r) => (layout[COLLECTIONS[r.type]] || []).find((e) => e.id === r.id)?.isLocked);
    return (
      <View key="inspector-multi" style={styles.inspectorContent}>
        {renderHeader('albums', `${items.length} Objects Selected`)}
        <View style={styles.statBox}>
          {Object.entries(counts).map(([type, n]) => (
            <View key={type} style={styles.rowBetween}>
              <Text style={styles.statLabel}>{type}</Text>
              <Text style={styles.statValue}>{n}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.hintText}>Drag any selected object to move them together, or use the Modify tools.</Text>
        {renderActions(allLocked)}
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER PLOT / DEFAULT PROJECT INSPECTOR
  // ---------------------------------------------------------
  // ---------------------------------------------------------
  // RENDER STAIRCASE INSPECTOR
  // ---------------------------------------------------------
  const renderStaircaseInspector = (stair) => {
    const geo = calculateStaircaseGeometry(stair);
    const m = geo.metrics;
    const check = validateStaircaseFit(stair, layout);

    // Every edit regenerates the step geometry; `changed` decides which
    // dependent value is recomputed (see staircaseGeometry.js).
    const applyStair = (patch, changed = null) => {
      if (stair.isLocked) return;
      const next = normalizeStaircase({ ...stair, ...patch }, changed);
      updateLayoutAndRecord({
        ...layout,
        staircases: layout.staircases.map((st) => (st.id === stair.id ? next : st)),
      });
      onSelectElement({ type: 'staircase', data: next });
    };

    const lengthInput = (field, label, minFeet = 0) => (
      <View style={[styles.inputGroup, { flex: 1 }]}>
        <Text style={styles.inputLabel}>{label}</Text>
        <MeasureInput
          style={styles.textInput}
          editable={!stair.isLocked}
          value={stair[field] ?? 0}
          unit={unit}
          min={minFeet}
          onCommit={(f) => applyStair({ [field]: f }, field)}
        />
      </View>
    );

    const isTwoFlight = m.flights === 2;
    const isL = stair.stairType === STAIRCASE_TYPES.L_SHAPED;
    const isStraight = stair.stairType === STAIRCASE_TYPES.STRAIGHT;
    const isOpenWell = isTwoFlight && !isL;

    return (
      <View key={`inspector-stair-${stair.id}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="trending-up" size={18} color="#2563EB" />
          <Text style={styles.elemTitle}>Staircase Properties</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Label</Text>
          <TextField style={styles.textInput} value={stair.label || ''} onCommit={(v) => applyStair({ label: v })} />
        </View>

        <Text style={styles.inputLabel}>Type</Text>
        {renderChoice(
          [
            { value: STAIRCASE_TYPES.STRAIGHT, label: 'Straight' },
            { value: STAIRCASE_TYPES.DOG_LEGGED, label: 'Dog-legged' },
            { value: STAIRCASE_TYPES.U_SHAPED, label: 'U-shaped' },
            { value: STAIRCASE_TYPES.L_SHAPED, label: 'L-shaped' },
          ],
          stair.stairType,
          (v) => applyStair({ stairType: v, wellGap: undefined, landingDepth: undefined, firstFlightRisers: undefined }, 'stairType'),
          `st-type-${stair.id}`
        )}

        <View style={styles.rowTwo}>
          {lengthInput('x', `X (${unit})`, -1000)}
          {lengthInput('y', `Y (${unit})`, -1000)}
        </View>
        <View style={styles.rowTwo}>
          {lengthInput('width', 'Overall width', 2)}
          {lengthInput('length', 'Overall length', 2)}
        </View>
        <Text style={styles.hintText}>Changing the length keeps the step count and recalculates the tread depth.</Text>

        <View style={styles.rowTwo}>
          {lengthInput('floorHeight', 'Floor-to-floor', 6)}
          {lengthInput('riserHeight', 'Riser height', 0.1)}
        </View>
        <Text style={styles.hintText}>Riser height = floor height ÷ risers. Entering a riser height sets the nearest whole number of risers.</Text>
        <View style={styles.rowTwo}>
          {numberField('Risers', stair.risers, (n) => applyStair({ risers: n }, 'risers'), { integer: true, min: 2, max: 40, editable: !stair.isLocked })}
          {numberField('Treads', m.totalTreads, (n) => applyStair({ treads: n }, 'treads'), { integer: true, min: 1, max: 38, editable: !stair.isLocked })}
        </View>
        <View style={styles.rowTwo}>
          {lengthInput('treadDepth', 'Tread depth', 0.25)}
          {isOpenWell ? lengthInput('wellGap', 'Well gap', 0) : <View style={{ flex: 1 }} />}
        </View>

        <Text style={styles.inputLabel}>Number of flights</Text>
        {renderChoice(
          [{ value: 1, label: '1 flight' }, { value: 2, label: '2 flights' }],
          m.flights,
          (v) => {
            if (v === m.flights) return;
            applyStair({ stairType: v === 1 ? STAIRCASE_TYPES.STRAIGHT : STAIRCASE_TYPES.DOG_LEGGED, wellGap: undefined, landingDepth: undefined, firstFlightRisers: undefined }, 'stairType');
          },
          `st-fl-${stair.id}`
        )}
        {isTwoFlight && (
          <View style={styles.rowTwo}>
            {numberField('Steps, flight 1', m.treadsPerFlight[0], (n) => applyStair({ firstFlightRisers: n + 1 }, 'firstFlightRisers'), { integer: true, min: 1, max: m.totalTreads - 1, editable: !stair.isLocked })}
            {numberField('Steps, flight 2', m.treadsPerFlight[1], (n) => applyStair({ firstFlightRisers: stair.risers - (n + 1) }, 'firstFlightRisers'), { integer: true, min: 1, max: m.totalTreads - 1, editable: !stair.isLocked })}
          </View>
        )}
        {isOpenWell && (
          <View style={styles.rowTwo}>
            {lengthInput('width', 'Landing width', 4)}
            {lengthInput('landingDepth', 'Landing length', 2)}
          </View>
        )}
        {isL && (
          <View style={styles.rowTwo}>
            {lengthInput('flightWidth', 'Landing size (= flight width)', 2)}
            <View style={{ flex: 1 }} />
          </View>
        )}
        {isStraight && <Text style={styles.hintText}>A single straight flight has no landing.</Text>}

        <Text style={styles.inputLabel}>Direction</Text>
        {renderChoice(
          [{ value: 'up', label: 'UP' }, { value: 'down', label: 'DN' }],
          stair.direction || 'up',
          (v) => applyStair({ direction: v }),
          `st-dir-${stair.id}`
        )}

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => applyStair({ mirrored: !stair.mirrored })}>
          <Ionicons name="swap-horizontal-outline" size={14} color="#2563EB" />
          <Text style={styles.secondaryBtnText}>Flip Direction of Turn ({stair.mirrored ? 'mirrored' : 'standard'})</Text>
        </TouchableOpacity>

        <View style={styles.actionsBar}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              if (stair.isLocked) return;
              const next = rotateStaircase(stair, 90);
              updateLayoutAndRecord({ ...layout, staircases: layout.staircases.map((st) => (st.id === stair.id ? next : st)) });
              onSelectElement({ type: 'staircase', data: next });
            }}
          >
            <Ionicons name="refresh" size={14} color="#334155" />
            <Text style={styles.actionBtnText}>Rotate 90° ({geo.rotation}°)</Text>
          </TouchableOpacity>
        </View>

        {/* Calculated geometry */}
        <View style={styles.statBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.statLabel}>Risers / treads:</Text>
            <Text style={styles.statValue}>{m.totalRisers}R / {m.totalTreads}T</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Treads per flight:</Text>
            <Text style={styles.statValue}>{m.treadsPerFlight.join(' + ')}{m.landings ? ` (${m.landings} landing)` : ''}</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Riser height:</Text>
            <Text style={styles.statValue}>{m.riserHeightInches.toFixed(2)}"</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Tread depth:</Text>
            <Text style={styles.statValue}>{m.treadDepthInches.toFixed(2)}"</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Run per flight:</Text>
            <Text style={styles.statValue}>{m.runs.map((r) => formatMeasurement(r, unit)).join(' + ')}</Text>
          </View>
        </View>
        <Text style={styles.hintText}>
          Convention: each flight has one fewer tread than risers; landings are not counted as treads.
        </Text>

        {check.warnings.length > 0 && (
          <View style={styles.fitWarningCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Ionicons name="warning" size={16} color="#D97706" />
              <Text style={styles.fitWarningTitle}>Drafting guideline notes</Text>
            </View>
            {check.warnings.map((w, i) => <Text key={`sw-${i}`} style={styles.fitWarningText}>{w}</Text>)}
            <Text style={[styles.hintText, { marginTop: 4 }]}>Geometric checks only - not a structural or building-code review.</Text>
          </View>
        )}

        {/* Site-resize constraints */}
        <Text style={styles.subHeading}>Resize Behaviour</Text>
        {renderChoice(
          [{ value: 'fixed', label: 'Fixed size' }, { value: 'flexible', label: 'Flexible' }],
          stair.constraintType === 'flexible' ? 'flexible' : 'fixed',
          (v) => applyStair({ constraintType: v }),
          `st-c-${stair.id}`
        )}
        <Text style={styles.inputLabel}>Anchor (staircases outside the building)</Text>
        {renderChoice(
          [
            { value: 'none', label: 'Nearest edge' },
            { value: 'top-left', label: 'NW' }, { value: 'top-right', label: 'NE' },
            { value: 'bottom-left', label: 'SW' }, { value: 'bottom-right', label: 'SE' },
            { value: 'center', label: 'Centre' },
          ],
          stair.anchor || 'none',
          (v) => applyStair({ anchor: v }),
          `st-a-${stair.id}`
        )}

        {renderActions(stair.isLocked)}
      </View>
    );
  };

  const renderPlotInspector = () => {
    const plotW = layout.plot?.width || 30;
    const plotL = layout.plot?.length || 40;
    const totalPlotArea = plotW * plotL;

    let totalCarpet = 0;
    (layout.rooms || []).forEach(r => {
      totalCarpet += (r.width || 0) * (r.length || 0);
    });

    const groundCoverage = totalPlotArea > 0 ? (totalCarpet / totalPlotArea) * 100 : 0;
    const { buildable } = getPlotAndBuildableBounds(layout);

    const handleSetback = (key, feet) => {
      if (onRequestSiteChange) onRequestSiteChange({ setbacks: { [key]: Number(feet.toFixed(4)) } });
    };

    const handlePlotDim = (field, feet) => {
      if (onRequestPlotResize) onRequestPlotResize(field, feet, { edge: field === 'width' ? resizeAnchorX : resizeAnchorY });
    };

    return (
      <View key="inspector-plot" style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="map" size={18} color="#D97706" />
          <Text style={styles.elemTitle}>Plot & Building Parameters</Text>
        </View>

        {/* Plot Dimensions */}
        <View style={styles.rowTwo}>
          {measureField(`Plot Width (${unit})`, plotW, (v) => handlePlotDim('width', v), { min: 5 })}
          {measureField(`Plot Length (${unit})`, plotL, (v) => handlePlotDim('length', v), { min: 5 })}
        </View>

        <Text style={styles.inputLabel}>When width changes, move</Text>
        {renderChoice(
          [{ value: 'right', label: 'East edge' }, { value: 'left', label: 'West edge' }, { value: 'symmetric', label: 'Both' }],
          resizeAnchorX, setResizeAnchorX, 'rax'
        )}
        <Text style={styles.inputLabel}>When length changes, move</Text>
        {renderChoice(
          [{ value: 'bottom', label: 'South edge' }, { value: 'top', label: 'North edge' }, { value: 'symmetric', label: 'Both' }],
          resizeAnchorY, setResizeAnchorY, 'ray'
        )}
        <Text style={styles.hintText}>Only the plot boundary changes; the building stays exactly where it is. On the canvas, drag the orange edge handles; hold Shift to resize symmetrically.</Text>

        {/* Setbacks (editable - the building reflows to the new buildable area) */}
        <Text style={styles.subHeading}>Setbacks</Text>
        <View style={styles.rowTwo}>
          {['north', 'south'].map((k) => (
            <React.Fragment key={`sb-${k}`}>
              {measureField(k === 'north' ? 'North (front/top)' : 'South (bottom)', layout.plot?.setbacks?.[k] ?? 0, (v) => handleSetback(k, v), { min: 0 })}
            </React.Fragment>
          ))}
        </View>
        <View style={styles.rowTwo}>
          {['west', 'east'].map((k) => (
            <React.Fragment key={`sb-${k}`}>
              {measureField(k === 'west' ? 'West (left)' : 'East (right)', layout.plot?.setbacks?.[k] ?? 0, (v) => handleSetback(k, v), { min: 0 })}
            </React.Fragment>
          ))}
        </View>
        <View style={styles.statBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.statLabel}>Buildable area:</Text>
            <Text style={styles.statValue}>
              {formatMeasurement(buildable.width, unit)} × {formatMeasurement(buildable.length, unit)}
            </Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Buildable floor area:</Text>
            <Text style={styles.statValue}>{formatArea(buildable.width * buildable.length, unit)}</Text>
          </View>
        </View>

        {/* Orientation */}
        <Text style={styles.subHeading}>Orientation</Text>
        <Text style={styles.inputLabel}>Road-facing side</Text>
        {renderChoice(
          ['North', 'South', 'East', 'West'].map((d) => ({ value: d, label: d })),
          (layout.plot?.roadDirection || 'North Road').replace(' Road', ''),
          (d) => updateLayoutAndRecord({ ...layout, plot: { ...layout.plot, roadDirection: `${d} Road`, facing: d } }),
          'road'
        )}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>North direction (degrees clockwise from up)</Text>
          <NumberInput
            style={styles.textInput}
            value={layout.plot?.compassAngle ?? 0}
            onCommit={(v) => updateLayoutAndRecord({ ...layout, plot: { ...layout.plot, compassAngle: ((v % 360) + 360) % 360 } })}
          />
        </View>

        {/* Project Area Summary */}
        <Text style={styles.subHeading}>Architectural Area Summary</Text>
        <View style={styles.statBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.statLabel}>Total Plot Area:</Text>
            <Text style={styles.statValue}>{formatArea(totalPlotArea, unit)}</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Total Carpet Area:</Text>
            <Text style={styles.statValue}>{formatArea(totalCarpet, unit)}</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Ground Coverage:</Text>
            <Text style={[styles.statValue, { color: groundCoverage > 75 ? '#DC2626' : '#059669' }]}>
              {groundCoverage.toFixed(1)}%
            </Text>
          </View>
        </View>

        {/* Elements Count */}
        <Text style={styles.subHeading}>Elements Count</Text>
        <View style={styles.badgeRow}>
          <View style={styles.countBadge}>
            <Text style={styles.countNumber}>{layout.rooms?.length || 0}</Text>
            <Text style={styles.countLabel}>Rooms</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countNumber}>{layout.walls?.length || 0}</Text>
            <Text style={styles.countLabel}>Walls</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countNumber}>{layout.doors?.length || 0}</Text>
            <Text style={styles.countLabel}>Doors</Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countNumber}>{layout.windows?.length || 0}</Text>
            <Text style={styles.countLabel}>Windows</Text>
          </View>
        </View>
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER PLOT DIMENSION ANNOTATION INSPECTOR
  // ---------------------------------------------------------
  const renderDimensionInspector = (data) => {
    const axis = data?.axis || 'width';
    const meta = getPlotDimensionMetaSafe(axis);
    const label = axis === 'width' ? 'Plot Width' : 'Plot Length';

    const handleValue = (feet) => {
      if (onRequestPlotResize) onRequestPlotResize(axis, feet);
    };

    const handleOffset = (off) => {
      updateLayoutAndRecord(setPlotDimensionOffset(cloneLayout(layout), axis, off));
    };

    return (
      <View key={`inspector-dim-${axis}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="resize" size={18} color="#2563EB" />
          <Text style={styles.elemTitle}>{label} Dimension</Text>
        </View>

        {measureField(`${label} (${unit})`, meta.value, handleValue, { min: 5 })}
        {measureField(`Annotation Offset (${unit})`, meta.offset, handleOffset, { min: 0.5 })}

        <View style={[styles.statBox, { marginTop: 10 }]}>
          <Text style={styles.statLabel}>
            Linked to the real plot boundary. Editing the value resizes the plot; the offset only moves the dimension line.
          </Text>
        </View>
      </View>
    );
  };

  const getPlotDimensionMetaSafe = (axis) => {
    const plot = layout?.plot || {};
    const value = axis === 'width' ? (Number(plot.width) || 30) : (Number(plot.length) || 40);
    const id = axis === 'width' ? 'dim-plot-width' : 'dim-plot-length';
    const dim = (layout?.dimensions || []).find((d) => d.id === id);
    const offset = dim && Number(dim.offset) ? Math.abs(Number(dim.offset)) : 2.5;
    return { id, axis, value, offset };
  };

  // ---------------------------------------------------------
  // RENDER VALIDATION ISSUES LIST
  // ---------------------------------------------------------
  const renderValidationTab = () => {
    return (
      <View key="inspector-validation" style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="shield-checkmark" size={18} color="#059669" />
          <Text style={styles.elemTitle}>Layout Validation</Text>
        </View>

        {validationIssues.length === 0 ? (
          <View style={styles.emptyValidation}>
            <Ionicons name="checkmark-circle" size={32} color="#10B981" />
            <Text style={styles.emptyValidationTitle}>No Architectural Errors</Text>
            <Text style={styles.emptyValidationText}>
              All rooms, walls, doors, and setback constraints satisfy structural guidelines.
            </Text>
          </View>
        ) : (
          <View style={styles.issuesList}>
            {validationIssues.map(issue => (
              <TouchableOpacity
                key={issue.id}
                style={[
                  styles.issueCard,
                  { borderLeftColor: issue.severity === 'error' ? '#DC2626' : '#D97706' },
                ]}
                onPress={() => {
                  // Navigate / select the problematic element
                  if (issue.elementId) {
                    const found = selectionFromItems(layout, [{ type: issue.elementType, id: issue.elementId }]);
                    if (COLLECTIONS[issue.elementType] && found) onSelectElement(found);
                  }
                }}
              >
                <View style={styles.issueHeader}>
                  <Ionicons
                    name={issue.severity === 'error' ? "alert-circle" : "warning"}
                    size={14}
                    color={issue.severity === 'error' ? '#DC2626' : '#D97706'}
                  />
                  <Text style={styles.issueTitle}>{issue.title}</Text>
                </View>
                <Text style={styles.issueMessage}>{issue.message}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.panel}>
      {/* Tab Switcher */}
      <View style={styles.tabHeader}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'properties' && styles.tabBtnActive]}
          onPress={() => setTab('properties')}
        >
          <Text style={[styles.tabBtnText, tab === 'properties' && styles.tabBtnTextActive]}>
            Properties
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'validation' && styles.tabBtnActive]}
          onPress={() => setTab('validation')}
        >
          <Text style={[styles.tabBtnText, tab === 'validation' && styles.tabBtnTextActive]}>
            Validation ({validationIssues.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
        {tab === 'validation' ? (
          renderValidationTab()
        ) : selectedElement ? (
          selectedElement.type === 'room' ? (
            renderRoomInspector(selectedElement.data)
          ) : selectedElement.type === 'wall' ? (
            renderWallInspector(selectedElement.data)
          ) : selectedElement.type === 'door' || selectedElement.type === 'window' ? (
            renderOpeningInspector(selectedElement.type, selectedElement.data)
          ) : selectedElement.type === 'multi' ? (
            renderMultiInspector(selectedElement.data.items)
          ) : selectedElement.type === 'column' ? (
            renderColumnInspector(selectedElement.data)
          ) : selectedElement.type === 'parking' ? (
            renderRectInspector('parking', selectedElement.data, 'Parking Properties', 'label')
          ) : selectedElement.type === 'utility' ? (
            renderRectInspector('utility', selectedElement.data, 'Utility Properties', 'name')
          ) : selectedElement.type === 'annotation' ? (
            renderAnnotationInspector(selectedElement.data)
          ) : selectedElement.type === 'entity' ? (
            renderEntityInspector(selectedElement.data)
          ) : selectedElement.type === 'dimension' ? (
            isPlotDimension(selectedElement.data?.id) ? renderDimensionInspector(selectedElement.data) : renderUserDimensionInspector(selectedElement.data)
          ) : selectedElement.type === 'staircase' ? (
            renderStaircaseInspector(selectedElement.data)
          ) : (
            renderPlotInspector()
          )
        ) : (
          renderPlotInspector()
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  chipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#1D4ED8',
  },
  hintText: {
    fontSize: 10,
    color: '#64748B',
    marginBottom: 10,
    lineHeight: 14,
  },
  panel: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1.2,
    borderLeftColor: '#CBD5E1',
    flexDirection: 'column',
    zIndex: 40,
  },
  tabHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderBottomColor: '#2563EB',
  },
  tabBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  tabBtnTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  inspectorContent: {
    padding: 14,
    gap: 12,
  },
  elemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  elemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  inputGroup: {
    gap: 4,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  textInput: {
    height: 32,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 5,
    paddingHorizontal: 8,
    fontSize: 12,
    color: '#1E293B',
    fontWeight: '600',
  },
  rowTwo: {
    flexDirection: 'row',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statBox: {
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  paletteRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  colorCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  colorCircleActive: {
    borderColor: '#2563EB',
    borderWidth: 2.5,
  },
  vastuCard: {
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    gap: 4,
  },
  vastuCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  vastuCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#070262',
  },
  vastuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  vastuLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  vastuVal: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
  },
  vastuStatusBadge: {
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: 'center',
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 5,
  },
  typeBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  typeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  typeBtnTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    backgroundColor: '#EFF6FF',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  secondaryBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563EB',
  },
  actionsBar: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    backgroundColor: '#F1F5F9',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  deleteBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  subHeading: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  countBadge: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  countNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  countLabel: {
    fontSize: 9,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  emptyValidation: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
  },
  emptyValidationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#10B981',
  },
  emptyValidationText: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 16,
  },
  issuesList: {
    gap: 8,
  },
  issueCard: {
    padding: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 3.5,
    gap: 3,
  },
  issueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  issueTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
  },
  issueMessage: {
    fontSize: 10,
    color: '#64748B',
    lineHeight: 14,
  },
  fitWarningCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
  fitWarningTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
    marginLeft: 6,
  },
  fitWarningText: {
    fontSize: 10.5,
    color: '#991B1B',
    lineHeight: 15,
  },
  fitActionBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  fitActionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563EB',
  },
});
