/**
 * AutoPlot Architectural Staircase Geometry Engine
 *
 * A staircase is a parametric object. Its step geometry is always regenerated
 * from its properties - it is never a scaled symbol.
 *
 * ---------------------------------------------------------------------------
 * COUNTING CONVENTION (used everywhere in AutoPlot)
 * ---------------------------------------------------------------------------
 *  - R  = total risers between floors. Riser height = floorHeight / R.
 *  - F  = number of flights (straight = 1; dog-legged, U-shaped, L-shaped = 2).
 *  - Risers are split between flights as evenly as possible; the first flight
 *    takes the extra riser when R is odd.
 *  - Each flight with r risers has (r - 1) treads: its last riser steps onto
 *    the landing (or the upper floor), which is NOT counted as a tread.
 *    Total treads T = R - F.
 *  - There are F - 1 landings. A landing is never counted as a tread.
 *  - Run of a flight = treads in that flight x treadDepth.
 *
 * ---------------------------------------------------------------------------
 * FOOTPRINT CONVENTION
 * ---------------------------------------------------------------------------
 *  - `width` / `length` are the stair's own (local, un-rotated) dimensions:
 *    `length` runs along the direction of travel of the first flight,
 *    `width` is across it.
 *      straight:   length = T * treadDepth
 *      dog/U:      length = max(treads per flight) * treadDepth + landingDepth
 *                  width  = 2 * flightWidth + wellGap   (flightWidth derived)
 *      L-shaped:   length = flightWidth + t1 * treadDepth
 *                  width  = flightWidth + t2 * treadDepth
 *  - `x` / `y` is the top-left corner of the WORLD axis-aligned bounding box.
 *  - `rotation` is 0 / 90 / 180 / 270 degrees clockwise. At 90 / 270 the world
 *    bounding box is `length` wide and `width` long (see getStaircaseBounds).
 *  - Local frame: u across (0..width), v along travel (0..length). The first
 *    flight starts at v = length (the entry) and climbs towards v = 0.
 *
 * Geometric checks here are drafting guidelines only. They are not a
 * structural or building-code compliance check.
 */

import { generateUniqueId } from './layoutModel.js';

export const STAIRCASE_TYPES = {
  DOG_LEGGED: 'dog-legged',
  STRAIGHT: 'straight',
  U_SHAPED: 'u-shaped',
  L_SHAPED: 'l-shaped',
};

const IN = 1 / 12; // one inch in feet

export const STAIRCASE_DEFAULTS = {
  [STAIRCASE_TYPES.DOG_LEGGED]: { width: 6.0, floorHeight: 10.0, risers: 18, treadDepth: 10 * IN, landingDepth: 3.0, wellGap: 4 * IN },
  [STAIRCASE_TYPES.STRAIGHT]: { width: 3.5, floorHeight: 10.0, risers: 17, treadDepth: 10 * IN, landingDepth: 0, wellGap: 0 },
  [STAIRCASE_TYPES.U_SHAPED]: { width: 7.0, floorHeight: 10.0, risers: 18, treadDepth: 10 * IN, landingDepth: 3.25, wellGap: 1.0 },
  [STAIRCASE_TYPES.L_SHAPED]: { width: 3.5, floorHeight: 10.0, risers: 18, treadDepth: 10 * IN, landingDepth: 0, wellGap: 0, flightWidth: 3.5 },
};

export const STAIR_LIMITS = {
  minRisers: 2,
  maxRisers: 40,
  minTreadDepth: 6 * IN,
  maxTreadDepth: 24 * IN,
  minFloorHeight: 6,
  maxFloorHeight: 20,
  minFlightWidth: 2,
  minLanding: 2,
};

const round4 = (v) => Math.round(v * 10000) / 10000;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);

export function normalizeRotation(rot) {
  const r = Math.round((Number(rot) || 0) / 90) * 90;
  return ((r % 360) + 360) % 360;
}

/** Number of flights for a staircase type. */
export function getFlightCount(stairType) {
  return stairType === STAIRCASE_TYPES.STRAIGHT ? 1 : 2;
}

