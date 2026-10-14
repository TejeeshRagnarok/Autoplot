/**
 * AutoPlot Architectural Units & Precision Conversion Utility
 * Supports:
 * - 'ft-in': Feet and Inches (e.g. 12' 4", 10' 6 1/2")
 * - 'ft': Decimal Feet (e.g. 12.33 ft)
 * - 'in': Inches (e.g. 148 in)
 * - 'm': Meters & Centimeters (e.g. 3.76 m)
 */

export const UNIT_TYPES = {
  FT_IN: 'ft-in',
  FT: 'ft',
  IN: 'in',
  M: 'm',
};

export const UNIT_LABELS = {
  'ft-in': 'Feet & Inches (ft in)',
  'ft': 'Decimal Feet (ft)',
  'in': 'Inches (in)',
  'm': 'Meters (m)',
};

/**
 * Format a measurement in feet into a display string for the specified unit.
 * @param {number} feetVal - Measurement in feet
 * @param {string} unit - 'ft-in' | 'ft' | 'in' | 'm'
 * @param {number} precision - Decimal places for decimal units
 * @returns {string} Formatted measurement string
 */
export function formatMeasurement(feetVal, unit = 'ft-in', precision = 2) {
  if (feetVal === null || feetVal === undefined || isNaN(feetVal)) return '0';
  const val = Math.max(0, parseFloat(feetVal));

  switch (unit) {
    case UNIT_TYPES.FT_IN: {
      const wholeFeet = Math.floor(val);
      const inchesTotal = (val - wholeFeet) * 12;
      const wholeInches = Math.round(inchesTotal);
      if (wholeInches === 12) {
        return `${wholeFeet + 1}' 0"`;
      }
      return `${wholeFeet}' ${wholeInches}"`;
    }
    case UNIT_TYPES.FT: {
      return `${val.toFixed(precision)} ft`;
    }
    case UNIT_TYPES.IN: {
      const inches = Math.round(val * 12);
      return `${inches}"`;
    }
    case UNIT_TYPES.M: {
      const meters = val * 0.3048;
      return `${meters.toFixed(precision)} m`;
    }
    default:
      return `${val.toFixed(precision)}'`;
  }
}

/**
 * Parse a user input string into feet according to the active unit.
 * Supports flexible inputs:
 * - "12' 6"", "12 ft 6 in", "12-6", "12.5"
 * - "150"", "150 in"
 * - "3.8m", "3.8 m"
 * @param {string|number} inputStr
 * @param {string} currentUnit
 * @returns {number|null} Value in feet or null if invalid
 */
export function parseToFeet(inputStr, currentUnit = 'ft-in') {
  if (typeof inputStr === 'number') {
    return isNaN(inputStr) ? null : Math.max(0, inputStr);
  }
  if (!inputStr || typeof inputStr !== 'string') return null;

  const raw = inputStr.trim().toLowerCase();
  if (raw === '') return null;

  // 1. Explicit meters check (e.g. "3.5m" or "3.5 m")
  if (raw.endsWith('m') && !raw.endsWith('mm')) {
    const numPart = parseFloat(raw.replace('m', '').trim());
    if (!isNaN(numPart)) return numPart / 0.3048;
  }

  // 2. Explicit inches check (e.g. "144"" or "144 in" or "144in")
  if (raw.endsWith('"') || raw.endsWith('in') || raw.endsWith('inches')) {
    const numPart = parseFloat(raw.replace(/in(ches)?|"/g, '').trim());
    if (!isNaN(numPart)) return numPart / 12;
  }

  // 3. Feet and inches string (e.g. 12' 4", 12'4, 12ft 4in, 12-4)
  const ftInRegex = /^(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/i;
  const match = raw.match(ftInRegex);
  if (match && (match[1] !== undefined || match[2] !== undefined)) {
    const feet = match[1] ? parseFloat(match[1]) : 0;
    const inches = match[2] ? parseFloat(match[2]) : 0;
    return feet + inches / 12;
  }

  // 4. Dash separated (e.g. "12-6" for 12ft 6in)
  const dashMatch = raw.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (dashMatch) {
    const feet = parseFloat(dashMatch[1]);
    const inches = parseFloat(dashMatch[2]);
    return feet + inches / 12;
  }

  // 5. Plain decimal number according to currentUnit
  const plainNum = parseFloat(raw);
  if (isNaN(plainNum)) return null;

  if (currentUnit === UNIT_TYPES.M) {
    return plainNum / 0.3048;
  }
  if (currentUnit === UNIT_TYPES.IN) {
    return plainNum / 12;
  }
  return plainNum;
}

/**
 * Convert area in square feet to display string
 * @param {number} sqFt
 * @param {string} unit
 * @returns {string}
 */
export function formatArea(sqFt, unit = 'ft-in') {
  if (sqFt === null || sqFt === undefined || isNaN(sqFt)) return '0 sq.ft';
  const val = Math.max(0, sqFt);
  if (unit === UNIT_TYPES.M) {
    const sqM = val * 0.092903;
    return `${sqM.toFixed(1)} sq.m (${Math.round(val)} sq.ft)`;
  }
  return `${Math.round(val)} sq.ft`;
}

/**
 * Convert feet to inches integer
 */
export function feetToInches(feet) {
  return Math.round((parseFloat(feet) || 0) * 12);
}

/**
 * Convert inches to feet
 */
export function inchesToFeet(inches) {
  return (parseFloat(inches) || 0) / 12;
}
