

export const EPS = 1e-9;
const TAU = 360;

export const norm360 = (deg) => ((deg % TAU) + TAU) % TAU;
export const toRad = (deg) => (deg * Math.PI) / 180;
export const toDeg = (rad) => (rad * 180) / Math.PI;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function arcSweep(arc) {
  const s = norm360(arc.end - arc.start);
  return s === 0 ? TAU : s;
}

export function angleOnArc(arc, deg) {
  return norm360(deg - arc.start) <= arcSweep(arc) + 1e-7;
}

export function pointAtAngle(c, deg) {
  return { x: c.cx + c.r * Math.cos(toRad(deg)), y: c.cy + c.r * Math.sin(toRad(deg)) };
}

/** Closest point on a segment, with its parameter t in 0..1. */
export function projectToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { point: q, t, distance: dist(p, q) };
}

/** Infinite line through a,b against infinite line through c,d. Parameters are along each line. */
export function lineLineIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  const span = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  if (span < EPS || Math.abs(denom) / span < 1e-7) return null; // parallel
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  return { x: a.x + t * rx, y: a.y + t * ry, t, u };
}

/** Intersection parameters along the line a->b with a circle (may be outside 0..1). */
export function lineCircleParams(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.cx;
  const fy = a.y - c.cy;
  const A = dx * dx + dy * dy;
  if (A < EPS) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < -EPS) return [];
  const root = Math.sqrt(Math.max(0, disc));
  const t1 = (-B - root) / (2 * A);
  const t2 = (-B + root) / (2 * A);
  return Math.abs(t1 - t2) < 1e-9 ? [t1] : [t1, t2];
}

/** Intersection points of two circles. */
export function circleCircle(c1, c2) {
  const d = Math.hypot(c2.cx - c1.cx, c2.cy - c1.cy);
  if (d < EPS || d > c1.r + c2.r + 1e-9 || d < Math.abs(c1.r - c2.r) - 1e-9) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const mx = c1.cx + (a * (c2.cx - c1.cx)) / d;
  const my = c1.cy + (a * (c2.cy - c1.cy)) / d;
  const ox = (h * (c2.cy - c1.cy)) / d;
  const oy = (h * (c2.cx - c1.cx)) / d;
  const pts = [{ x: mx + ox, y: my - oy }];
  if (h > 1e-9) pts.push({ x: mx - ox, y: my + oy });
  return pts;
}

/** Straight path of an element, or null for curves and rectangle-only elements. */
export function elementPath(el, type) {
  if (type === 'wall') return { points: [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }], closed: false };
  if (type === 'entity') {
    if (el.kind === 'line') return { points: [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }], closed: false };
    if (el.kind === 'polyline' || el.kind === 'polygon') return { points: el.points, closed: !!el.closed };
  }
  return null;
}

/** Circle / arc curve of an element, or null. */
export function elementCurve(el, type) {
  if (type === 'entity' && (el.kind === 'circle' || el.kind === 'arc')) return el;
  return null;
}

