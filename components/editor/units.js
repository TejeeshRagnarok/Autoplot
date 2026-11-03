/**
 * AutoPlot Architectural Units & Precision Conversion Utility
 * The geometry model always stores feet. These helpers only convert for display
 * and input.
 * Supports:
 * - 'ft-in': Feet and Inches (e.g. 12' 4", 10' 6 1/2")
 * - 'ft': Decimal Feet (e.g. 12.33 ft)
 * - 'in': Inches (e.g. 148")
 * - 'm': Meters (e.g. 3.76 m), and typed "cm" / "mm" values in any unit
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

export const FEET_PER_METER = 1 / 0.3048;
const INCH_FRACTION = 8; // feet & inches are shown to the nearest 1/8"

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Format a measurement in feet into a display string for the specified unit.
 * Negative values (coordinates left of / above the plot origin) keep their sign.
 * @param {number} feetVal - Measurement in feet
 * @param {string} unit - 'ft-in' | 'ft' | 'in' | 'm'
 * @param {number} precision - Decimal places for decimal units
 * @returns {string} Formatted measurement string
 */
export function formatMeasurement(feetVal, unit = 'ft-in', precision = 2) {
  if (feetVal === null || feetVal === undefined || isNaN(feetVal)) return '0';
  const parsed = parseFloat(feetVal);
  const val = Math.abs(parsed);

  let text;
  switch (unit) {
    case UNIT_TYPES.FT_IN: {
      // Work in whole eighths of an inch so carries (11 7/8" up to 1') are exact.
      const eighths = Math.round(val * 12 * INCH_FRACTION);
      const feet = Math.floor(eighths / (12 * INCH_FRACTION));
      const rest = eighths - feet * 12 * INCH_FRACTION;
      const inches = Math.floor(rest / INCH_FRACTION);
      const frac = rest - inches * INCH_FRACTION;
      if (frac === 0) {
        text = `${feet}' ${inches}"`;
      } else {
        const d = gcd(frac, INCH_FRACTION);
        text = `${feet}' ${inches} ${frac / d}/${INCH_FRACTION / d}"`;
      }
      break;
    }
    case UNIT_TYPES.FT:
      text = `${val.toFixed(precision)} ft`;
      break;
    case UNIT_TYPES.IN: {
      const inches = val * 12;
      const rounded = Math.round(inches * 100) / 100;
      text = `${rounded}"`;
      break;
    }
    case UNIT_TYPES.M:
      text = `${(val * 0.3048).toFixed(precision)} m`;
      break;
    default:
      text = `${val.toFixed(precision)}'`;
  }
  // "-0' 0"" would be misleading: only show the sign when the value isn't zero.
  const isZero = /^[0'"\s.]*(ft|m)?$/.test(text);
  return parsed < 0 && !isZero ? `-${text}` : text;
}

/** "6", "6.5", "1/2", "6 1/2" -> number, or null when it isn't a number. */
function parseMixedNumber(str) {
  const s = str.trim();
  if (s === '') return null;
  let m = s.match(/^(\d*\.?\d+)$/);
  if (m) return parseFloat(m[1]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  m = s.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  return null;
}

/**
 * Parse a user input string into feet according to the active unit.
 * A number with an explicit unit always means that unit; a plain number means
 * the active unit (feet in 'ft-in' and 'ft' mode).
 * Supports: 12' 6", 12ft 6in, 12-6, 12'6 1/2", 12.5, 150", 150 in, 3.8m, 380cm, 3800mm.
 * A leading minus is allowed; callers that need positive sizes check for it.
 * @param {string|number} inputStr
 * @param {string} currentUnit
 * @returns {number|null} Value in feet or null if invalid
 */
export function parseToFeet(inputStr, currentUnit = 'ft-in') {
  if (typeof inputStr === 'number') {
    return Number.isFinite(inputStr) ? inputStr : null;
  }
  if (!inputStr || typeof inputStr !== 'string') return null;

  let raw = inputStr.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (raw === '') return null;

  let sign = 1;
  if (raw.startsWith('-')) {
    sign = -1;
    raw = raw.slice(1).trim();
  }
  const out = (feet) => (feet === null || !Number.isFinite(feet) ? null : sign * feet);

  // Metric with explicit unit
  let m = raw.match(/^(\d*\.?\d+)\s*(mm|cm|m|meters?|metres?)$/);
  if (m) {
    const v = parseFloat(m[1]);
    if (m[2] === 'mm') return out((v / 1000) * FEET_PER_METER);
    if (m[2] === 'cm') return out((v / 100) * FEET_PER_METER);
    return out(v * FEET_PER_METER);
  }

  // Feet with optional inches: 12' 6", 12ft 6in, 12' 6 1/2", 12'
  m = raw.match(/^(\d*\.?\d+)\s*(?:'|ft\.?|feet|foot)\s*(.*)$/);
  if (m) {
    const inchPart = m[2].replace(/(?:"|in\.?|inch|inches)\s*$/, '').trim();
    const inches = inchPart === '' ? 0 : parseMixedNumber(inchPart);
    if (inches === null) return null;
    return out(parseFloat(m[1]) + inches / 12);
  }

  // Inches only: 150", 150 in, 6 1/2"
  m = raw.match(/^(.+?)\s*(?:"|in\.?|inch|inches)$/);
  if (m) {
    const inches = parseMixedNumber(m[1]);
    return inches === null ? null : out(inches / 12);
  }

  // Dash separated feet-inches: 12-6
  m = raw.match(/^(\d*\.?\d+)-(\d*\.?\d+)$/);
  if (m) return out(parseFloat(m[1]) + parseFloat(m[2]) / 12);

  // Plain number in the active unit
  const plain = parseMixedNumber(raw);
  if (plain === null) return null;
  if (currentUnit === UNIT_TYPES.M) return out(plain * FEET_PER_METER);
  if (currentUnit === UNIT_TYPES.IN) return out(plain / 12);
  return out(plain);
}

/**
 * Decide what a measurement field should do when it loses focus.
 * The typed text is a draft; geometry only changes when the user really typed
 * something different from what the field displayed. Without this check,
 * tabbing through a field would round the value to the display precision.
 * @returns {{action:'none'|'revert'|'commit', value?:number, reason?:string}}
 */
export function resolveMeasurementCommit(text, currentFeet, unit, { min = -Infinity, max = Infinity, precision = 2 } = {}) {
  const displayed = formatMeasurement(currentFeet, unit, precision);
  const typed = String(text ?? '').trim();
  if (typed === displayed) return { action: 'none' };
  const feet = parseToFeet(typed, unit);
  if (feet === null) return { action: 'revert', reason: 'Not a valid measurement.' };
  if (feet < min - 1e-9) return { action: 'revert', reason: `Must be at least ${formatMeasurement(min, unit, precision)}.` };
  if (feet > max + 1e-9) return { action: 'revert', reason: `Must be at most ${formatMeasurement(max, unit, precision)}.` };
  const value = Math.round(feet * 1e6) / 1e6;
  if (Math.abs(value - currentFeet) < 1e-6) return { action: 'none' };
  return { action: 'commit', value };
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
    const sqM = val * 0.09290304;
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
