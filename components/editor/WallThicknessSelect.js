/**
 * Wall thickness dropdown, in inches. Used by the wall tool and the wall
 * inspector. A wall outside the standard list (generated layouts use 9" and
 * 4.5") shows its real value, so opening the dropdown never misreports it.
 */

import React from 'react';
import { WALL_THICKNESS_OPTIONS } from './layoutModel';

const selectStyle = {
  width: '100%',
  height: 34,
  padding: '0 8px',
  fontSize: 12,
  color: '#1E293B',
  backgroundColor: '#FFFFFF',
  border: '1px solid #CBD5E1',
  borderRadius: 6,
  cursor: 'pointer',
};

export default function WallThicknessSelect({ inches, onChange, disabled = false, longLabels = false, style, label: ariaLabel = 'Wall thickness', testID = 'wall-thickness' }) {
  const isStandard = WALL_THICKNESS_OPTIONS.includes(inches);
  const options = isStandard ? WALL_THICKNESS_OPTIONS : [...WALL_THICKNESS_OPTIONS, inches].sort((a, b) => a - b);
  const label = (n) => {
    const text = longLabels ? `${n} inches` : `${n}"`;
    return n === inches && !isStandard ? `${text} (current)` : text;
  };

  return (
    <select
      aria-label={ariaLabel}
      data-testid={testID}
      value={String(inches)}
      disabled={disabled}
      style={{ ...selectStyle, ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null), ...style }}
      onChange={(e) => {
        onChange(Number(e.target.value));
        // Hand the keyboard back, so editor shortcuts work straight after choosing.
        e.target.blur();
      }}
    >
      {options.map((n) => (
        <option key={n} value={String(n)}>{label(n)}</option>
      ))}
    </select>
  );
}
