/**
 * AutoPlot Layout Editor - Left Sidebar (Tools Palette & Component Library)
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createRoom,
  createDoor,
  createWindow,
  createStaircase,
  createColumn,
  createParking,
  createUtility,
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
];

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
}) {
  const [tab, setTab] = useState('tools'); // 'tools' | 'library'

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
    const nextLayout = {
      ...layout,
      rooms: [...(layout.rooms || []), newRoom],
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
        newElem = createDoor({ x: cx, y: cy, ...params });
        nextLayout.doors = [...(layout.doors || []), newElem];
        break;
      case 'window':
        newElem = createWindow({ x: cx, y: cy, ...params });
        nextLayout.windows = [...(layout.windows || []), newElem];
        break;
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
            {TOOLS.map((tool) => {
              const isActive = activeTool === tool.id;
              return (
                <TouchableOpacity
                  key={tool.id}
                  style={[styles.toolItem, isActive && styles.toolItemActive]}
                  onPress={() => onSelectTool(tool.id)}
                >
                  <Ionicons
                    name={tool.ion}
                    size={17}
                    color={isActive ? "#2563EB" : "#334155"}
                  />
                  <Text style={[styles.toolItemText, isActive && styles.toolItemTextActive]}>
                    {tool.name}
                  </Text>
                  <Text style={styles.toolShortcut}>{tool.shortcut}</Text>
                </TouchableOpacity>
              );
            })}
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
