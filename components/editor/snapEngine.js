/**
 * AutoPlot Point Snapping
 *
 * Resolves a pointer position to the geometric point it means. The tolerance is
 * in screen pixels, so snapping feels the same at every zoom. Stronger snap kinds
 * win over weaker ones; among equals the closest wins. When snapping is off, or
 * nothing is in range, the raw point comes back untouched so that intentional
 * free placement always stays possible.
 */

import { dist, elementPath, pathSegments, projectToSegment, lineLineIntersection, pointAtAngle, angleOnArc } from './cadGeometry.js';
import { snapValue } from './layoutModel.js';
import { getPlotRect } from './siteGeometry.js';

export const SNAP_KINDS = {
  ENDPOINT: 'endpoint',
  INTERSECTION: 'intersection',
  MIDPOINT: 'midpoint',
  CENTER: 'center',
  PERPENDICULAR: 'perpendicular',
  WALL: 'wall',
  ROOM_EDGE: 'room-edge',
  SITE: 'site',
  GRID: 'grid',
};

const STRENGTH = {
  endpoint: 90,
  intersection: 85,
  midpoint: 70,
  center: 70,
  perpendicular: 60,
  wall: 40,
  'room-edge': 35,
  site: 30,
  grid: 0,
};

const LABELS = {
  endpoint: 'Endpoint',
  intersection: 'Intersection',
  midpoint: 'Midpoint',
  center: 'Center',
  perpendicular: 'Perpendicular',
  wall: 'On wall',
  'room-edge': 'Room edge',
  site: 'Site boundary',
  grid: 'Grid',
};

const rectEdges = (x, y, w, l) => [
  [{ x, y }, { x: x + w, y }],
  [{ x: x + w, y }, { x: x + w, y: y + l }],
  [{ x: x + w, y: y + l }, { x, y: y + l }],
  [{ x, y: y + l }, { x, y }],
];

/**
 * @param {{x,y}} point raw world point
 * @param {object} layout
 * @param {object} options
 *   scale            px per foot
 *   pixelTolerance   snap radius in screen pixels
 *   snapEnabled      master switch
 *   snapStep         grid step (ft)
 *   from             previous point of the shape being drawn (enables perpendicular)
 *   excludeWallId    wall being edited (it must not snap to itself)
 *   excludeEntityId  entity being edited
 * @returns {{x, y, kind, label}} kind is null when the point was not snapped
 */
