/**
 * AutoPlot Layout Editor - Horizontal Tool Strip (Tools Palette & Component Library)
 * Sits under the top toolbar. Its option boxes float over the canvas, so opening
 * them never resizes the plot.
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
  getPlotRect,
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

const ELEMENTS = [
  { label: "Single Door (3')", ion: 'enter-outline', color: '#B45309', type: 'door', params: { width: 3.0, type: 'single' } },
  { label: "Main Door (4')", ion: 'enter', color: '#B45309', type: 'door', params: { width: 4.0, type: 'double', isMain: true } },
  { label: "Window (4')", ion: 'browsers-outline', color: '#0284C7', type: 'window', params: { width: 4.0, type: 'standard' } },
  { label: "Ventilator (2')", ion: 'grid', color: '#64748B', type: 'window', params: { width: 2.0, type: 'ventilator', isBathroom: true } },
  { label: 'Dog-Legged Stairs', ion: 'layers-outline', color: '#334155', type: 'staircase', params: { width: 6.0, length: 9.0 } },
  { label: 'Column Pillar (9")', ion: 'cube-outline', color: '#334155', type: 'column', params: { size: 0.75 } },
  { label: "Car Parking (9'×16')", ion: 'car-outline', color: '#059669', type: 'parking', params: { width: 9.0, length: 16.0 } },
  { label: 'Water Sump', ion: 'water-outline', color: '#0284C7', type: 'utility', params: { type: 'sump', name: 'Water Sump', width: 4.0, length: 3.5 } },
  { label: 'Borewell Point', ion: 'ellipse-outline', color: '#0284C7', type: 'utility', params: { type: 'bore', name: 'Borewell', width: 2.5, length: 2.5 } },
  { label: 'Septic Tank', ion: 'construct-outline', color: '#475569', type: 'utility', params: { type: 'septic', name: 'Septic Tank', width: 4.5, length: 3.5 } },
];

// React Native Web drops the `title` prop, so the hover tooltip is set on the DOM node.
const tooltip = (label) => (node) => {
  if (node?.setAttribute) node.setAttribute('title', label);
};

export default function EditorToolStrip({
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
  propertiesOpen = false,
  onToggleProperties,
}) {
  const [popover, setPopover] = useState(null); // null | 'library' | 'array'
  const togglePopover = (name) => setPopover(popover === name ? null : name);

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
    if (activeTool === 'select') return null;
    const tool = [...TOOLS, ...MODIFY_TOOLS].find((t) => t.id === activeTool);
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
    return (
      <View style={styles.optionsBox}>
        {!!tool && <Text style={styles.optionsTitle}>{tool.name}</Text>}
        {fields}
        {!!prompt && <Text style={styles.promptText}>{prompt}</Text>}
      </View>
    );
  };

  const renderIconButton = ({ key, label, ion, active = false, onPress }) => (
    <TouchableOpacity
      key={key}
      ref={tooltip(label)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.iconBtn, active && styles.iconBtnActive]}
      onPress={onPress}
    >
      <Ionicons name={ion} size={16} color={active ? '#2563EB' : '#334155'} />
    </TouchableOpacity>
  );

  const renderToolItem = (tool) => renderIconButton({
    key: tool.id,
    label: tool.shortcut ? `${tool.name} (${tool.shortcut})` : tool.name,
    ion: tool.ion,
    active: activeTool === tool.id,
    onPress: () => onSelectTool(tool.id),
  });

  const renderTextButton = (label, ion, active, onPress, extraStyle) => (
    <TouchableOpacity
      style={[styles.textBtn, active && styles.iconBtnActive, extraStyle]}
      onPress={onPress}
    >
      <Ionicons name={ion} size={15} color={active ? '#2563EB' : '#334155'} />
      <Text style={[styles.textBtnLabel, active && styles.textBtnLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const handleAddRoomTemplate = (tmpl) => {
    const site = getPlotRect(layout);
    const newRoom = createRoom({
      name: tmpl.name,
      width: tmpl.width,
      length: tmpl.length,
      color: tmpl.color,
      x: site.x0 + Math.max(2, (site.width - tmpl.width) / 2),
      y: site.y0 + Math.max(2, (site.length - tmpl.length) / 2),
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
    setPopover(null);
  };

  const handleAddComponent = (type, params = {}) => {
    const site = getPlotRect(layout);
    const cx = site.x0 + site.width / 2;
    const cy = site.y0 + site.length / 2;

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
      setPopover(null);
    }
  };

  return (
    <View style={styles.strip}>
      {renderTextButton('Library', 'library-outline', popover === 'library', () => togglePopover('library'))}

      <View style={styles.divider} />
      {TOOLS.map(renderToolItem)}

      <View style={styles.divider} />
      {MODIFY_TOOLS.map(renderToolItem)}

      <View style={styles.divider} />
      {renderIconButton({ key: 'duplicate', label: 'Duplicate (Ctrl+D)', ion: 'duplicate-outline', onPress: onDuplicate })}
      {renderIconButton({ key: 'join', label: 'Join Selected', ion: 'link-outline', onPress: onJoin })}
      {renderIconButton({ key: 'delete-selected', label: 'Delete Selected (Del)', ion: 'trash-bin-outline', onPress: onDeleteSelection })}
      {renderIconButton({ key: 'array', label: 'Rectangular Array', ion: 'grid-outline', active: popover === 'array', onPress: () => togglePopover('array') })}

      {renderTextButton('Properties', 'options-outline', propertiesOpen, onToggleProperties, styles.propertiesBtn)}

      {/* Floating boxes: positioned over the canvas so the plot keeps its size */}
      {popover === null && !!renderToolOptions() && (
        <View style={styles.floating}>{renderToolOptions()}</View>
      )}

      {popover === 'array' && (
        <View style={styles.floating}>
          <View style={styles.optionsBox}>
            <Text style={styles.optionsTitle}>Rectangular Array</Text>
            {numParam('rows', 'Rows', { integer: true, min: 1, max: 50 })}
            {numParam('cols', 'Columns', { integer: true, min: 1, max: 50 })}
            {lenParam('dx', 'Col. spacing')}
            {lenParam('dy', 'Row spacing')}
            {renderTextButton('Apply to Selection', 'grid-outline', false, onRectangularArray)}
          </View>
        </View>
      )}

      {popover === 'library' && (
        <View style={[styles.floating, styles.libraryPopover]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionHeading}>ROOM TEMPLATES</Text>
            <View style={styles.cardGrid}>
              {ROOM_TEMPLATES.map((tmpl) => (
                <TouchableOpacity
                  key={tmpl.name}
                  style={[styles.templateCard, { borderLeftColor: tmpl.color === '#F8FAFC' ? '#64748B' : '#0284C7' }]}
                  onPress={() => handleAddRoomTemplate(tmpl)}
                >
                  <Text style={styles.templateName}>{tmpl.name}</Text>
                  <Text style={styles.templateDim}>{tmpl.width}' × {tmpl.length}'</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionHeading, { marginTop: 14 }]}>ARCHITECTURAL ELEMENTS</Text>
            <View style={styles.cardGrid}>
              {ELEMENTS.map((el) => (
                <TouchableOpacity
                  key={el.label}
                  style={styles.compCard}
                  onPress={() => handleAddComponent(el.type, el.params)}
                >
                  <Ionicons name={el.ion} size={16} color={el.color} />
                  <Text style={styles.compName}>{el.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1.2,
    borderBottomColor: '#CBD5E1',
    zIndex: 45,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 4,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  textBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  textBtnLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  textBtnLabelActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  propertiesBtn: {
    marginLeft: 'auto',
  },
  floating: {
    position: 'absolute',
    top: '100%',
    left: 32,
    marginTop: 28,
    maxWidth: 340,
  },
  libraryPopover: {
    width: 460,
    maxWidth: 460,
    maxHeight: 500,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  optionsBox: {
    padding: 8,
    gap: 6,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  optionsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
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
  sectionHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  templateCard: {
    width: 212,
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
  compCard: {
    width: 212,
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