/** Risers and treads per flight, following the counting convention above. */
export function getFlightBreakdown(stairType, risers) {
  const F = getFlightCount(stairType);
  const R = Math.max(F + 1, Math.round(risers));
  if (F === 1) return [{ risers: R, treads: R - 1 }];
  const r1 = Math.ceil(R / 2);
  const r2 = R - r1;
  return [
    { risers: r1, treads: r1 - 1 },
    { risers: r2, treads: r2 - 1 },
  ];
}

/**
 * Bring a staircase into a consistent state.
 * `changed` names the property the user just edited so the right dependent
 * value is recomputed:
 *  - 'length' -> treadDepth is derived from the new length (step count kept)
 *  - 'width'  -> for L-shaped stairs treadDepth is derived from the width;
 *                for the other types the width just changes the flight width
 *  - anything else -> length (and L-shaped width) is derived from treadDepth
 */
export function normalizeStaircase(stair, changed = null) {
  const stairType = Object.values(STAIRCASE_TYPES).includes(stair.stairType) ? stair.stairType : STAIRCASE_TYPES.DOG_LEGGED;
  const def = STAIRCASE_DEFAULTS[stairType];
  const s = { ...stair, stairType };

  s.rotation = normalizeRotation(s.rotation);
  s.floorHeight = clamp(num(s.floorHeight, def.floorHeight), STAIR_LIMITS.minFloorHeight, STAIR_LIMITS.maxFloorHeight);
  // Two-flight stairs need at least 2 risers per flight so each flight has a tread.
  const minRisers = getFlightCount(stairType) === 1 ? STAIR_LIMITS.minRisers : 2 * STAIR_LIMITS.minRisers;
  s.risers = clamp(Math.round(num(s.risers, def.risers)), minRisers, STAIR_LIMITS.maxRisers);
  s.wellGap = Math.max(0, num(s.wellGap, def.wellGap));
  s.direction = s.direction === 'down' ? 'down' : 'up';

  const breakdown = getFlightBreakdown(stairType, s.risers);
  const maxT = Math.max(1, ...breakdown.map((f) => f.treads));
  const tdLimits = [STAIR_LIMITS.minTreadDepth, STAIR_LIMITS.maxTreadDepth];

  // Legacy objects have no treadDepth: derive it from their stored length so
  // reopening an old project never changes the footprint.
  if (s.treadDepth === undefined || s.treadDepth === null) changed = changed || (s.length ? 'length' : null);

  if (stairType === STAIRCASE_TYPES.L_SHAPED) {
    s.flightWidth = Math.max(STAIR_LIMITS.minFlightWidth, num(s.flightWidth, def.flightWidth));
    const [f1, f2] = breakdown;
    if (changed === 'length' && Number(s.length) > 0) {
      s.treadDepth = (Number(s.length) - s.flightWidth) / Math.max(1, f1.treads);
    } else if (changed === 'width' && Number(s.width) > 0) {
      s.treadDepth = (Number(s.width) - s.flightWidth) / Math.max(1, f2.treads);
    }
    s.treadDepth = clamp(num(s.treadDepth, def.treadDepth), ...tdLimits);
    s.length = s.flightWidth + f1.treads * s.treadDepth;
    s.width = s.flightWidth + f2.treads * s.treadDepth;
    s.landingDepth = s.flightWidth;
  } else if (stairType === STAIRCASE_TYPES.STRAIGHT) {
    s.width = Math.max(STAIR_LIMITS.minFlightWidth, num(s.width, def.width));
    if (changed === 'length' && Number(s.length) > 0) s.treadDepth = Number(s.length) / maxT;
    s.treadDepth = clamp(num(s.treadDepth, def.treadDepth), ...tdLimits);
    s.landingDepth = 0;
    s.length = maxT * s.treadDepth;
    s.flightWidth = s.width;
  } else {
    // Dog-legged / U-shaped: two parallel flights and a full-width landing.
    s.width = Math.max(2 * STAIR_LIMITS.minFlightWidth + s.wellGap, num(s.width, def.width));
    s.landingDepth = Math.max(STAIR_LIMITS.minLanding, num(s.landingDepth, def.landingDepth));
    if (changed === 'length' && Number(s.length) > 0) {
      s.treadDepth = (Number(s.length) - s.landingDepth) / maxT;
    }
    s.treadDepth = clamp(num(s.treadDepth, def.treadDepth), ...tdLimits);
    s.length = maxT * s.treadDepth + s.landingDepth;
    s.flightWidth = (s.width - s.wellGap) / 2;
  }

  s.flights = breakdown.length;
  s.treads = breakdown.reduce((sum, f) => sum + f.treads, 0);
  s.stepsPerFlight = breakdown.map((f) => f.treads);
  s.riserHeight = s.floorHeight / s.risers;

  s.width = round4(s.width);
  s.length = round4(s.length);
  s.treadDepth = round6(s.treadDepth);
  s.flightWidth = round4(s.flightWidth);
  s.landingDepth = round4(s.landingDepth);
  s.riserHeight = round6(s.riserHeight);
  s.wellGap = round6(s.wellGap);
  s.x = round4(num(s.x, 0));
  s.y = round4(num(s.y, 0));
  // Unset optional limits are omitted so the object survives a JSON save/load unchanged.
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
  return s;
}

