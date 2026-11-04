/**
 * AutoPlot site boundary geometry.
 *
 * The plot is a rectangle in the same world coordinates as the building. Its
 * top-left corner is (plot.originX, plot.originY), which is (0, 0) until the
 * west or north edge is moved. That lets any edge move without touching a
 * single building coordinate. Always read the boundary through getPlotRect.
 */

const DEFAULT_SIZE = { width: 30, length: 40 };

/**
 * World-space rectangle of the plot.
 * @param {object} layout
 * @param {{width:number, length:number}} fallback size used when the plot has none
 * @returns {{x0:number, y0:number, x1:number, y1:number, width:number, length:number}}
 */
export function getPlotRect(layout, fallback = DEFAULT_SIZE) {
  const plot = layout?.plot || {};
  const width = Number(plot.width) || fallback.width;
  const length = Number(plot.length) || fallback.length;
  const x0 = Number(plot.originX) || 0;
  const y0 = Number(plot.originY) || 0;
  return { x0, y0, x1: x0 + width, y1: y0 + length, width, length };
}

const ROAD_DEPTH = 1.2; // ft as drawn: a marker for where the road is, not its real width

/**
 * Where the road marker(s) are drawn, in world coordinates, from the plot's
 * road direction. Each sits outside the plot, beyond the dimension line on that
 * side. Purely a site marker: it never affects the plot or the building.
 * @returns {{side:string, x:number, y:number, width:number, length:number}[]}
 */
export function getRoadBands(layout) {
  const road = String(layout?.plot?.roadDirection || '');
  let sides = ['North', 'South', 'East', 'West'].filter((s) => road.includes(s));
  if (/Corner E ?\+ ?N/.test(road)) sides = ['North', 'East'];
  else if (/Corner W ?\+ ?S/.test(road)) sides = ['South', 'West'];

  const { x0, y0, x1, y1, width, length } = getPlotRect(layout);
  const offsetOf = (id) => Math.abs(Number((layout?.dimensions || []).find((d) => d.id === id)?.offset)) || 2.5;
  const place = {
    North: () => ({ x: x0, y: y0 - offsetOf('dim-plot-width') - 0.7 - ROAD_DEPTH, width, length: ROAD_DEPTH }),
    South: () => ({ x: x0, y: y1 + 0.3, width, length: ROAD_DEPTH }),
    // Beyond the length dimension's label, which is wider than the width label is tall.
    West: () => ({ x: x0 - offsetOf('dim-plot-length') - 1.9 - ROAD_DEPTH, y: y0, width: ROAD_DEPTH, length }),
    // Beyond the north arrow on drawings.
    East: () => ({ x: x1 + 3.6, y: y0, width: ROAD_DEPTH, length }),
  };
  return sides.map((side) => ({ side, ...place[side]() }));
}

// ---------------------------------------------------------------------------
// Plot boundary walls
//
// Four walls, one per side, stored on the plot as plot.boundaryWalls in inches.
// They are site geometry, kept apart from layout.walls so no building edit or
// reflow ever sees them. The outer face is the plot boundary and thickness grows
// inward, so the plot's width and length never depend on them.
// ---------------------------------------------------------------------------

export const PLOT_WALL_SIDES = ['north', 'south', 'east', 'west'];
export const DEFAULT_PLOT_WALL_THICKNESS_IN = 6;

/** Thickness of each plot wall in inches; older projects stored none. */
export function getPlotWallThicknesses(layout) {
  const stored = layout?.plot?.boundaryWalls || {};
  const out = {};
  for (const side of PLOT_WALL_SIDES) {
    const value = Number(stored[side]);
    out[side] = Number.isFinite(value) && value > 0 ? value : DEFAULT_PLOT_WALL_THICKNESS_IN;
  }
  return out;
}

/** The rectangle inside the plot walls' inner faces, in world coordinates. */
export function getPlotInnerRect(layout) {
  const { x0, y0, x1, y1 } = getPlotRect(layout);
  const t = getPlotWallThicknesses(layout);
  const inner = {
    x0: x0 + t.west / 12,
    y0: y0 + t.north / 12,
    x1: x1 - t.east / 12,
    y1: y1 - t.south / 12,
  };
  return { ...inner, width: inner.x1 - inner.x0, length: inner.y1 - inner.y0 };
}

/**
 * Outline of each plot wall. Neighbouring walls meet along the line from the
 * outer corner to the inner corner, so walls of any thickness close exactly,
 * with no gap or overlap.
 * @returns {Object<string, {x:number,y:number}[]>} polygon per side
 */
export function getPlotWallPolygons(layout) {
  const o = getPlotRect(layout);
  const i = getPlotInnerRect(layout);
  return {
    north: [{ x: o.x0, y: o.y0 }, { x: o.x1, y: o.y0 }, { x: i.x1, y: i.y0 }, { x: i.x0, y: i.y0 }],
    south: [{ x: i.x0, y: i.y1 }, { x: i.x1, y: i.y1 }, { x: o.x1, y: o.y1 }, { x: o.x0, y: o.y1 }],
    east: [{ x: i.x1, y: i.y0 }, { x: o.x1, y: o.y0 }, { x: o.x1, y: o.y1 }, { x: i.x1, y: i.y1 }],
    west: [{ x: o.x0, y: o.y0 }, { x: i.x0, y: i.y0 }, { x: i.x0, y: i.y1 }, { x: o.x0, y: o.y1 }],
  };
}

/**
 * Style for a plain view drawing all four plot walls, for screens without SVG.
 * Borders of different widths meet on a diagonal, like getPlotWallPolygons.
 */
export function getPlotWallBorderStyle(layout, pxPerFt, color = '#64748B') {
  const t = getPlotWallThicknesses(layout);
  return {
    borderTopWidth: (t.north / 12) * pxPerFt,
    borderBottomWidth: (t.south / 12) * pxPerFt,
    borderRightWidth: (t.east / 12) * pxPerFt,
    borderLeftWidth: (t.west / 12) * pxPerFt,
    borderColor: color,
  };
}

/** The selection data for one plot wall. */
export function getPlotWallData(layout, side) {
  return { id: `plot-wall-${side}`, side, thicknessInches: getPlotWallThicknesses(layout)[side] };
}

/**
 * Which plot wall is at a world point, or null. `tol` keeps thin walls clickable.
 * In a corner, the side is chosen by the same diagonal the walls are drawn with.
 */
export function findPlotWallAt(layout, wx, wy, tol = 0) {
  if (!layout?.plot) return null;
  const o = getPlotRect(layout);
  const inX = wx >= o.x0 - tol && wx <= o.x1 + tol;
  const inY = wy >= o.y0 - tol && wy <= o.y1 + tol;
  if (!inX || !inY) return null;
  const t = getPlotWallThicknesses(layout);
  const depth = { north: wy - o.y0, south: o.y1 - wy, west: wx - o.x0, east: o.x1 - wx };
  let best = null;
  for (const side of PLOT_WALL_SIDES) {
    const feet = t[side] / 12;
    if (depth[side] > feet + tol) continue;
    const ratio = depth[side] / feet;
    if (!best || ratio < best.ratio) best = { side, ratio };
  }
  return best ? best.side : null;
}
