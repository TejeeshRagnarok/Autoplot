/**
 * AutoPlot Complete 2D Architectural Layout Editor
 * Integrates Toolbar, Left Sidebar, 2D Canvas, Right Inspector, and Status Bar
 * with Undo/Redo, Autosave, Keyboard Shortcuts, Validation, and Exporting.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Modal, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import EditorToolbar from './EditorToolbar';
import EditorLeftSidebar from './EditorLeftSidebar';
import EditorCanvas from './EditorCanvas';
import EditorRightPanel from './EditorRightPanel';
import EditorStatusBar from './EditorStatusBar';
import { HistoryManager } from './historyManager';
import { validateLayout } from './layoutValidation';
import { saveProject, exportProjectJSON, SAVE_STATUS } from './projectStorage';
import { exportAsPNG, exportAsSVG, printLayoutPlan } from './exportUtils';
import { cloneLayout, resizePlot, findElementsOutsidePlot, getPlotDimensionMeta } from './layoutModel';
import { UNIT_TYPES } from './units';

export default function LayoutEditor({
  initialLayout,
  originalGeneratedLayout,
  onSaveAndClose,
  onClose,
  theme,
}) {
  // Main layout state
  const [layout, setLayout] = useState(() => cloneLayout(initialLayout));
  const [selectedElement, setSelectedElement] = useState(null);
  const [activeTool, setActiveTool] = useState('select');
  const [unit, setUnit] = useState(UNIT_TYPES.FT_IN);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [cursorWorldPos, setCursorWorldPos] = useState({ x: 0, y: 0 });
  const [saveStatus, setSaveStatus] = useState(SAVE_STATUS.SAVED);
  const [allowDiagonal, setAllowDiagonal] = useState(false);
  const [snapTolerance, setSnapTolerance] = useState(0.75);
  const [pendingResize, setPendingResize] = useState(null); // { axis, feet, outside: [] }

  // Modals state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [validationModalVisible, setValidationModalVisible] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);

  // Undo/Redo History Manager
  const historyRef = useRef(new HistoryManager(initialLayout));
  const history = historyRef.current;

  // Validation issues calculated in real-time
  const validationIssues = useMemo(() => {
    return validateLayout(layout);
  }, [layout]);

  // Keep selected element synchronized with updated layout data
  useEffect(() => {
    if (selectedElement) {
      const { type, data } = selectedElement;
      let freshData = null;
      if (type === 'room') {
        freshData = layout.rooms?.find(r => r.id === data.id);
      } else if (type === 'wall') {
        freshData = layout.walls?.find(w => w.id === data.id);
      } else if (type === 'door') {
        freshData = layout.doors?.find(d => d.id === data.id);
      } else if (type === 'window') {
        freshData = layout.windows?.find(w => w.id === data.id);
      } else if (type === 'column') {
        freshData = layout.columns?.find(c => c.id === data.id);
      } else if (type === 'staircase') {
        freshData = layout.staircases?.find(s => s.id === data.id);
      } else if (type === 'utility') {
        freshData = layout.utilities?.find(u => u.id === data.id);
      } else if (type === 'parking') {
        freshData = layout.parking?.find(p => p.id === data.id);
      } else if (type === 'plot') {
        freshData = layout.plot;
      } else if (type === 'dimension') {
        freshData = getPlotDimensionMeta(layout, data.axis);
      }

      if (freshData) {
        setSelectedElement({ type, data: freshData });
      } else {
        setSelectedElement(null);
      }
    }
  }, [layout]);

  // Debounced Autosave (1.5 seconds)
  useEffect(() => {
    setSaveStatus(SAVE_STATUS.UNSAVED);
    const timer = setTimeout(async () => {
      setSaveStatus(SAVE_STATUS.SAVING);
      const ok = await saveProject(layout);
      setSaveStatus(ok ? SAVE_STATUS.SAVED : SAVE_STATUS.FAILED);
    }, 1500);

    return () => clearTimeout(timer);
  }, [layout]);

  // Keyboard Shortcuts (Undo, Redo, Delete, Escape, Tools)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleKeyDown = (e) => {
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

      // Global Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (history.canUndo()) {
          const prev = history.undo();
          setLayout(prev);
        }
        return;
      }

      // Global Redo: Ctrl+Shift+Z / Ctrl+Y / Cmd+Shift+Z
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) ||
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (history.canRedo()) {
          const next = history.redo();
          setLayout(next);
        }
        return;
      }

      // If active in a text input, don't trigger tool or delete shortcuts
      if (isInput) return;

      // Delete selected element
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedElement) {
          const { type, data } = selectedElement;
          // Plot dimension annotations are linked to the plot boundary and cannot be deleted
          if (type === 'dimension') return;
          const nextLayout = { ...layout };
          if (type === 'room') {
            if (layout.rooms?.length <= 1) return;
            nextLayout.rooms = layout.rooms.filter(r => r.id !== data.id);
          } else if (type === 'wall') {
            nextLayout.walls = layout.walls.filter(w => w.id !== data.id);
          } else if (type === 'door') {
            nextLayout.doors = layout.doors.filter(d => d.id !== data.id);
          } else if (type === 'window') {
            nextLayout.windows = layout.windows.filter(w => w.id !== data.id);
          } else if (type === 'column') {
            nextLayout.columns = layout.columns.filter(c => c.id !== data.id);
          } else if (type === 'staircase') {
            nextLayout.staircases = layout.staircases.filter(s => s.id !== data.id);
          } else if (type === 'utility') {
            nextLayout.utilities = layout.utilities.filter(u => u.id !== data.id);
          } else if (type === 'parking') {
            nextLayout.parking = layout.parking.filter(p => p.id !== data.id);
          }
          history.pushState(nextLayout);
          setLayout(nextLayout);
          setSelectedElement(null);
        }
        return;
      }

      // Escape key: cancel tool or clear selection
      if (e.key === 'Escape') {
        setActiveTool('select');
        setSelectedElement(null);
        return;
      }

      // Tool shortcuts
      const key = e.key.toLowerCase();
      if (key === 'v') setActiveTool('select');
      else if (key === 'h') setActiveTool('pan');
      else if (key === 'w') setActiveTool('wall');
      else if (key === 'r') setActiveTool('room');
      else if (key === 'd') setActiveTool('door');
      else if (key === 'n') setActiveTool('window');
      else if (key === 's') setActiveTool('staircase');
      else if (key === 'c') setActiveTool('column');
      else if (key === 'm') setActiveTool('measure');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layout, selectedElement, history]);

  // Explicit Save Action
  const handleManualSave = async () => {
    setSaveStatus(SAVE_STATUS.SAVING);
    const ok = await saveProject(layout);
    setSaveStatus(ok ? SAVE_STATUS.SAVED : SAVE_STATUS.FAILED);
  };

  // Undo Handler
  const handleUndo = () => {
    if (history.canUndo()) {
      const prev = history.undo();
      setLayout(prev);
    }
  };

  // Redo Handler
  const handleRedo = () => {
    if (history.canRedo()) {
      const next = history.redo();
      setLayout(next);
    }
  };

  // Fit to screen trigger
  const handleFitScreen = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('autoplot-fit-screen'));
    }
  };

  // Reset to original generated layout
  const handleConfirmReset = () => {
    if (originalGeneratedLayout) {
      const resetLayout = cloneLayout(originalGeneratedLayout);
      history.reset(resetLayout);
      setLayout(resetLayout);
      setSelectedElement(null);
      setResetConfirmVisible(false);
    }
  };

  // Apply a plot width/height change (updates real boundary + dimension annotations)
  const applyPlotResize = (axis, feet) => {
    const next = resizePlot(layout, axis, feet);
    history.pushState(next);
    setLayout(next);
    setSelectedElement(null);
  };

  // Requested from the canvas / inspector. If shrinking the plot would push
  // existing elements outside the boundary, confirm before applying.
  const requestPlotResize = (axis, feet) => {
    const next = resizePlot(layout, axis, feet);
    const outside = findElementsOutsidePlot(next);
    if (outside.length > 0) {
      setPendingResize({ axis, feet, outside });
      return;
    }
    history.pushState(next);
    setLayout(next);
    setSelectedElement(null);
  };

  const handleConfirmPlotResize = () => {
    if (!pendingResize) return;
    applyPlotResize(pendingResize.axis, pendingResize.feet);
    setPendingResize(null);
  };

  // Close & Apply Changes
  const handleCloseAndApply = () => {
    if (onSaveAndClose) {
      onSaveAndClose(layout);
    } else if (onClose) {
      onClose();
    }
  };

  return (
    <View style={styles.editorContainer}>
      {/* 1. Top Action Toolbar */}
      <EditorToolbar
        layout={layout}
        onSave={handleManualSave}
        saveStatus={saveStatus}
        canUndo={history.canUndo()}
        canRedo={history.canRedo()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(!showGrid)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        showDimensions={showDimensions}
        onToggleDimensions={() => setShowDimensions(!showDimensions)}
        onFitScreen={handleFitScreen}
        allowDiagonal={allowDiagonal}
        onToggleDiagonal={() => setAllowDiagonal(!allowDiagonal)}
        validationIssues={validationIssues}
        onOpenValidation={() => setValidationModalVisible(true)}
        onOpenExport={() => setExportModalVisible(true)}
        onResetLayout={() => setResetConfirmVisible(true)}
        onClose={handleCloseAndApply}
      />

      {/* 2. Middle Workspace: Left Sidebar + Center Canvas + Right Inspector */}
      <View style={styles.middleWorkspace}>
        {/* Left Sidebar */}
        <EditorLeftSidebar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          layout={layout}
          onUpdateLayout={setLayout}
          onSelectElement={setSelectedElement}
          historyManager={history}
        />

        {/* Center Interactive CAD Canvas */}
        <EditorCanvas
          layout={layout}
          onUpdateLayout={setLayout}
          selectedElement={selectedElement}
          onSelectElement={setSelectedElement}
          activeTool={activeTool}
          unit={unit}
          showGrid={showGrid}
          snapEnabled={snapEnabled}
          snapStep={0.5}
          showDimensions={showDimensions}
          onCursorMove={setCursorWorldPos}
          historyManager={history}
          allowDiagonal={allowDiagonal}
          snapTolerance={snapTolerance}
          onRequestPlotResize={requestPlotResize}
        />

        {/* Right Properties Panel (Inspector) */}
        <EditorRightPanel
          layout={layout}
          onUpdateLayout={setLayout}
          selectedElement={selectedElement}
          onSelectElement={setSelectedElement}
          unit={unit}
          validationIssues={validationIssues}
          historyManager={history}
          onRequestPlotResize={requestPlotResize}
        />
      </View>

      {/* 3. Bottom Status Bar */}
      <EditorStatusBar
        cursorWorldPos={cursorWorldPos}
        unit={unit}
        onChangeUnit={setUnit}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        layout={layout}
        validationIssues={validationIssues}
        onOpenValidation={() => setValidationModalVisible(true)}
        snapTolerance={snapTolerance}
        onChangeSnapTolerance={setSnapTolerance}
      />

      {/* EXPORT OPTIONS MODAL */}
      <Modal visible={exportModalVisible} transparent animationType="fade" onRequestClose={() => setExportModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitle}>
                <Ionicons name="download-outline" size={20} color="#070262" />
                <Text style={styles.modalTitleText}>Export Architectural Plan</Text>
              </View>
              <TouchableOpacity onPress={() => setExportModalVisible(false)}>
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Export your latest edited 2D layout with title block, room dimensions, wall envelopes, and north orientation:
            </Text>

            <View style={styles.exportList}>
              <TouchableOpacity
                style={styles.exportItem}
                onPress={() => {
                  exportAsPNG(layout, unit);
                  setExportModalVisible(false);
                }}
              >
                <View style={styles.exportIconBox}>
                  <Ionicons name="image-outline" size={20} color="#2563EB" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exportItemTitle}>High-Resolution Image (PNG)</Text>
                  <Text style={styles.exportItemDesc}>300 DPI architectural vector raster with title block</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.exportItem}
                onPress={() => {
                  exportAsSVG(layout, unit);
                  setExportModalVisible(false);
                }}
              >
                <View style={styles.exportIconBox}>
                  <Ionicons name="shapes-outline" size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exportItemTitle}>Scalable Vector Graphics (SVG)</Text>
                  <Text style={styles.exportItemDesc}>Clean infinite-zoom vector format for CAD viewers</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.exportItem}
                onPress={() => {
                  printLayoutPlan(layout, unit);
                  setExportModalVisible(false);
                }}
              >
                <View style={styles.exportIconBox}>
                  <Ionicons name="print-outline" size={20} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exportItemTitle}>Print / PDF Document</Text>
                  <Text style={styles.exportItemDesc}>Open landscape blueprint print preview for plotting</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.exportItem}
                onPress={() => {
                  exportProjectJSON(layout);
                  setExportModalVisible(false);
                }}
              >
                <View style={styles.exportIconBox}>
                  <Ionicons name="code-download-outline" size={20} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exportItemTitle}>Project Data (JSON)</Text>
                  <Text style={styles.exportItemDesc}>Backup and transfer raw layout geometry structure</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* VALIDATION ISSUES MODAL */}
      <Modal visible={validationModalVisible} transparent animationType="fade" onRequestClose={() => setValidationModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitle}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#070262" />
                <Text style={styles.modalTitleText}>Layout Architectural Validation</Text>
              </View>
              <TouchableOpacity onPress={() => setValidationModalVisible(false)}>
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {validationIssues.length === 0 ? (
              <View style={styles.emptyValCard}>
                <Ionicons name="checkmark-circle" size={40} color="#10B981" />
                <Text style={styles.emptyValTitle}>No Validation Issues Found</Text>
                <Text style={styles.emptyValText}>
                  All walls, rooms, doors, and setback constraints satisfy architectural specifications.
                </Text>
              </View>
            ) : (
              <View style={styles.issuesModalList}>
                {validationIssues.map(issue => (
                  <View key={issue.id} style={[styles.issueModalCard, { borderLeftColor: issue.severity === 'error' ? '#DC2626' : '#D97706' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons
                        name={issue.severity === 'error' ? "alert-circle" : "warning"}
                        size={16}
                        color={issue.severity === 'error' ? '#DC2626' : '#D97706'}
                      />
                      <Text style={styles.issueModalTitle}>{issue.title}</Text>
                    </View>
                    <Text style={styles.issueModalDesc}>{issue.message}</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setValidationModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* RESET TO ORIGINAL LAYOUT CONFIRMATION DIALOG */}
      <Modal visible={resetConfirmVisible} transparent animationType="fade" onRequestClose={() => setResetConfirmVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 420 }]}>
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Ionicons name="warning-outline" size={42} color="#D97706" />
              <Text style={[styles.modalTitleText, { marginTop: 10 }]}>Reset to Original Layout?</Text>
              <Text style={[styles.modalDesc, { textAlign: 'center', marginTop: 8 }]}>
                This will discard all manual room resizing, wall movements, and added elements, restoring the original generated Vastu layout.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtnSecondary, { flex: 1 }]}
                onPress={() => setResetConfirmVisible(false)}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnDanger, { flex: 1 }]}
                onPress={handleConfirmReset}
              >
                <Text style={styles.modalBtnDangerText}>Yes, Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PLOT DIMENSION RESIZE CONFIRMATION */}
      <Modal visible={!!pendingResize} transparent animationType="fade" onRequestClose={() => setPendingResize(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 440 }]}>
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Ionicons name="resize-outline" size={40} color="#D97706" />
              <Text style={[styles.modalTitleText, { marginTop: 10 }]}>
                Resize Plot {pendingResize?.axis === 'width' ? 'Width' : 'Height'}?
              </Text>
              <Text style={[styles.modalDesc, { textAlign: 'center', marginTop: 8 }]}>
                Changing the plot {pendingResize?.axis} to {pendingResize ? pendingResize.feet.toFixed(1) : ''} ft
                will leave {pendingResize?.outside?.length || 0} element(s) outside the new boundary. Nothing is
                deleted - internal layout is preserved and flagged for review.
              </Text>
            </View>

            <View style={{ maxHeight: 160, borderWidth: 1, borderColor: '#F1F5F9', borderRadius: 6, padding: 8, marginTop: 4 }}>
              {(pendingResize?.outside || []).slice(0, 6).map((el) => (
                <View key={`${el.type}-${el.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
                  <Ionicons name="alert-circle-outline" size={13} color="#D97706" />
                  <Text style={{ fontSize: 11, color: '#475569' }}>
                    {el.name} ({el.type}) falls outside
                  </Text>
                </View>
              ))}
              {(pendingResize?.outside?.length || 0) > 6 && (
                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                  +{(pendingResize.outside.length - 6)} more...
                </Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtnSecondary, { flex: 1 }]}
                onPress={() => setPendingResize(null)}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnDanger, { flex: 1 }]}
                onPress={handleConfirmPlotResize}
              >
                <Text style={styles.modalBtnDangerText}>Apply Anyway</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  editorContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#F8FAFC',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
  },
  middleWorkspace: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitleText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 12,
    marginBottom: 16,
  },
  exportList: {
    gap: 10,
  },
  exportItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  exportIconBox: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  exportItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  exportItemDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  emptyValCard: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyValTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10B981',
  },
  emptyValText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  issuesModalList: {
    gap: 10,
    maxHeight: 280,
  },
  issueModalCard: {
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 4,
    gap: 4,
  },
  issueModalTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  issueModalDesc: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },
  modalCloseBtn: {
    marginTop: 18,
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBtnSecondary: {
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  modalBtnSecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  modalBtnDanger: {
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#DC2626',
    alignItems: 'center',
  },
  modalBtnDangerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
