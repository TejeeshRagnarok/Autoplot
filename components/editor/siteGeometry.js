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