export function findPointSnap(point, layout, options = {}) {
  const { scale = 18, pixelTolerance = 12, snapEnabled = true, snapStep = 0.5, from = null, excludeWallId = null, excludeEntityId = null } = options;
  const raw = { x: point.x, y: point.y, kind: null, label: null };
  if (!snapEnabled || !layout) return raw;

  const tol = pixelTolerance / Math.max(1e-6, scale);
  let best = null;
  const offer = (x, y, kind) => {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d > tol) return;
    const s = STRENGTH[kind];
    if (!best || s > best.strength || (s === best.strength && d < best.distance)) {
      best = { x, y, kind, label: LABELS[kind], strength: s, distance: d };
    }
  };

  // A point on a horizontal or vertical edge also lands on the grid along that
  // edge, so a snapped point gives clean dimensions. Oblique edges keep the projection.
  const offerOnSegment = (q, a, b, kind) => {
    const inRange = (v, p, r) => v >= Math.min(p, r) && v <= Math.max(p, r);
    let { x, y } = q;
    if (Math.abs(a.y - b.y) < 1e-6) {
      const gx = snapValue(x, snapStep);
      if (inRange(gx, a.x, b.x)) x = gx;
    } else if (Math.abs(a.x - b.x) < 1e-6) {
      const gy = snapValue(y, snapStep);
      if (inRange(gy, a.y, b.y)) y = gy;
    }
    offer(x, y, kind);
  };

  const nearSegs = []; // straight segments close to the pointer, for intersections
  const offerSegment = (a, b, kind, endKind = SNAP_KINDS.ENDPOINT) => {
    if (endKind) {
      offer(a.x, a.y, endKind);
      offer(b.x, b.y, endKind);
    }
    offer((a.x + b.x) / 2, (a.y + b.y) / 2, SNAP_KINDS.MIDPOINT);
    const q = projectToSegment(point, a, b);
    if (q.distance <= tol) {
      nearSegs.push([a, b]);
      if (kind) offerOnSegment(q.point, a, b, kind);
    }
    if (from) {
      const f = projectToSegment(from, a, b);
      if (dist(from, f.point) > 1e-6 && f.t > 0 && f.t < 1) offer(f.point.x, f.point.y, SNAP_KINDS.PERPENDICULAR);
    }
  };

  for (const w of layout.walls || []) {
    if (w.id === excludeWallId) continue;
    offerSegment({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }, SNAP_KINDS.WALL);
  }
  for (const e of layout.cadEntities || []) {
    if (e.id === excludeEntityId) continue;
    const path = elementPath(e, 'entity');
    if (path) {
      for (const [a, b] of pathSegments(path)) offerSegment(a, b, SNAP_KINDS.WALL);
    } else {
      offer(e.cx, e.cy, SNAP_KINDS.CENTER);
      if (e.kind === 'arc') {
        const s = pointAtAngle(e, e.start);
        const n = pointAtAngle(e, e.end);
        offer(s.x, s.y, SNAP_KINDS.ENDPOINT);
        offer(n.x, n.y, SNAP_KINDS.ENDPOINT);
      }
      const dr = Math.hypot(point.x - e.cx, point.y - e.cy);
      if (dr > 1e-6) {
        const deg = (Math.atan2(point.y - e.cy, point.x - e.cx) * 180) / Math.PI;
        if (e.kind !== 'arc' || angleOnArc(e, deg)) {
          offer(e.cx + ((point.x - e.cx) * e.r) / dr, e.cy + ((point.y - e.cy) * e.r) / dr, SNAP_KINDS.WALL);
        }
      }
    }
  }
  for (const r of layout.rooms || []) {
    offer(r.x + r.width / 2, r.y + r.length / 2, SNAP_KINDS.CENTER);
    for (const [a, b] of rectEdges(r.x, r.y, r.width, r.length)) offerSegment(a, b, SNAP_KINDS.ROOM_EDGE);
  }
  for (const c of layout.columns || []) offer(c.x, c.y, SNAP_KINDS.CENTER);

  if (layout.plot) {
    const site = getPlotRect(layout, { width: 0, length: 0 });
    for (const [a, b] of rectEdges(site.x0, site.y0, site.width, site.length)) {
      offer(a.x, a.y, SNAP_KINDS.ENDPOINT);
      offer((a.x + b.x) / 2, (a.y + b.y) / 2, SNAP_KINDS.MIDPOINT);
      const q = projectToSegment(point, a, b);
      if (q.distance <= tol) {
        nearSegs.push([a, b]);
        offerOnSegment(q.point, a, b, SNAP_KINDS.SITE);
      }
    }
  }

  for (let i = 0; i < nearSegs.length; i++) {
    for (let j = i + 1; j < nearSegs.length; j++) {
      const [a, b] = nearSegs[i];
      const [c, d] = nearSegs[j];
      const hit = lineLineIntersection(a, b, c, d);
      if (hit && hit.t >= -1e-6 && hit.t <= 1 + 1e-6 && hit.u >= -1e-6 && hit.u <= 1 + 1e-6) {
        offer(hit.x, hit.y, SNAP_KINDS.INTERSECTION);
      }
    }
  }

  if (best) return { x: best.x, y: best.y, kind: best.kind, label: best.label };
  return {
    x: snapValue(point.x, snapStep),
    y: snapValue(point.y, snapStep),
    kind: SNAP_KINDS.GRID,
    label: LABELS.grid,
  };
}