/**
 * Create a new architectural staircase object
 */
export function createStaircase(params = {}) {
  const stairType = params.stairType || STAIRCASE_TYPES.DOG_LEGGED;
  const def = STAIRCASE_DEFAULTS[stairType] || STAIRCASE_DEFAULTS[STAIRCASE_TYPES.DOG_LEGGED];
  return normalizeStaircase({
    id: params.id || generateUniqueId('stair'),
    label: params.label || 'STAIRCASE',
    stairType,
    x: params.x || 0,
    y: params.y || 0,
    width: params.width || def.width,
    length: params.length,
    rotation: params.rotation || 0,
    floorHeight: params.floorHeight || def.floorHeight,
    risers: params.risers || def.risers,
    treadDepth: params.treadDepth !== undefined ? params.treadDepth : (params.length ? undefined : def.treadDepth),
    landingDepth: params.landingDepth !== undefined ? params.landingDepth : def.landingDepth,
    wellGap: params.wellGap !== undefined ? params.wellGap : def.wellGap,
    flightWidth: params.flightWidth,
    direction: params.direction || 'up',
    // Constraint configuration (see constraintEngine.js)
    anchor: params.anchor || 'none',
    constraintType: params.constraintType || 'fixed',
    minWidth: params.minWidth,
    maxWidth: params.maxWidth,
    minLength: params.minLength,
    maxLength: params.maxLength,
    handrail: params.handrail !== false,
    isLocked: !!params.isLocked,
    color: params.color || '#F8FAFC',
  }, params.length && params.treadDepth === undefined ? 'length' : null);
}

/** World axis-aligned bounding box of a staircase. */
export function getStaircaseBounds(stair) {
  const rot = normalizeRotation(stair?.rotation);
  const w = Number(stair?.width) || 0;
  const l = Number(stair?.length) || 0;
  const swap = rot === 90 || rot === 270;
  return {
    x: Number(stair?.x) || 0,
    y: Number(stair?.y) || 0,
    width: swap ? l : w,
    length: swap ? w : l,
  };
}

/**
 * Which local dimension ('width' | 'length') lies along a world axis
 * ('x' | 'y') for the stair's rotation.
 */
export function stairDimensionForAxis(stair, axis) {
  const rot = normalizeRotation(stair?.rotation);
  const swap = rot === 90 || rot === 270;
  if (axis === 'x') return swap ? 'length' : 'width';
  return swap ? 'width' : 'length';
}

/**
 * Resize a staircase to a new world bounding-box size along one axis.
 * The step count never changes; dependent values are regenerated.
 */
export function resizeStaircaseWorld(stair, axis, newSize) {
  const dim = stairDimensionForAxis(stair, axis);
  return normalizeStaircase({ ...stair, [dim]: Number(newSize) }, dim);
}

