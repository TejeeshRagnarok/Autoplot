/**
 * AutoPlot Layout Editor - Left Sidebar (Tools Palette & Component Library)
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MeasureInput, NumberInput, TextField } from './DraftInput';
import { placeOpeningOnWall } from './wallOps';
import {
  createRoom,
  createDoor,
  createWindow,
  createStaircase,
  createColumn,
  createParking,
  createUtility,
  createRoomBoundaryWalls,
} from './layoutModel';

export const TOOLS = [
  { id: 'select', name: 'Select / Move', icon: 'arrow-top-left-thin', shortcut: 'V', ion: 'navigate-outline' },
  { id: 'pan', name: 'Pan View', icon: 'hand-right', shortcut: 'H', ion: 'hand-right-outline' },
  { id: 'wall', name: 'Draw Wall', icon: 'remove', shortcut: 'W', ion: 'pencil-outline' },
  { id: 'room', name: 'Add Room', icon: 'square', shortcut: 'R', ion: 'crop-outline' },
  { id: 'door', name: 'Add Door', icon: 'enter', shortcut: 'D', ion: 'enter-outline' },
  { id: 'window', name: 'Add Window', icon: 'browsers', shortcut: 'N', ion: 'browsers-outline' },
  { id: 'staircase', name: 'Add Staircase', icon: 'layers', shortcut: 'S', ion: 'layers-outline' },
  { id: 'column', name: 'Add Column', icon: 'cube', shortcut: 'C', ion: 'cube-outline' },
  { id: 'measure', name: 'Measure Distance', icon: 'resize', shortcut: 'M', ion: 'resize-outline' },
  { id: 'line', name: 'Line', shortcut: 'L', ion: 'remove-outline' },
  { id: 'polyline', name: 'Polyline', shortcut: 'P', ion: 'git-commit-outline' },
  { id: 'rectangle', name: 'Rectangle', ion: 'square-outline' },
  { id: 'circle', name: 'Circle', ion: 'ellipse-outline' },
  { id: 'arc', name: 'Arc', ion: 'radio-button-off-outline' },
  { id: 'polygon', name: 'Polygon', ion: 'shapes-outline' },
  { id: 'parking', name: 'Parking', ion: 'car-outline' },
  { id: 'text', name: 'Text', shortcut: 'T', ion: 'text-outline' },
  { id: 'dimension', name: 'Dimension', ion: 'analytics-outline' },
];

export const MODIFY_TOOLS = [
  { id: 'move', name: 'Move', ion: 'move-outline' },
  { id: 'copy', name: 'Copy', ion: 'copy-outline' },
  { id: 'rotate', name: 'Rotate', ion: 'refresh-outline' },
  { id: 'mirror', name: 'Mirror', ion: 'swap-horizontal-outline' },
  { id: 'scale', name: 'Scale', ion: 'expand-outline' },
  { id: 'offset', name: 'Offset', ion: 'albums-outline' },
  { id: 'trim', name: 'Trim', ion: 'cut-outline' },
  { id: 'extend', name: 'Extend', ion: 'arrow-forward-outline' },
  { id: 'fillet', name: 'Fillet', ion: 'return-down-forward-outline' },
  { id: 'chamfer', name: 'Chamfer', ion: 'trending-down-outline' },
  { id: 'stretch', name: 'Stretch', ion: 'resize-outline' },
  { id: 'break', name: 'Break', ion: 'unlink-outline' },
  { id: 'polar-array', name: 'Polar Array', ion: 'sync-outline' },
  { id: 'delete', name: 'Delete (click object)', ion: 'trash-outline' },
];

// What the active tool expects next, shown under its parameters.
const TOOL_PROMPTS = {
  wall: 'Click the start, then the end. Walls stay horizontal or vertical unless Diagonal Walls is on in the toolbar.',
  line: 'Click the start, then the end.',
  polyline: 'Click each point. Double-click or press Enter to finish.',
  rectangle: 'Click two opposite corners.',
  circle: 'Click the center, then a point on the circle.',
  arc: 'Click the start, a point on the arc, then the end.',
  polygon: 'Click the center, then a vertex.',
  text: 'Click where the text goes. Edit it in the Properties panel.',
  dimension: 'Click the two points to measure.',
  door: 'Click on a wall.',
  window: 'Click on a wall.',
  move: 'With objects selected: click a base point, then its destination.',
  copy: 'With objects selected: click a base point, then where the copy goes.',
  rotate: 'With objects selected: click the rotation center.',
  mirror: 'With objects selected: click two points on the mirror line.',
  scale: 'With objects selected: click the base point.',
  offset: 'Click the object, then the side to offset to.',
  trim: 'Click the piece to remove. Other walls and lines are the cutting edges.',
  extend: 'Click near the end to extend to the next wall or line.',
  fillet: 'Click two walls or lines. Radius 0 makes a sharp corner (the only option for walls).',
  chamfer: 'Click two walls or lines.',
  stretch: 'Drag a window around the points to move, then click a base point and destination.',
  break: 'Click the object where it should break.',
  'polar-array': 'With objects selected: click the center of the array.',
  delete: 'Click the object to delete.',
};

const ROOM_TEMPLATES = [
  { name: 'Master Bedroom', width: 14, length: 12, color: '#EFF6FF' },
  { name: 'Bedroom', width: 12, length: 10, color: '#EFF6FF' },
  { name: 'Kitchen', width: 10, length: 8, color: '#FFFBEB' },
  { name: 'Pooja Room', width: 6, length: 6, color: '#FEF3C7' },
  { name: 'Living Room', width: 16, length: 14, color: '#F0FDF4' },
  { name: 'Dining Room', width: 11, length: 10, color: '#F8FAFC' },
  { name: 'Bathroom/Toilet', width: 7, length: 5, color: '#F1F5F9' },
  { name: 'Study Room', width: 10, length: 8, color: '#F5F3FF' },
  { name: 'Store Room', width: 6, length: 6, color: '#FFF7ED' },
  { name: 'Balcony / Verandah', width: 12, length: 4, color: '#ECFDF5' },
];

export default function EditorLeftSidebar({
  activeTool,
  onSelectTool,
  layout,
  onUpdateLayout,
  onSelectElement,
  historyManager,
  toolParams = {},
  onChangeToolParams,
  unit = 'ft-in',
  onDuplicate,
  onJoin,
  onRectangularArray,
  onDeleteSelection,
  onNotice,
}) {
  const [tab, setTab] = useState('tools'); // 'tools' | 'library'

  const setParam = (key, value) => onChangeToolParams && onChangeToolParams({ ...toolParams, [key]: value });
  const numParam = (key, label, opts = {}) => (
    <View style={styles.paramRow} key={key}>
      <Text style={styles.paramLabel}>{label}</Text>
      <NumberInput style={styles.paramInput} value={toolParams[key]} onCommit={(v) => setParam(key, v)} {...opts} />
    </View>
  );
  const lenParam = (key, label, opts = {}) => (
    <View style={styles.paramRow} key={key}>
      <Text style={styles.paramLabel}>{label}</Text>
      <MeasureInput style={styles.paramInput} value={toolParams[key]} unit={unit} onCommit={(v) => setParam(key, v)} {...opts} />
    </View>
  );

  const renderToolOptions = () => {
    const fields = {
      polygon: [numParam('sides', 'Sides', { integer: true, min: 3, max: 64 })],
      text: [(
        <View style={styles.paramRow} key="text">
          <Text style={styles.paramLabel}>Text</Text>
          <TextField style={styles.paramInput} value={toolParams.text} onCommit={(v) => setParam('text', v)} />
        </View>
      )],
      rotate: [numParam('angle', 'Angle (°)')],
      scale: [numParam('factor', 'Factor', { min: 0.01, max: 100 })],
      offset: [lenParam('offset', 'Distance', { min: 0.01 })],
      fillet: [lenParam('radius', 'Radius', { min: 0 })],
      chamfer: [lenParam('chamferA', 'First dist.', { min: 0.01 }), lenParam('chamferB', 'Second dist.', { min: 0.01 })],
      break: [lenParam('gap', 'Gap', { min: 0 })],
      'polar-array': [numParam('count', 'Items', { integer: true, min: 2, max: 72 }), numParam('polarAngle', 'Total angle (°)')],
    }[activeTool];
    const prompt = TOOL_PROMPTS[activeTool];
    if (!fields && !prompt) return null;
    return (
      <View style={styles.optionsBox}>
        {fields}
        {!!prompt && <Text style={styles.promptText}>{prompt}</Text>}
      </View>
    );
  };

  const renderToolItem = (tool) => {
    const isActive = activeTool === tool.id;
    return (
      <TouchableOpacity
        key={tool.id}
        style={[styles.toolItem, isActive && styles.toolItemActive]}
        onPress={() => onSelectTool(tool.id)}
      >
        <Ionicons name={tool.ion} size={17} color={isActive ? "#2563EB" : "#334155"} />
        <Text style={[styles.toolItemText, isActive && styles.toolItemTextActive]}>{tool.name}</Text>
        {!!tool.shortcut && <Text style={styles.toolShortcut}>{tool.shortcut}</Text>}
      </TouchableOpacity>
    );
  };

  const renderAction = (label, ion, onPress) => (
    <TouchableOpacity key={label} style={styles.toolItem} onPress={onPress}>
      <Ionicons name={ion} size={17} color="#334155" />
      <Text style={styles.toolItemText}>{label}</Text>
    </TouchableOpacity>
  );

  const handleAddRoomTemplate = (tmpl) => {
    const plotW = layout.plot?.width || 30;
    const plotL = layout.plot?.length || 40;
    const newRoom = createRoom({
      name: tmpl.name,
      width: tmpl.width,
      length: tmpl.length,
      color: tmpl.color,
      x: Math.max(2, (plotW - tmpl.width) / 2),
      y: Math.max(2, (plotL - tmpl.length) / 2),
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
  };

  const handleAddComponent = (type, params = {}) => {
    const plotW = layout.plot?.width || 30;
    const plotL = layout.plot?.length || 40;
    const cx = plotW / 2;
    const cy = plotL / 2;

    let newElem = null;
    let elemType = type;
    const nextLayout = { ...layout };

    switch (type) {
      case 'door':
      case 'window': {
        // Openings only exist on walls: use the wall nearest the middle of the plot.
        const proto = type === 'door' ? createDoor(params) : createWindow(params);
        const place = placeOpeningOnWall(layout, proto, { x: cx, y: cy }, { maxDist: Infinity });
        if (!place) {
          if (onNotice) onNotice(`No wall has enough free length for this ${type}.`);
          return;
        }
        newElem = { ...proto, ...place };
        const key = type === 'door' ? 'doors' : 'windows';
        nextLayout[key] = [...(layout[key] || []), newElem];
        break;
      }
      case 'staircase':
        newElem = createStaircase({ x: cx, y: cy, ...params });
        nextLayout.staircases = [...(layout.staircases || []), newElem];
        break;
      case 'column':
        newElem = createColumn({ x: cx, y: cy, ...params });
        nextLayout.columns = [...(layout.columns || []), newElem];
        break;
      case 'parking':
        newElem = createParking({ x: cx, y: cy, ...params });
        nextLayout.parking = [...(layout.parking || []), newElem];
        break;
      case 'utility':
        newElem = createUtility({ x: cx, y: cy, ...params });
        nextLayout.utilities = [...(layout.utilities || []), newElem];
        break;
      default:
        break;
    }

    if (newElem) {
      historyManager.pushState(nextLayout);
      onUpdateLayout(nextLayout);
      onSelectElement({ type: elemType, data: newElem });
    }
  };

  return (
    <View style={styles.sidebar}>
      {/* Tabs */}
      <View style={styles.tabHeader}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'tools' && styles.tabBtnActive]}
          onPress={() => setTab('tools')}
        >
          <Text style={[styles.tabBtnText, tab === 'tools' && styles.tabBtnTextActive]}>Tools</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'library' && styles.tabBtnActive]}
          onPress={() => setTab('library')}
        >
          <Text style={[styles.tabBtnText, tab === 'library' && styles.tabBtnTextActive]}>Library</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'tools' ? (
          <View style={styles.toolsList}>
            {renderToolOptions()}
            <Text style={styles.sectionHeading}>DRAW</Text>
            {TOOLS.map(renderToolItem)}
            <Text style={[styles.sectionHeading, { marginTop: 12 }]}>MODIFY</Text>
            {MODIFY_TOOLS.map(renderToolItem)}
            {renderAction('Duplicate (Ctrl+D)', 'duplicate-outline', onDuplicate)}
            {renderAction('Join Selected', 'link-outline', onJoin)}
            {renderAction('Delete Selected (Del)', 'trash-bin-outline', onDeleteSelection)}
            <Text style={[styles.sectionHeading, { marginTop: 12 }]}>RECTANGULAR ARRAY</Text>
            <View style={styles.optionsBox}>
              {numParam('rows', 'Rows', { integer: true, min: 1, max: 50 })}
              {numParam('cols', 'Columns', { integer: true, min: 1, max: 50 })}
              {lenParam('dx', 'Col. spacing')}
              {lenParam('dy', 'Row spacing')}
              {renderAction('Apply to Selection', 'grid-outline', onRectangularArray)}
            </View>
          </View>
        ) : (
          <View style={styles.libraryContainer}>
            {/* Quick Rooms */}
            <Text style={styles.sectionHeading}>ROOM TEMPLATES</Text>
            <View style={styles.templatesGrid}>
              {ROOM_TEMPLATES.map((tmpl, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.templateCard, { borderLeftColor: tmpl.color === '#F8FAFC' ? '#64748B' : '#0284C7' }]}
                  onPress={() => handleAddRoomTemplate(tmpl)}
                >
                  <Text style={styles.templateName}>{tmpl.name}</Text>
                  <Text style={styles.templateDim}>{tmpl.width}' × {tmpl.length}'</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Components */}
            <Text style={[styles.sectionHeading, { marginTop: 16 }]}>ARCHITECTURAL ELEMENTS</Text>
            <View style={styles.componentsGrid}>
              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('door', { width: 3.0, type: 'single' })}
              >
                <Ionicons name="enter-outline" size={16} color="#B45309" />
                <Text style={styles.compName}>Single Door (3')</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('door', { width: 4.0, type: 'double', isMain: true })}
              >
                <Ionicons name="enter" size={16} color="#B45309" />
                <Text style={styles.compName}>Main Door (4')</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('window', { width: 4.0, type: 'standard' })}
              >
                <Ionicons name="browsers-outline" size={16} color="#0284C7" />
                <Text style={styles.compName}>Window (4')</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('window', { width: 2.0, type: 'ventilator', isBathroom: true })}
              >
                <Ionicons name="grid" size={16} color="#64748B" />
                <Text style={styles.compName}>Ventilator (2')</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('staircase', { width: 6.0, length: 9.0 })}
              >
                <Ionicons name="layers-outline" size={16} color="#334155" />
                <Text style={styles.compName}>Dog-Legged Stairs</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('column', { size: 0.75 })}
              >
                <Ionicons name="cube-outline" size={16} color="#334155" />
                <Text style={styles.compName}>Column Pillar (9")</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('parking', { width: 9.0, length: 16.0 })}
              >
                <Ionicons name="car-outline" size={16} color="#059669" />
                <Text style={styles.compName}>Car Parking (9'×16')</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('utility', { type: 'sump', name: 'Water Sump', width: 4.0, length: 3.5 })}
              >
                <Ionicons name="water-outline" size={16} color="#0284C7" />
                <Text style={styles.compName}>Water Sump</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('utility', { type: 'bore', name: 'Borewell', width: 2.5, length: 2.5 })}
              >
                <Ionicons name="ellipse-outline" size={16} color="#0284C7" />
                <Text style={styles.compName}>Borewell Point</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.compCard}
                onPress={() => handleAddComponent('utility', { type: 'septic', name: 'Septic Tank', width: 4.5, length: 3.5 })}
              >
                <Ionicons name="construct-outline" size={16} color="#475569" />
                <Text style={styles.compName}>Septic Tank</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 210,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1.2,
    borderRightColor: '#CBD5E1',
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
  content: {
    flex: 1,
    padding: 10,
  },
  toolsList: {
    gap: 4,
    paddingBottom: 20,
  },
  optionsBox: {
    padding: 8,
    marginBottom: 6,
    gap: 6,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  paramRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paramLabel: {
    width: 68,
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  paramInput: {
    width: 92,
    height: 26,
    paddingHorizontal: 6,
    fontSize: 11,
    color: '#1E293B',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 4,
  },
  promptText: {
    fontSize: 10,
    lineHeight: 14,
    color: '#475569',
  },
  toolItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    gap: 10,
  },
  toolItemActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  toolItemText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  toolItemTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  toolShortcut: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  libraryContainer: {
    paddingBottom: 20,
  },
  sectionHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  templatesGrid: {
    gap: 6,
  },
  templateCard: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 3.5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  templateName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1E293B',
  },
  templateDim: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '500',
  },
  componentsGrid: {
    gap: 6,
  },
  compCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  compName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
});
