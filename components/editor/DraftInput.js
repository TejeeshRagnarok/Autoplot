/**
 * Inspector input with a clear split between its temporary typing state and the
 * committed geometry value. While the field is being edited only the draft
 * changes; the value is committed once, on blur or Enter, and only when the text
 * really differs from what was displayed. Escape abandons the draft, and invalid
 * text is rejected with a message rather than silently changing anything.
 */

import React, { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { formatMeasurement, resolveMeasurementCommit } from './units';

export default function DraftInput({ display, resolve, onCommit, style, errorStyle, editable = true, ...rest }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const draftRef = useRef(null);

  const change = (text) => {
    draftRef.current = text;
    setDraft(text);
    setError(null);
  };

  const finish = () => {
    const text = draftRef.current;
    if (text === null) return; // nothing typed, or already committed (Enter then blur)
    draftRef.current = null;
    setDraft(null);
    const res = resolve(text);
    if (res.action === 'commit') onCommit(res.value);
    else if (res.action === 'revert') setError(res.reason || 'Invalid value.');
  };

  const cancel = (e) => {
    draftRef.current = null;
    setDraft(null);
    setError(null);
    e?.target?.blur?.();
  };

  return (
    <View>
      <TextInput
        {...rest}
        style={style}
        editable={editable}
        value={draft ?? display}
        onChangeText={change}
        onBlur={finish}
        onSubmitEditing={finish}
        onKeyPress={(e) => {
          if (e.nativeEvent?.key === 'Escape') cancel(e);
        }}
      />
      {!!error && <Text style={errorStyle || { fontSize: 10, color: '#DC2626', marginTop: 2 }}>{error}</Text>}
    </View>
  );
}

/** A length in the active unit; the value passed to onCommit is always feet. */
export function MeasureInput({ value, unit, onCommit, min, max, ...rest }) {
  return (
    <DraftInput
      {...rest}
      display={formatMeasurement(value ?? 0, unit)}
      resolve={(text) => resolveMeasurementCommit(text, value ?? 0, unit, { min, max })}
      onCommit={onCommit}
    />
  );
}

/** A plain number such as a count or an angle. */
export function NumberInput({ value, onCommit, min = -Infinity, max = Infinity, integer = false, suffix = '', ...rest }) {
  const display = `${value ?? 0}${suffix}`;
  const resolve = (text) => {
    if (String(text).trim() === display) return { action: 'none' };
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return { action: 'revert', reason: 'Enter a number.' };
    const v = integer ? Math.round(n) : n;
    if (v < min) return { action: 'revert', reason: `Must be at least ${min}.` };
    if (v > max) return { action: 'revert', reason: `Must be at most ${max}.` };
    return v === value ? { action: 'none' } : { action: 'commit', value: v };
  };
  return <DraftInput {...rest} display={display} resolve={resolve} onCommit={onCommit} keyboardType="numeric" />;
}

/** Free text committed as one edit, not one undo step per keystroke. */
export function TextField({ value, onCommit, ...rest }) {
  const display = value ?? '';
  return (
    <DraftInput
      {...rest}
      display={display}
      resolve={(text) => (text === display ? { action: 'none' } : { action: 'commit', value: text })}
      onCommit={onCommit}
    />
  );
}