/** Rotate by +90 degrees (clockwise) about the bounding-box centre. */
export function rotateStaircase(stair, delta = 90) {
  const b = getStaircaseBounds(stair);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.length / 2;
  const next = normalizeStaircase({ ...stair, rotation: normalizeRotation((stair.rotation || 0) + delta) });
  const nb = getStaircaseBounds(next);
  return { ...next, x: round4(cx - nb.width / 2), y: round4(cy - nb.length / 2) };
}

/**
 * Calculate the geometric parts (outline, flights, tread lines, landings,
 * dividers, walking-line arrow, label) in WORLD coordinates for rendering
 * and export.
 */
export function calculateStaircaseGeometry(input) {
  const stair = normalizeStaircase(input);
  const { width: W, length: L, stairType, treadDepth: td, flightWidth: fw, landingDepth: ld, wellGap } = stair;
  const rot = stair.rotation;
  const bounds = getStaircaseBounds(stair);
  const { x, y } = bounds;

  // local (u across, v along) -> world
  const P = (u, v) => {
    if (rot === 90) return { x: round4(x + (L - v)), y: round4(y + u) };
    if (rot === 180) return { x: round4(x + W - u), y: round4(y + L - v) };
    if (rot === 270) return { x: round4(x + v), y: round4(y + W - u) };
    return { x: round4(x + u), y: round4(y + v) };
  };
  const rectPoly = (u0, v0, u1, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  const seg = (u0, v0, u1, v1) => {
    const a = P(u0, v0);
    const b = P(u1, v1);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  };

  const breakdown = getFlightBreakdown(stairType, stair.risers);
  const flights = [];
  const landings = [];
  const dividers = [];
  let walk = []; // walking line in local coords, entry -> exit

  if (stairType === STAIRCASE_TYPES.STRAIGHT) {
    const t = breakdown[0].treads;
    const treads = [];
    for (let i = 1; i < t; i++) treads.push(seg(0, L - i * td, W, L - i * td));
    flights.push({ index: 1, polygon: rectPoly(0, 0, W, L), treads, treadCount: t, risers: breakdown[0].risers });
    walk = [[W / 2, L - 0.4], [W / 2, 0.4]];
  } else if (stairType === STAIRCASE_TYPES.L_SHAPED) {
    const [f1, f2] = breakdown;
    // Flight 1: left column, climbing from v = L to v = fw
    const t1 = [];
    for (let i = 1; i < f1.treads; i++) t1.push(seg(0, L - i * td, fw, L - i * td));
    flights.push({ index: 1, polygon: rectPoly(0, fw, fw, L), treads: t1, treadCount: f1.treads, risers: f1.risers });
    // Corner landing
    landings.push({ polygon: rectPoly(0, 0, fw, fw) });
    // Flight 2: top row, climbing from u = fw to u = W
    const t2 = [];
    for (let i = 1; i < f2.treads; i++) t2.push(seg(fw + i * td, 0, fw + i * td, fw));
    flights.push({ index: 2, polygon: rectPoly(fw, 0, W, fw), treads: t2, treadCount: f2.treads, risers: f2.risers });
    walk = [[fw / 2, L - 0.4], [fw / 2, fw / 2], [W - 0.4, fw / 2]];
  } else {
    // Dog-legged / U-shaped
    const [f1, f2] = breakdown;
    const u2 = fw + wellGap;
    const t1 = [];
    for (let i = 1; i < f1.treads; i++) t1.push(seg(0, ld + i * td, fw, ld + i * td));
    // Flight 1 climbs from the entry (v = L) to the landing (v = ld)
    const f1Start = ld + f1.treads * td;
    flights.push({ index: 1, polygon: rectPoly(0, ld, fw, f1Start), treads: t1, treadCount: f1.treads, risers: f1.risers });
    landings.push({ polygon: rectPoly(0, 0, W, ld) });
    // Flight 2 descends in plan from the landing back towards the entry side
    const t2 = [];
    for (let i = 1; i < f2.treads; i++) t2.push(seg(u2, ld + i * td, W, ld + i * td));
    const f2End = ld + f2.treads * td;
    flights.push({ index: 2, polygon: rectPoly(u2, ld, W, f2End), treads: t2, treadCount: f2.treads, risers: f2.risers });
    if (wellGap > 0.01) {
      dividers.push(seg(fw, ld, fw, L), seg(u2, ld, u2, L));
    } else {
      dividers.push(seg(fw, ld, fw, L));
    }
    walk = [[fw / 2, L - 0.4], [fw / 2, ld / 2], [u2 + fw / 2, ld / 2], [u2 + fw / 2, f2End - 0.4]];
  }

  if (stair.direction === 'down') walk = walk.slice().reverse();
  const points = walk.map(([u, v]) => P(u, v));
  const tip = points[points.length - 1];
  const prev = points[points.length - 2];
  const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  const hs = 0.45;
  const arrowHead = [
    { x: round4(tip.x - hs * Math.cos(ang - Math.PI / 6)), y: round4(tip.y - hs * Math.sin(ang - Math.PI / 6)) },
    tip,
    { x: round4(tip.x - hs * Math.cos(ang + Math.PI / 6)), y: round4(tip.y - hs * Math.sin(ang + Math.PI / 6)) },
  ];

  const labelLocal = stairType === STAIRCASE_TYPES.STRAIGHT ? [W / 2, L / 2]
    : stairType === STAIRCASE_TYPES.L_SHAPED ? [fw / 2, fw / 2]
      : [W / 2, ld / 2];

  const runs = breakdown.map((f) => round4(f.treads * td));

  return {
    bounds,
    stairType,
    rotation: rot,
    outline: rectPoly(0, 0, W, L),
    flights,
    landings,
    dividers,
    arrow: { points, arrowHead },
    labelPos: P(...labelLocal),
    labelText: stair.direction === 'down' ? 'DN' : 'UP',
    metrics: {
      totalRisers: stair.risers,
      totalTreads: stair.treads,
      flights: breakdown.length,
      landings: Math.max(0, breakdown.length - 1),
      risersPerFlight: breakdown.map((f) => f.risers),
      treadsPerFlight: breakdown.map((f) => f.treads),
      runs,
      riserHeightInches: round4((stair.floorHeight * 12) / stair.risers),
      treadDepthInches: round4(td * 12),
      floorHeight: stair.floorHeight,
    },
    // Back-compat fields used by older callers
    riserHeightInches: round4((stair.floorHeight * 12) / stair.risers),
    treadDepthInches: round4(td * 12),
    totalSteps: stair.treads,
  };
}

/**
 * Drafting-guideline checks for a staircase. These are geometric checks only
 * and do not establish structural safety or code compliance.
 */
export function validateStaircaseFit(stair, layout) {
  const warnings = [];
  const geo = calculateStaircaseGeometry(stair);
  const m = geo.metrics;

  if (m.riserHeightInches > 7.5) {
    warnings.push(`Riser height ${m.riserHeightInches.toFixed(2)}" is above the 7.5" guideline - add risers or reduce floor height.`);
  } else if (m.riserHeightInches < 4) {
    warnings.push(`Riser height ${m.riserHeightInches.toFixed(2)}" is below the 4" guideline.`);
  }
  if (m.treadDepthInches < 10) {
    warnings.push(`Tread depth ${m.treadDepthInches.toFixed(2)}" is below the 10" guideline.`);
  }
  const fw = normalizeStaircase(stair).flightWidth;
  if (fw < 3) {
    warnings.push(`Flight width ${fw.toFixed(2)}' is below the 3' residential guideline.`);
  }

  if (layout?.plot) {
    const W = Number(layout.plot.width) || 0;
    const L = Number(layout.plot.length) || 0;
    const b = geo.bounds;
    const eps = 0.01;
    if (b.x < -eps || b.y < -eps || b.x + b.width > W + eps || b.y + b.length > L + eps) {
      warnings.push(`Staircase extends beyond the plot boundary (${W}' x ${L}').`);
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings,
    metrics: m,
  };
}
