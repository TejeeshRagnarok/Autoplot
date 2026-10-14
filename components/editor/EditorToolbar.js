/**
 * AutoPlot Layout Editor - Top Toolbar Component
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SAVE_STATUS } from './projectStorage';

export default function EditorToolbar({
  layout,
  onSave,
  saveStatus = SAVE_STATUS.SAVED,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  showGrid,
  onToggleGrid,
  snapEnabled,
  onToggleSnap,
  showDimensions,
  onToggleDimensions,
  onFitScreen,
  allowDiagonal = false,
  onToggleDiagonal,
  validationIssues = [],
  onOpenValidation,
  onOpenExport,
  onResetLayout,
  onClose,
  theme,
}) {
  const errorCount = validationIssues.filter(i => i.severity === 'error').length;
  const warningCount = validationIssues.filter(i => i.severity === 'warning').length;

  const getSaveBadge = () => {
    switch (saveStatus) {
      case SAVE_STATUS.SAVING:
        return { text: 'Saving...', color: '#EAB308', icon: 'sync-outline' };
      case SAVE_STATUS.SAVED:
        return { text: 'Saved', color: '#10B981', icon: 'checkmark-circle-outline' };
      case SAVE_STATUS.FAILED:
        return { text: 'Save failed', color: '#EF4444', icon: 'alert-circle-outline' };
      case SAVE_STATUS.UNSAVED:
      default:
        return { text: 'Unsaved changes', color: '#F97316', icon: 'ellipse' };
    }
  };

  const badge = getSaveBadge();

  return (
    <View style={styles.toolbar}>
      {/* Left: Project title & Back */}
      <View style={styles.leftGroup}>
        <TouchableOpacity style={styles.iconBtn} onPress={onClose} title="Back to 2D Plan">
          <Ionicons name="arrow-back" size={18} color="#1E293B" />
        </TouchableOpacity>

        <View style={styles.titleBlock}>
          <Text style={styles.projectTitle} numberOfLines={1}>
            {layout?.title || 'AutoPlot Layout Editor'}
          </Text>
          <View style={styles.statusRow}>
            <Ionicons name={badge.icon} size={11} color={badge.color} />
            <Text style={[styles.statusText, { color: badge.color }]}>{badge.text}</Text>
          </View>
        </View>
      </View>

      {/* Center: Tools, Undo/Redo, View Toggles */}
      <View style={styles.centerGroup}>
        {/* Undo / Redo */}
        <TouchableOpacity
          style={[styles.toolBtn, !canUndo && styles.btnDisabled]}
          onPress={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Ionicons name="arrow-undo-outline" size={16} color={canUndo ? "#1E293B" : "#94A3B8"} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolBtn, !canRedo && styles.btnDisabled]}
          onPress={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          <Ionicons name="arrow-redo-outline" size={16} color={canRedo ? "#1E293B" : "#94A3B8"} />
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* View Options: Grid, Snap, Dimensions */}
        <TouchableOpacity
          style={[styles.toolBtn, showGrid && styles.btnActive]}
          onPress={onToggleGrid}
          title="Toggle Grid"
        >
          <Ionicons name="grid-outline" size={16} color={showGrid ? "#2563EB" : "#64748B"} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolBtn, snapEnabled && styles.btnActive]}
          onPress={onToggleSnap}
          title="Toggle Snap-to-Grid"
        >
          <Ionicons name="magnet-outline" size={16} color={snapEnabled ? "#2563EB" : "#64748B"} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolBtn, showDimensions && styles.btnActive]}
          onPress={onToggleDimensions}
          title="Toggle Dimensions"
        >
          <Ionicons name="text-outline" size={16} color={showDimensions ? "#2563EB" : "#64748B"} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolBtn, allowDiagonal && styles.btnActive]}
          onPress={onToggleDiagonal}
          title={allowDiagonal ? 'Diagonal Walls: ON' : 'Diagonal Walls: OFF (H/V locked)'}
        >
          <Ionicons name="analytics-outline" size={16} color={allowDiagonal ? "#2563EB" : "#64748B"} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={onFitScreen}
          title="Fit Drawing to Screen"
        >
          <Ionicons name="scan-outline" size={16} color="#64748B" />
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Validation Button with Badge */}
        <TouchableOpacity style={styles.validationBtn} onPress={onOpenValidation} title="Layout Validation">
          <Ionicons
            name={errorCount > 0 ? "alert-circle" : warningCount > 0 ? "warning" : "checkmark-circle"}
            size={16}
            color={errorCount > 0 ? "#DC2626" : warningCount > 0 ? "#D97706" : "#10B981"}
          />
          <Text style={[styles.validationText, { color: errorCount > 0 ? "#DC2626" : warningCount > 0 ? "#D97706" : "#10B981" }]}>
            {errorCount > 0 ? `${errorCount} Errors` : warningCount > 0 ? `${warningCount} Warnings` : 'Valid'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Right: Reset, Export, Save, Done */}
      <View style={styles.rightGroup}>
        <TouchableOpacity style={styles.textBtn} onPress={onResetLayout} title="Reset to Original Layout">
          <Ionicons name="refresh-outline" size={15} color="#64748B" />
          <Text style={styles.textBtnLabel}>Reset</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.exportBtn} onPress={onOpenExport}>
          <Ionicons name="download-outline" size={16} color="#1E293B" />
          <Text style={styles.exportBtnText}>Export</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveBtn} onPress={onSave}>
          <Ionicons name="save-outline" size={16} color="#FFFFFF" />
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    height: 52,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1.2,
    borderBottomColor: '#CBD5E1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    zIndex: 50,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 200,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleBlock: {
    justifyContent: 'center',
  },
  projectTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    maxWidth: 180,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  centerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 4,
  },
  validationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  validationText: {
    fontSize: 11,
    fontWeight: '700',
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  textBtnLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  exportBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#2563EB',
  },
  saveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  doneBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#0F172A',
  },
  doneBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
