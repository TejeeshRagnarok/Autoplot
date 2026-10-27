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
  splitWallAtPoint,
  generateUniqueId,
  ROOM_PALETTE,
  setPlotDimensionOffset,
  checkRoomPlotFit,
  syncRoomWithWallsAndOpenings,
  getPlotAndBuildableBounds,
  cloneLayout,
  normalizeStaircase,
  rotateStaircase,
  calculateStaircaseGeometry,
  validateStaircaseFit,
  STAIRCASE_TYPES,
  inferRoomConstraintType,
  getRoomTypeMinimum,
  CONSTRAINT_TYPES,
} from './layoutModel';
import { checkAyaVyayaYoni } from '../../constants/vastuData';
import { setRoomDimension, moveRoom } from './roomResize';

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

  // ---------------------------------------------------------
  // DUPLICATE & DELETE ACTIONS
  // ---------------------------------------------------------
  const handleDuplicate = () => {
    if (!selectedElement || !layout) return;
    const { type, data } = selectedElement;
    const nextLayout = { ...layout };
    const offset = 2.0;

    if (type === 'room') {
      const copy = {
        ...data,
        id: generateUniqueId('room'),
        name: `${data.name} (Copy)`,
        x: data.x + offset,
        y: data.y + offset,
      };
      nextLayout.rooms = [...(layout.rooms || []), copy];
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'room', data: copy });
    } else if (type === 'wall') {
      const copy = {
        ...data,
        id: generateUniqueId('wall'),
        x1: data.x1 + offset,
        y1: data.y1 + offset,
        x2: data.x2 + offset,
        y2: data.y2 + offset,
      };
      nextLayout.walls = [...(layout.walls || []), copy];
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'wall', data: copy });
    } else if (type === 'door') {
      const copy = {
        ...data,
        id: generateUniqueId('door'),
        x: data.x + offset,
        y: data.y + offset,
      };
      nextLayout.doors = [...(layout.doors || []), copy];
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'door', data: copy });
    } else if (type === 'window') {
      const copy = {
        ...data,
        id: generateUniqueId('win'),
        x: data.x + offset,
        y: data.y + offset,
      };
      nextLayout.windows = [...(layout.windows || []), copy];
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'window', data: copy });
    } else if (type === 'column') {
      const copy = {
        ...data,
        id: generateUniqueId('col'),
        x: data.x + offset,
        y: data.y + offset,
      };
      nextLayout.columns = [...(layout.columns || []), copy];
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'column', data: copy });
    } else if (type === 'staircase') {
      const copy = {
        ...cloneLayout(data),
        id: generateUniqueId('stair'),
        x: data.x + offset,
        y: data.y + offset,
      };
      nextLayout.staircases = [...(layout.staircases || []), copy];
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'staircase', data: copy });
    }
  };

  const handleDelete = () => {
    if (!selectedElement || !layout) return;
    const { type, data } = selectedElement;

    if (type === 'room' && layout.rooms?.length <= 1) {
      alert('Cannot delete the only remaining room.');
      return;
    }

    const nextLayout = { ...layout };
    if (type === 'room') {
      nextLayout.rooms = (layout.rooms || []).filter(r => r.id !== data.id);
    } else if (type === 'wall') {
      nextLayout.walls = (layout.walls || []).filter(w => w.id !== data.id);
    } else if (type === 'door') {
      nextLayout.doors = (layout.doors || []).filter(d => d.id !== data.id);
    } else if (type === 'window') {
      nextLayout.windows = (layout.windows || []).filter(w => w.id !== data.id);
    } else if (type === 'column') {
      nextLayout.columns = (layout.columns || []).filter(c => c.id !== data.id);
    } else if (type === 'staircase') {
      nextLayout.staircases = (layout.staircases || []).filter(s => s.id !== data.id);
    } else if (type === 'utility') {
      nextLayout.utilities = (layout.utilities || []).filter(u => u.id !== data.id);
    } else if (type === 'parking') {
      nextLayout.parking = (layout.parking || []).filter(p => p.id !== data.id);
    }

    updateLayoutAndRecord(nextLayout);
    onSelectElement(null);
  };

  const handleToggleLock = () => {
    if (!selectedElement || !layout) return;
    const { type, data } = selectedElement;
    const nextLocked = !data.isLocked;

    const nextLayout = { ...layout };
    if (type === 'room') {
      nextLayout.rooms = layout.rooms.map(r => r.id === data.id ? { ...r, isLocked: nextLocked } : r);
    } else if (type === 'wall') {
      nextLayout.walls = layout.walls.map(w => w.id === data.id ? { ...w, isLocked: nextLocked } : w);
    } else if (type === 'door') {
      nextLayout.doors = layout.doors.map(d => d.id === data.id ? { ...d, isLocked: nextLocked } : d);
    } else if (type === 'window') {
      nextLayout.windows = layout.windows.map(w => w.id === data.id ? { ...w, isLocked: nextLocked } : w);
    } else if (type === 'staircase') {
      nextLayout.staircases = layout.staircases.map(st => st.id === data.id ? { ...st, isLocked: nextLocked } : st);
    }

    updateLayoutAndRecord(nextLayout);
    onSelectElement({ type, data: { ...data, isLocked: nextLocked } });
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
          if (res.conflicts.length && typeof alert === 'function') alert(`Stopped at the nearest valid size: ${res.conflicts[0]}`);
        }
        return;
      }
      if (field === 'x' || field === 'y') {
        const res = moveRoom(layout, room.id, field === 'x' ? val - room.x : 0, field === 'y' ? val - room.y : 0);
        updateLayoutAndRecord(res.layout);
        onSelectElement({ type: 'room', data: res.room });
        return;
      }
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'room', data: updatedRoom });
    };

    const handleDimensionInput = (field, text) => {
      const feet = parseToFeet(text, unit);
      if (feet !== null && feet >= 2.5) {
        handleRoomField(field, Number(feet.toFixed(2)));
      }
    };

    const handlePositionInput = (field, text) => {
      const feet = parseToFeet(text, unit);
      if (feet !== null) {
        handleRoomField(field, Number(feet.toFixed(2)));
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
          <TextInput
            key={`room-name-${room?.id || 'room'}`}
            style={styles.textInput}
            value={room?.name ?? ''}
            onChangeText={(val) => handleRoomField('name', val)}
          />
        </View>

        {/* Dimensions */}
        <View style={styles.rowTwo}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Width ({unit})</Text>
            <TextInput
              key={`room-w-${room?.id}-${room?.width}-${unit}`}
              style={styles.textInput}
              defaultValue={formatMeasurement(room?.width ?? 10, unit)}
              onBlur={(e) => handleDimensionInput('width', e.nativeEvent.text)}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Length ({unit})</Text>
            <TextInput
              key={`room-l-${room?.id}-${room?.length}-${unit}`}
              style={styles.textInput}
              defaultValue={formatMeasurement(room?.length ?? 10, unit)}
              onBlur={(e) => handleDimensionInput('length', e.nativeEvent.text)}
            />
          </View>
        </View>

        {/* Calculated Area Display */}
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Calculated Carpet Area</Text>
          <Text style={styles.statValue}>{formatArea(area, unit)}</Text>
        </View>

        {/* Position X and Y */}
        <View style={styles.rowTwo}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Position X ({unit})</Text>
            <TextInput
              key={`room-x-${room?.id}-${room?.x}-${unit}`}
              style={styles.textInput}
              defaultValue={formatMeasurement(room?.x ?? 0, unit)}
              onBlur={(e) => handlePositionInput('x', e.nativeEvent.text)}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Position Y ({unit})</Text>
            <TextInput
              key={`room-y-${room?.id}-${room?.y}-${unit}`}
              style={styles.textInput}
              defaultValue={formatMeasurement(room?.y ?? 0, unit)}
              onBlur={(e) => handlePositionInput('y', e.nativeEvent.text)}
            />
          </View>
        </View>

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
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Min W</Text>
            <TextInput
              key={`room-minw-${room.id}-${room.minWidth}-${unit}`}
              style={styles.textInput}
              placeholder={formatMeasurement(Math.min(room.width, getRoomTypeMinimum(room)), unit)}
              defaultValue={room.minWidth !== undefined ? formatMeasurement(room.minWidth, unit) : ''}
              onBlur={(e) => { const t = e.nativeEvent.text.trim(); const f = parseToFeet(t, unit); handleRoomField('minWidth', t === '' ? undefined : (f !== null && f > 0 ? f : room.minWidth)); }}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Max W</Text>
            <TextInput
              key={`room-maxw-${room.id}-${room.maxWidth}-${unit}`}
              style={styles.textInput}
              placeholder="none"
              defaultValue={room.maxWidth !== undefined ? formatMeasurement(room.maxWidth, unit) : ''}
              onBlur={(e) => { const t = e.nativeEvent.text.trim(); const f = parseToFeet(t, unit); handleRoomField('maxWidth', t === '' ? undefined : (f !== null && f > 0 ? f : room.maxWidth)); }}
            />
          </View>
        </View>
        <View style={styles.rowTwo}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Min L</Text>
            <TextInput
              key={`room-minl-${room.id}-${room.minLength}-${unit}`}
              style={styles.textInput}
              placeholder={formatMeasurement(Math.min(room.length, getRoomTypeMinimum(room)), unit)}
              defaultValue={room.minLength !== undefined ? formatMeasurement(room.minLength, unit) : ''}
              onBlur={(e) => { const t = e.nativeEvent.text.trim(); const f = parseToFeet(t, unit); handleRoomField('minLength', t === '' ? undefined : (f !== null && f > 0 ? f : room.minLength)); }}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Max L</Text>
            <TextInput
              key={`room-maxl-${room.id}-${room.maxLength}-${unit}`}
              style={styles.textInput}
              placeholder="none"
              defaultValue={room.maxLength !== undefined ? formatMeasurement(room.maxLength, unit) : ''}
              onBlur={(e) => { const t = e.nativeEvent.text.trim(); const f = parseToFeet(t, unit); handleRoomField('maxLength', t === '' ? undefined : (f !== null && f > 0 ? f : room.maxLength)); }}
            />
          </View>
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

        {/* Action Buttons */}
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleDuplicate}>
            <Ionicons name="copy-outline" size={14} color="#334155" />
            <Text style={styles.actionBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleToggleLock}>
            <Ionicons name={room.isLocked ? "lock-closed" : "lock-open-outline"} size={14} color="#334155" />
            <Text style={styles.actionBtnText}>{room.isLocked ? "Unlock" : "Lock"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={14} color="#DC2626" />
            <Text style={[styles.actionBtnText, { color: '#DC2626' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER WALL INSPECTOR
  // ---------------------------------------------------------
  const renderWallInspector = (wall) => {
    const len = calculateWallLength(wall);
    const angle = calculateWallAngle(wall);

    const handleWallField = (field, val) => {
      const nextWalls = layout.walls.map(w => w.id === wall.id ? { ...w, [field]: val } : w);
      const nextLayout = { ...layout, walls: nextWalls };
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'wall', data: { ...wall, [field]: val } });
    };

    const handleSplitWall = () => {
      const segments = splitWallAtPoint(wall, {
        x: (wall.x1 + wall.x2) / 2,
        y: (wall.y1 + wall.y2) / 2,
      });
      const nextWalls = layout.walls.filter(w => w.id !== wall.id).concat(segments);
      const nextLayout = { ...layout, walls: nextWalls };
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'wall', data: segments[0] });
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
            <TouchableOpacity
              style={[styles.typeBtn, wall.type === 'exterior' && styles.typeBtnActive]}
              onPress={() => {
                handleWallField('type', 'exterior');
                handleWallField('thickness', 0.75);
              }}
            >
              <Text style={[styles.typeBtnText, wall.type === 'exterior' && styles.typeBtnTextActive]}>
                Exterior (9")
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, wall.type === 'interior' && styles.typeBtnActive]}
              onPress={() => {
                handleWallField('type', 'interior');
                handleWallField('thickness', 0.375);
              }}
            >
              <Text style={[styles.typeBtnText, wall.type === 'interior' && styles.typeBtnTextActive]}>
                Interior (4.5")
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Thickness */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Wall Thickness (ft)</Text>
          <TextInput
            key={`wall-th-${wall?.id}-${wall?.thickness}`}
            style={styles.textInput}
            defaultValue={String(wall?.thickness ?? 0.375)}
            onBlur={(e) => handleWallField('thickness', parseFloat(e.nativeEvent.text) || 0.375)}
          />
        </View>

        {/* Wall Length & Angle */}
        <View style={styles.statBox}>
          <View style={styles.rowBetween}>
            <Text style={styles.statLabel}>Length:</Text>
            <Text style={styles.statValue}>{formatMeasurement(len, unit)}</Text>
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            <Text style={styles.statLabel}>Orientation Angle:</Text>
            <Text style={styles.statValue}>{Math.round(angle)}°</Text>
          </View>
        </View>

        {/* Start Point (X1, Y1) */}
        <Text style={styles.subHeading}>Endpoint 1 (Start)</Text>
        <View style={styles.rowTwo}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>X1 (ft)</Text>
            <TextInput
              key={`wall-x1-${wall?.id}-${wall?.x1}`}
              style={styles.textInput}
              defaultValue={String(wall?.x1 ?? 0)}
              onBlur={(e) => handleWallField('x1', parseFloat(e.nativeEvent.text) || 0)}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Y1 (ft)</Text>
            <TextInput
              key={`wall-y1-${wall?.id}-${wall?.y1}`}
              style={styles.textInput}
              defaultValue={String(wall?.y1 ?? 0)}
              onBlur={(e) => handleWallField('y1', parseFloat(e.nativeEvent.text) || 0)}
            />
          </View>
        </View>

        {/* End Point (X2, Y2) */}
        <Text style={styles.subHeading}>Endpoint 2 (End)</Text>
        <View style={styles.rowTwo}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>X2 (ft)</Text>
            <TextInput
              key={`wall-x2-${wall?.id}-${wall?.x2}`}
              style={styles.textInput}
              defaultValue={String(wall?.x2 ?? 0)}
              onBlur={(e) => handleWallField('x2', parseFloat(e.nativeEvent.text) || 0)}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Y2 (ft)</Text>
            <TextInput
              key={`wall-y2-${wall?.id}-${wall?.y2}`}
              style={styles.textInput}
              defaultValue={String(wall?.y2 ?? 0)}
              onBlur={(e) => handleWallField('y2', parseFloat(e.nativeEvent.text) || 0)}
            />
          </View>
        </View>

        {/* Split Wall Tool */}
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleSplitWall}>
          <Ionicons name="cut-outline" size={14} color="#2563EB" />
          <Text style={styles.secondaryBtnText}>Split Wall into Two Segments</Text>
        </TouchableOpacity>

        {/* Action Buttons */}
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleDuplicate}>
            <Ionicons name="copy-outline" size={14} color="#334155" />
            <Text style={styles.actionBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={14} color="#DC2626" />
            <Text style={[styles.actionBtnText, { color: '#DC2626' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER DOOR INSPECTOR
  // ---------------------------------------------------------
  const renderDoorInspector = (door) => {
    const handleDoorField = (field, val) => {
      const nextDoors = layout.doors.map(d => d.id === door.id ? { ...d, [field]: val } : d);
      const nextLayout = { ...layout, doors: nextDoors };
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'door', data: { ...door, [field]: val } });
    };

    return (
      <View key={`inspector-door-${door?.id || 'door'}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="enter" size={18} color="#B45309" />
          <Text style={styles.elemTitle}>Door Properties</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Door Width ({unit})</Text>
          <TextInput
            key={`door-w-${door?.id}-${door?.width}-${unit}`}
            style={styles.textInput}
            defaultValue={formatMeasurement(door?.width ?? 3, unit)}
            onBlur={(e) => {
              const feet = parseToFeet(e.nativeEvent.text, unit);
              if (feet) handleDoorField('width', feet);
            }}
          />
        </View>

        {/* Door Type */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Door Type</Text>
          <View style={styles.rowTwo}>
            <TouchableOpacity
              style={[styles.typeBtn, door.type === 'single' && styles.typeBtnActive]}
              onPress={() => handleDoorField('type', 'single')}
            >
              <Text style={[styles.typeBtnText, door.type === 'single' && styles.typeBtnTextActive]}>Single Leaf</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, door.type === 'double' && styles.typeBtnActive]}
              onPress={() => handleDoorField('type', 'double')}
            >
              <Text style={[styles.typeBtnText, door.type === 'double' && styles.typeBtnTextActive]}>Double Leaf</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hinge & Swing Controls */}
        <View style={styles.rowTwo}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => handleDoorField('hinge', door.hinge === 'left' ? 'right' : 'left')}
          >
            <Ionicons name="swap-horizontal-outline" size={14} color="#2563EB" />
            <Text style={styles.secondaryBtnText}>Flip Hinge ({door.hinge})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => handleDoorField('swing', door.swing === 'inward' ? 'outward' : 'inward')}
          >
            <Ionicons name="swap-vertical-outline" size={14} color="#2563EB" />
            <Text style={styles.secondaryBtnText}>Flip Swing ({door.swing})</Text>
          </TouchableOpacity>
        </View>

        {/* Rotation */}
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => handleDoorField('rotation', ((door.rotation || 0) + 90) % 360)}
        >
          <Ionicons name="refresh-outline" size={14} color="#2563EB" />
          <Text style={styles.secondaryBtnText}>Rotate 90° ({door.rotation || 0}°)</Text>
        </TouchableOpacity>

        {/* Action Buttons */}
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleDuplicate}>
            <Ionicons name="copy-outline" size={14} color="#334155" />
            <Text style={styles.actionBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={14} color="#DC2626" />
            <Text style={[styles.actionBtnText, { color: '#DC2626' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ---------------------------------------------------------
  // RENDER WINDOW INSPECTOR
  // ---------------------------------------------------------
  const renderWindowInspector = (win) => {
    const handleWinField = (field, val) => {
      const nextWins = layout.windows.map(w => w.id === win.id ? { ...w, [field]: val } : w);
      const nextLayout = { ...layout, windows: nextWins };
      updateLayoutAndRecord(nextLayout);
      onSelectElement({ type: 'window', data: { ...win, [field]: val } });
    };

    return (
      <View key={`inspector-win-${win?.id || 'win'}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="browsers" size={18} color="#0284C7" />
          <Text style={styles.elemTitle}>Window Properties</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Window Width ({unit})</Text>
          <TextInput
            key={`win-w-${win?.id}-${win?.width}-${unit}`}
            style={styles.textInput}
            defaultValue={formatMeasurement(win?.width ?? 4, unit)}
            onBlur={(e) => {
              const feet = parseToFeet(e.nativeEvent.text, unit);
              if (feet) handleWinField('width', feet);
            }}
          />
        </View>

        {/* Window Type */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Window Style</Text>
          <View style={styles.rowTwo}>
            <TouchableOpacity
              style={[styles.typeBtn, win.type === 'standard' && styles.typeBtnActive]}
              onPress={() => handleWinField('type', 'standard')}
            >
              <Text style={[styles.typeBtnText, win.type === 'standard' && styles.typeBtnTextActive]}>Standard Glass</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, win.type === 'ventilator' && styles.typeBtnActive]}
              onPress={() => handleWinField('type', 'ventilator')}
            >
              <Text style={[styles.typeBtnText, win.type === 'ventilator' && styles.typeBtnTextActive]}>Ventilator (V)</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sunshade Chajja Toggle */}
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => handleWinField('chajja', !win.chajja)}
        >
          <Ionicons name={win.chajja ? "checkbox" : "square-outline"} size={16} color="#2563EB" />
          <Text style={styles.secondaryBtnText}>Sunshade (Chajja) Projection</Text>
        </TouchableOpacity>

        {/* Rotation */}
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => handleWinField('rotation', ((win.rotation || 0) + 90) % 360)}
        >
          <Ionicons name="refresh-outline" size={14} color="#2563EB" />
          <Text style={styles.secondaryBtnText}>Rotate 90° ({win.rotation || 0}°)</Text>
        </TouchableOpacity>

        {/* Action Buttons */}
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleDuplicate}>
            <Ionicons name="copy-outline" size={14} color="#334155" />
            <Text style={styles.actionBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={14} color="#DC2626" />
            <Text style={[styles.actionBtnText, { color: '#DC2626' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
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
        <TextInput
          key={`st-${field}-${stair.id}-${stair[field]}-${unit}`}
          style={styles.textInput}
          editable={!stair.isLocked}
          defaultValue={formatMeasurement(stair[field] ?? 0, unit)}
          onBlur={(e) => {
            const f = parseToFeet(e.nativeEvent.text, unit);
            if (f !== null && f >= minFeet && Math.abs(f - (stair[field] || 0)) > 1e-4) applyStair({ [field]: f }, field);
          }}
        />
      </View>
    );

    return (
      <View key={`inspector-stair-${stair.id}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="trending-up" size={18} color="#2563EB" />
          <Text style={styles.elemTitle}>Staircase Properties</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Label</Text>
          <TextInput
            key={`st-label-${stair.id}`}
            style={styles.textInput}
            defaultValue={stair.label || ''}
            onBlur={(e) => applyStair({ label: e.nativeEvent.text })}
          />
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
          (v) => applyStair({ stairType: v, wellGap: undefined, landingDepth: undefined }, 'stairType'),
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
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Risers</Text>
            <TextInput
              key={`st-risers-${stair.id}-${stair.risers}`}
              style={styles.textInput}
              editable={!stair.isLocked}
              keyboardType="numeric"
              defaultValue={String(stair.risers)}
              onBlur={(e) => {
                const n = parseInt(e.nativeEvent.text, 10);
                if (Number.isFinite(n) && n !== stair.risers) applyStair({ risers: n }, 'risers');
              }}
            />
          </View>
        </View>
        <View style={styles.rowTwo}>
          {lengthInput('treadDepth', 'Tread depth', 0.25)}
          {stair.stairType === STAIRCASE_TYPES.L_SHAPED
            ? lengthInput('flightWidth', 'Flight width', 2)
            : stair.stairType === STAIRCASE_TYPES.STRAIGHT
              ? <View style={{ flex: 1 }} />
              : lengthInput('landingDepth', 'Landing depth', 2)}
        </View>
        {(stair.stairType === STAIRCASE_TYPES.DOG_LEGGED || stair.stairType === STAIRCASE_TYPES.U_SHAPED) && (
          <View style={styles.rowTwo}>
            {lengthInput('wellGap', 'Well / mid-wall gap', 0)}
            <View style={{ flex: 1 }} />
          </View>
        )}

        <Text style={styles.inputLabel}>Direction</Text>
        {renderChoice(
          [{ value: 'up', label: 'UP' }, { value: 'down', label: 'DN' }],
          stair.direction || 'up',
          (v) => applyStair({ direction: v }),
          `st-dir-${stair.id}`
        )}

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

        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleDuplicate}>
            <Ionicons name="copy-outline" size={14} color="#334155" />
            <Text style={styles.actionBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleToggleLock}>
            <Ionicons name={stair.isLocked ? 'lock-closed' : 'lock-open-outline'} size={14} color="#334155" />
            <Text style={styles.actionBtnText}>{stair.isLocked ? 'Unlock' : 'Lock'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={14} color="#DC2626" />
            <Text style={[styles.actionBtnText, { color: '#DC2626' }]}>Delete</Text>
          </TouchableOpacity>
        </View>
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

    const handleSetback = (key, text) => {
      const feet = parseToFeet(text, unit);
      if (feet === null || feet < 0 || !onRequestSiteChange) return;
      if (Math.abs(feet - (Number(layout.plot?.setbacks?.[key]) || 0)) < 1e-4) return;
      onRequestSiteChange({ setbacks: { [key]: Number(feet.toFixed(4)) } });
    };

    const handlePlotDim = (field, text) => {
      const feet = parseToFeet(text, unit);
      if (feet && feet > 0) {
        if (onRequestPlotResize) {
          onRequestPlotResize(field, feet, { edge: field === 'width' ? resizeAnchorX : resizeAnchorY });
        } else {
          const nextLayout = {
            ...layout,
            plot: {
              ...layout.plot,
              [field]: feet,
            },
          };
          updateLayoutAndRecord(nextLayout);
        }
      }
    };

    return (
      <View key="inspector-plot" style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="map" size={18} color="#D97706" />
          <Text style={styles.elemTitle}>Plot & Building Parameters</Text>
        </View>

        {/* Plot Dimensions */}
        <View style={styles.rowTwo}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Plot Width ({unit})</Text>
            <TextInput
              key={`plot-w-${plotW}-${unit}`}
              style={styles.textInput}
              defaultValue={formatMeasurement(plotW, unit)}
              onBlur={(e) => handlePlotDim('width', e.nativeEvent.text)}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Plot Length ({unit})</Text>
            <TextInput
              key={`plot-l-${plotL}-${unit}`}
              style={styles.textInput}
              defaultValue={formatMeasurement(plotL, unit)}
              onBlur={(e) => handlePlotDim('length', e.nativeEvent.text)}
            />
          </View>
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
        <Text style={styles.hintText}>On the canvas, drag the orange edge handles; hold Shift to resize symmetrically.</Text>

        {/* Setbacks (editable - the building reflows to the new buildable area) */}
        <Text style={styles.subHeading}>Setbacks</Text>
        <View style={styles.rowTwo}>
          {['north', 'south'].map((k) => (
            <View key={`sb-${k}`} style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>{k === 'north' ? 'North (front/top)' : 'South (bottom)'}</Text>
              <TextInput
                key={`sb-${k}-${layout.plot?.setbacks?.[k]}-${unit}`}
                style={styles.textInput}
                defaultValue={formatMeasurement(layout.plot?.setbacks?.[k] ?? 0, unit)}
                onBlur={(e) => handleSetback(k, e.nativeEvent.text)}
              />
            </View>
          ))}
        </View>
        <View style={styles.rowTwo}>
          {['west', 'east'].map((k) => (
            <View key={`sb-${k}`} style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>{k === 'west' ? 'West (left)' : 'East (right)'}</Text>
              <TextInput
                key={`sb-${k}-${layout.plot?.setbacks?.[k]}-${unit}`}
                style={styles.textInput}
                defaultValue={formatMeasurement(layout.plot?.setbacks?.[k] ?? 0, unit)}
                onBlur={(e) => handleSetback(k, e.nativeEvent.text)}
              />
            </View>
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
          <TextInput
            key={`compass-${layout.plot?.compassAngle}`}
            style={styles.textInput}
            defaultValue={String(layout.plot?.compassAngle ?? 0)}
            keyboardType="numeric"
            onBlur={(e) => {
              const v = parseFloat(e.nativeEvent.text);
              if (Number.isFinite(v)) updateLayoutAndRecord({ ...layout, plot: { ...layout.plot, compassAngle: ((v % 360) + 360) % 360 } });
            }}
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

    const handleValue = (text) => {
      const feet = parseToFeet(text, unit);
      if (feet && feet > 0) {
        if (onRequestPlotResize) onRequestPlotResize(axis, feet);
        else {
          const nextLayout = { ...layout, plot: { ...layout.plot, [axis]: feet } };
          updateLayoutAndRecord(nextLayout);
        }
      }
    };

    const handleOffset = (text) => {
      const off = parseToFeet(text, unit);
      if (off && off > 0) {
        const nextLayout = setPlotDimensionOffset({ ...layout }, axis, off);
        updateLayoutAndRecord(nextLayout);
      }
    };

    return (
      <View key={`inspector-dim-${axis}`} style={styles.inspectorContent}>
        <View style={styles.elemHeader}>
          <Ionicons name="resize" size={18} color="#2563EB" />
          <Text style={styles.elemTitle}>{label} Dimension</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{label} ({unit})</Text>
          <TextInput
            key={`dim-val-${axis}-${meta.value}-${unit}`}
            style={styles.textInput}
            defaultValue={formatMeasurement(meta.value, unit)}
            onBlur={(e) => handleValue(e.nativeEvent.text)}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Annotation Offset ({unit})</Text>
          <TextInput
            key={`dim-off-${axis}-${meta.offset}-${unit}`}
            style={styles.textInput}
            defaultValue={formatMeasurement(meta.offset, unit)}
            onBlur={(e) => handleOffset(e.nativeEvent.text)}
          />
        </View>

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
                    if (issue.elementType === 'room') {
                      const r = layout.rooms?.find(rm => rm.id === issue.elementId);
                      if (r) onSelectElement({ type: 'room', data: r });
                    } else if (issue.elementType === 'wall') {
                      const w = layout.walls?.find(wl => wl.id === issue.elementId);
                      if (w) onSelectElement({ type: 'wall', data: w });
                    } else if (issue.elementType === 'door') {
                      const d = layout.doors?.find(dr => dr.id === issue.elementId);
                      if (d) onSelectElement({ type: 'door', data: d });
                    }
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
          ) : selectedElement.type === 'door' ? (
            renderDoorInspector(selectedElement.data)
          ) : selectedElement.type === 'window' ? (
            renderWindowInspector(selectedElement.data)
          ) : selectedElement.type === 'dimension' ? (
            renderDimensionInspector(selectedElement.data)
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