export function pathSegments(path) {
  const segs = [];
  const pts = path.points;
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  if (path.closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  return segs;
}

export function pathLength(path) {
  return pathSegments(path).reduce((s, [a, b]) => s + dist(a, b), 0);
}

/** Point at arc-length s along a path. */
export function pointAtLength(path, s) {
  let rem = s;
  const segs = pathSegments(path);
  for (const [a, b] of segs) {
    const L = dist(a, b);
    if (rem <= L + 1e-9) {
      const t = L < EPS ? 0 : Math.min(1, rem / L);
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    rem -= L;
  }
  const last = segs[segs.length - 1];
  return last ? { ...last[1] } : { ...path.points[0] };
}

/** Arc-length position of the closest point on a path. */
export function projectToPath(path, p) {
  let best = null;
  let walked = 0;
  for (const [a, b] of pathSegments(path)) {
    const q = projectToSegment(p, a, b);
    const L = dist(a, b);
    if (!best || q.distance < best.distance) best = { distance: q.distance, s: walked + q.t * L, point: q.point };
    walked += L;
  }
  return best;
}

/** The sub-path between arc-lengths s0 < s1, as an open list of points. */
export function subPath(path, s0, s1) {
  const out = [pointAtLength(path, s0)];
  let walked = 0;
  for (const [a, b] of pathSegments(path)) {
    walked += dist(a, b);
    if (walked > s0 + 1e-7 && walked < s1 - 1e-7) out.push({ ...b });
  }
  out.push(pointAtLength(path, s1));
  return out;
}

/**
 * Arc-length positions where a path crosses a set of cutters.
 * `cutters` are { path } or { curve } objects.
 */
export function pathCuts(path, cutters) {
  const cuts = [];
  let walked = 0;
  for (const [a, b] of pathSegments(path)) {
    const L = dist(a, b);
    for (const c of cutters) {
      if (c.path) {
        for (const [p, q] of pathSegments(c.path)) {
          const hit = lineLineIntersection(a, b, p, q);
          if (hit && hit.t >= -1e-7 && hit.t <= 1 + 1e-7 && hit.u >= -1e-7 && hit.u <= 1 + 1e-7) {
            cuts.push(walked + Math.max(0, Math.min(1, hit.t)) * L);
          }
        }
      } else if (c.curve) {
        for (const t of lineCircleParams(a, b, c.curve)) {
          if (t < -1e-7 || t > 1 + 1e-7) continue;
          const pt = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
          const deg = toDeg(Math.atan2(pt.y - c.curve.cy, pt.x - c.curve.cx));
          if (c.curve.kind !== 'arc' || angleOnArc(c.curve, deg)) cuts.push(walked + t * L);
        }
      }
    }
    walked += L;
  }
  return [...cuts].sort((x, y) => x - y).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 1e-6);
}

/** Angles (degrees) where a curve crosses a set of cutters. */
export function curveCuts(curve, cutters) {
  const onSelf = (deg) => curve.kind !== 'arc' || angleOnArc(curve, deg);
  const out = [];
  const add = (pt) => {
    const deg = norm360(toDeg(Math.atan2(pt.y - curve.cy, pt.x - curve.cx)));
    if (onSelf(deg)) out.push(deg);
  };
  for (const c of cutters) {
    if (c.path) {
      for (const [p, q] of pathSegments(c.path)) {
        for (const t of lineCircleParams(p, q, curve)) {
          if (t >= -1e-7 && t <= 1 + 1e-7) add({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
        }
      }
    } else if (c.curve) {
      for (const pt of circleCircle(curve, c.curve)) {
        const deg = toDeg(Math.atan2(pt.y - c.curve.cy, pt.x - c.curve.cx));
        if (c.curve.kind !== 'arc' || angleOnArc(c.curve, deg)) add(pt);
      }
    }
  }
  return out;
}

/** Offset an open or closed point list by signed distance d (left of travel = +). */
export function offsetPoints(points, closed, d) {
  const n = points.length;
  const lineAt = (i) => {
    const a = points[i];
    const b = points[(i + 1) % n];
    const L = dist(a, b) || 1;
    const nx = -(b.y - a.y) / L;
    const ny = (b.x - a.x) / L;
    return [{ x: a.x + nx * d, y: a.y + ny * d }, { x: b.x + nx * d, y: b.y + ny * d }];
  };
  const segCount = closed ? n : n - 1;
  const lines = [];
  for (let i = 0; i < segCount; i++) lines.push(lineAt(i));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!closed && i === 0) { out.push(lines[0][0]); continue; }
    if (!closed && i === n - 1) { out.push(lines[segCount - 1][1]); continue; }
    const prev = lines[(i - 1 + segCount) % segCount];
    const next = lines[i % segCount];
    const hit = lineLineIntersection(prev[0], prev[1], next[0], next[1]);
    out.push(hit ? { x: hit.x, y: hit.y } : prev[1]);
  }
  return out;
}

/** Distance from a point to an element's outline. */
export function distanceToOutline(p, el, type) {
  const path = elementPath(el, type);
  if (path) return projectToPath(path, p)?.distance ?? Infinity;
  const curve = elementCurve(el, type);
  if (curve) {
    const deg = toDeg(Math.atan2(p.y - curve.cy, p.x - curve.cx));
    const radial = Math.abs(Math.hypot(p.x - curve.cx, p.y - curve.cy) - curve.r);
    if (curve.kind !== 'arc' || angleOnArc(curve, deg)) return radial;
    return Math.min(dist(p, pointAtAngle(curve, curve.start)), dist(p, pointAtAngle(curve, curve.end)));
  }
  return Infinity;
}

/** World bounding box of a CAD entity. */
export function entityBounds(el) {
  if (el.kind === 'line') {
    return { minX: Math.min(el.x1, el.x2), minY: Math.min(el.y1, el.y2), maxX: Math.max(el.x1, el.x2), maxY: Math.max(el.y1, el.y2) };
  }
  if (el.kind === 'polyline' || el.kind === 'polygon') {
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (el.kind === 'circle') {
    return { minX: el.cx - el.r, minY: el.cy - el.r, maxX: el.cx + el.r, maxY: el.cy + el.r };
  }
  // Arc: endpoints plus any axis extreme inside the sweep
  const pts = [pointAtAngle(el, el.start), pointAtAngle(el, el.end)];
  for (const deg of [0, 90, 180, 270]) if (angleOnArc(el, deg)) pts.push(pointAtAngle(el, deg));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Length of a line/polyline/polygon outline or arc; circumference for a circle. */
export function entityLength(el) {
  const path = elementPath(el, 'entity');
  if (path) return pathLength(path);
  if (el.kind === 'circle') return 2 * Math.PI * el.r;
  return (toRad(arcSweep(el))) * el.r;
}

/** Enclosed area of a polygon or circle; 0 for open shapes. */
export function entityArea(el) {
  if (el.kind === 'circle') return Math.PI * el.r * el.r;
  if (el.kind !== 'polygon') return 0;
  let s = 0;
  const pts = el.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Three points -> circle through them, or null when collinear. */
export function circleThroughThree(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}
