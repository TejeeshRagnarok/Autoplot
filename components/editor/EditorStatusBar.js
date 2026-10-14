/**
 * AutoPlot Layout Editor - Bottom Status Bar Component
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMeasurement, UNIT_TYPES } from './units';

export default function EditorStatusBar({
  cursorWorldPos = { x: 0, y: 0 },
  unit = 'ft-in',
  onChangeUnit,
  snapEnabled,
  onToggleSnap,
  layout,
  validationIssues = [],
  onOpenValidation,
  snapTolerance = 0.75,
  onChangeSnapTolerance,
}) {
  const errorCount = validationIssues.filter(i => i.severity === 'error').length;
  const warningCount = validationIssues.filter(i => i.severity === 'warning').length;

  const roomCount = layout?.rooms?.length || 0;
  const wallCount = layout?.walls?.length || 0;
  const doorCount = layout?.doors?.length || 0;
  const winCount = layout?.windows?.length || 0;

  return (
    <View style={styles.statusBar}>
      {/* Left: Real-World Cursor Coordinates */}
      <View style={styles.section}>
        <Ionicons name="locate-outline" size={13} color="#64748B" />
        <Text style={styles.coordText}>
          X: <Text style={styles.boldText}>{formatMeasurement(cursorWorldPos.x, unit)}</Text>
          {'   '}
          Y: <Text style={styles.boldText}>{formatMeasurement(cursorWorldPos.y, unit)}</Text>
        </Text>
      </View>

      <View style={styles.divider} />

      {/* Center: Elements Counter Summary */}
      <View style={styles.section}>
        <Text style={styles.counterText}>
          Rooms: <Text style={styles.boldText}>{roomCount}</Text>
          {'  |  '}
          Walls: <Text style={styles.boldText}>{wallCount}</Text>
          {'  |  '}
          Doors: <Text style={styles.boldText}>{doorCount}</Text>
          {'  |  '}
          Windows: <Text style={styles.boldText}>{winCount}</Text>
        </Text>
      </View>

      <View style={styles.divider} />

      {/* Right: Snap Toggle, Unit Switcher, Validation Status */}
      <View style={styles.rightGroup}>
        {/* Snap Toggle */}
        <TouchableOpacity style={styles.statusActionBtn} onPress={onToggleSnap}>
          <Ionicons
            name="magnet"
            size={12}
            color={snapEnabled ? "#2563EB" : "#94A3B8"}
          />
          <Text style={[styles.statusActionText, snapEnabled && { color: "#2563EB", fontWeight: '700' }]}>
            Snap {snapEnabled ? 'ON' : 'OFF'}
          </Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Snap Tolerance Stepper */}
        {!!onChangeSnapTolerance && (
          <View style={styles.snapTolGroup}>
            <TouchableOpacity
              style={styles.snapTolBtn}
              onPress={() => onChangeSnapTolerance(Math.max(0.1, Number((snapTolerance - 0.25).toFixed(2))))}
            >
              <Ionicons name="remove" size={11} color="#64748B" />
            </TouchableOpacity>
            <Text style={styles.snapTolText}>{Number(snapTolerance).toFixed(2)}′</Text>
            <TouchableOpacity
              style={styles.snapTolBtn}
              onPress={() => onChangeSnapTolerance(Math.min(3, Number((snapTolerance + 0.25).toFixed(2))))}
            >
              <Ionicons name="add" size={11} color="#64748B" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.divider} />

        {/* Units Selector */}
        <View style={styles.unitSelector}>
          <TouchableOpacity
            style={[styles.unitBtn, unit === UNIT_TYPES.FT_IN && styles.unitBtnActive]}
            onPress={() => onChangeUnit(UNIT_TYPES.FT_IN)}
          >
            <Text style={[styles.unitBtnText, unit === UNIT_TYPES.FT_IN && styles.unitBtnTextActive]}>FT-IN</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.unitBtn, unit === UNIT_TYPES.FT && styles.unitBtnActive]}
            onPress={() => onChangeUnit(UNIT_TYPES.FT)}
          >
            <Text style={[styles.unitBtnText, unit === UNIT_TYPES.FT && styles.unitBtnTextActive]}>FT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.unitBtn, unit === UNIT_TYPES.IN && styles.unitBtnActive]}
            onPress={() => onChangeUnit(UNIT_TYPES.IN)}
          >
            <Text style={[styles.unitBtnText, unit === UNIT_TYPES.IN && styles.unitBtnTextActive]}>IN</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.unitBtn, unit === UNIT_TYPES.M && styles.unitBtnActive]}
            onPress={() => onChangeUnit(UNIT_TYPES.M)}
          >
            <Text style={[styles.unitBtnText, unit === UNIT_TYPES.M && styles.unitBtnTextActive]}>M</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Validation Status Badge */}
        <TouchableOpacity style={styles.validationBadge} onPress={onOpenValidation}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: errorCount > 0 ? '#DC2626' : warningCount > 0 ? '#D97706' : '#10B981' },
            ]}
          />
          <Text
            style={[
              styles.statusBadgeText,
              { color: errorCount > 0 ? '#DC2626' : warningCount > 0 ? '#D97706' : '#059669' },
            ]}
          >
            {errorCount > 0
              ? `${errorCount} Issues`
              : warningCount > 0
              ? `${warningCount} Warnings`
              : 'Layout Sound'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statusBar: {
    height: 32,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1.2,
    borderTopColor: '#CBD5E1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    zIndex: 50,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coordText: {
    fontSize: 11,
    color: '#64748B',
    fontFamily: 'Segoe UI, sans-serif',
  },
  counterText: {
    fontSize: 11,
    color: '#64748B',
    fontFamily: 'Segoe UI, sans-serif',
  },
  boldText: {
    fontWeight: '700',
    color: '#1E293B',
  },
  divider: {
    width: 1,
    height: 16,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 8,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  statusActionText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  snapTolGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  snapTolBtn: {
    width: 16,
    height: 16,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    borderWidth: 0.5,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  snapTolText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
    minWidth: 30,
    textAlign: 'center',
  },
  unitSelector: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    padding: 2,
    gap: 2,
  },
  unitBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  unitBtnActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 0.5,
    borderColor: '#CBD5E1',
  },
  unitBtnText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#64748B',
  },
  unitBtnTextActive: {
    color: '#2563EB',
    fontWeight: '800',
  },
  validationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
