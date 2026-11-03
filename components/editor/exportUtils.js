/**
 * AutoPlot Architectural Plan Export Utilities
 * Generates:
 * - High-Resolution Architectural PNG with Title Block & North Arrow
 * - Clean Scalable Vector Graphics (SVG)
 * - Browser Print Window trigger
 */

import { formatMeasurement, formatArea } from './units.js';
import { calculateStaircaseGeometry } from './staircaseGeometry.js';
import { getOpeningGeometry } from './wallOps.js';
import { arcSweep, pointAtAngle } from './cadGeometry.js';
import { dimensionLine } from './selectionModel.js';
import { isPlotDimension } from './cadCommands.js';

const xmlText = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Generate full SVG string for the entire layout
 * @param {object} layout
 * @param {string} unit
 * @returns {string} SVG xml content
 */
export function generateLayoutSVG(layout, unit = 'ft-in') {
  if (!layout) return '';

  const plotW = layout.plot?.width || 30;
  const plotL = layout.plot?.length || 40;
  const scale = 20; // 20 px per foot
  const padding = 100;

  const svgW = plotW * scale + padding * 2;
  const svgH = plotL * scale + padding * 2 + 80; // Extra room for title block

  const originX = padding;
  const originY = padding;

  let elementsSvg = '';

  // 1. Grid
  elementsSvg += `<g opacity="0.15">`;
  for (let x = 0; x <= plotW; x += 2) {
    elementsSvg += `<line x1="${originX + x * scale}" y1="${originY}" x2="${originX + x * scale}" y2="${originY + plotL * scale}" stroke="#64748B" stroke-width="0.5"/>`;
  }
  for (let y = 0; y <= plotL; y += 2) {
    elementsSvg += `<line x1="${originX}" y1="${originY + y * scale}" x2="${originX + plotW * scale}" y2="${originY + y * scale}" stroke="#64748B" stroke-width="0.5"/>`;
  }
  elementsSvg += `</g>`;

  // 2. Plot boundary
  elementsSvg += `
    <rect x="${originX}" y="${originY}" width="${plotW * scale}" height="${plotL * scale}" 
      fill="#FFFFFF" stroke="#D97706" stroke-width="3" stroke-dasharray="6,4"/>
  `;

  // 2b. Setback line (buildable area)
  const sb = layout.plot?.setbacks || {};
  const bx0 = Number(sb.west) || 0;
  const by0 = Number(sb.north) || 0;
  const bw = plotW - bx0 - (Number(sb.east) || 0);
  const bl = plotL - by0 - (Number(sb.south) || 0);
  if (bw > 0 && bl > 0) {
    elementsSvg += `<rect x="${originX + bx0 * scale}" y="${originY + by0 * scale}" width="${bw * scale}" height="${bl * scale}" fill="none" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3,3"/>`;
  }

  // 3. Rooms
  (layout.rooms || []).forEach(room => {
    const rx = originX + room.x * scale;
    const ry = originY + room.y * scale;
    const rw = room.width * scale;
    const rh = room.length * scale;
    const area = room.width * room.length;

    elementsSvg += `
      <g>
        <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${room.color || '#F8FAFC'}" stroke="#CBD5E1" stroke-width="1"/>
        <text x="${rx + rw / 2}" y="${ry + rh / 2 - 8}" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#1E293B" text-anchor="middle">
          ${xmlText(room.name || 'Room')}
        </text>
        <text x="${rx + rw / 2}" y="${ry + rh / 2 + 8}" font-family="Arial, sans-serif" font-size="10" fill="#64748B" text-anchor="middle">
          ${formatMeasurement(room.width, unit)} × ${formatMeasurement(room.length, unit)}
        </text>
        <text x="${rx + rw / 2}" y="${ry + rh / 2 + 22}" font-family="Arial, sans-serif" font-size="9" font-weight="600" fill="#0284C7" text-anchor="middle">
          ${formatArea(area, unit)}
        </text>
      </g>
    `;
  });

  // 4. Utilities, Parking & Stairs
  (layout.parking || []).forEach(p => {
    elementsSvg += `
      <g>
        <rect x="${originX + p.x * scale}" y="${originY + p.y * scale}" width="${p.width * scale}" height="${p.length * scale}" 
          fill="#F1F5F9" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="4,3"/>
        <text x="${originX + (p.x + p.width / 2) * scale}" y="${originY + (p.y + p.length / 2) * scale}" 
          font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#64748B" text-anchor="middle">
          ${xmlText(p.label || 'PARKING')}
        </text>
      </g>
    `;
  });

  (layout.utilities || []).forEach(u => {
    elementsSvg += `
      <g>
        <rect x="${originX + u.x * scale}" y="${originY + u.y * scale}" width="${u.width * scale}" height="${u.length * scale}" 
          fill="#E0F2FE" stroke="#0284C7" stroke-width="1.5"/>
        <text x="${originX + (u.x + u.width / 2) * scale}" y="${originY + (u.y + u.length / 2) * scale + 4}" 
          font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#0369A1" text-anchor="middle">
          ${xmlText(u.name || 'Utility')}
        </text>
      </g>
    `;
  });

  (layout.staircases || []).forEach(s => {
    // Steps are regenerated from the staircase parameters, exactly as on the canvas.
    const geo = calculateStaircaseGeometry(s);
    const X = (x) => originX + x * scale;
    const Y = (y) => originY + y * scale;
    const pts = (poly) => poly.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
    const ln = (l, stroke, w) => `<line x1="${X(l.x1)}" y1="${Y(l.y1)}" x2="${X(l.x2)}" y2="${Y(l.y2)}" stroke="${stroke}" stroke-width="${w}"/>`;
    elementsSvg += `<g><polygon points="${pts(geo.outline)}" fill="#F8FAFC" stroke="#475569" stroke-width="1.5"/>`;
    geo.landings.forEach((l) => { elementsSvg += `<polygon points="${pts(l.polygon)}" fill="#EEF2F7" stroke="#64748B" stroke-width="1"/>`; });
    geo.flights.forEach((f) => {
      elementsSvg += `<polygon points="${pts(f.polygon)}" fill="none" stroke="#64748B" stroke-width="1"/>`;
      f.treads.forEach((t) => { elementsSvg += ln(t, '#94A3B8', 1); });
    });
    geo.dividers.forEach((d) => { elementsSvg += ln(d, '#334155', 1.5); });
    elementsSvg += `<polyline points="${pts(geo.arrow.points)}" fill="none" stroke="#0F172A" stroke-width="1.2"/>`;
    elementsSvg += `<polyline points="${pts(geo.arrow.arrowHead)}" fill="none" stroke="#0F172A" stroke-width="1.2"/>`;
    elementsSvg += `
        <text x="${X(geo.labelPos.x)}" y="${Y(geo.labelPos.y) + 3}" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#0F172A" text-anchor="middle">
          ${xmlText(s.label || 'STAIRS')} ${geo.labelText} (${geo.metrics.totalRisers}R / ${geo.metrics.totalTreads}T)
        </text>
      </g>
    `;
  });

  // 5. Walls
  (layout.walls || []).forEach(w => {
    const x1 = originX + w.x1 * scale;
    const y1 = originY + w.y1 * scale;
    const x2 = originX + w.x2 * scale;
    const y2 = originY + w.y2 * scale;
    const strokeW = Math.max(2, (w.thickness || 0.75) * scale);
    elementsSvg += `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0F172A" stroke-width="${strokeW}" stroke-linecap="round"/>
    `;
  });

  // 6. Doors & Windows (same geometry as the canvas: on the host wall, with hinge and swing)
  const SX = (x) => originX + x * scale;
  const SY = (y) => originY + y * scale;
  (layout.doors || []).forEach(d => {
    const g = getOpeningGeometry(d, layout.walls);
    const gap = Math.max(2, g.thickness * scale) + 1;
    elementsSvg += `<g><line x1="${SX(g.a.x)}" y1="${SY(g.a.y)}" x2="${SX(g.b.x)}" y2="${SY(g.b.y)}" stroke="#FFFFFF" stroke-width="${gap}"/>`;
    g.leaves.forEach((leaf) => {
      const r = leaf.radius * scale;
      const cross = (leaf.tip.x - leaf.hinge.x) * (leaf.free.y - leaf.hinge.y) - (leaf.tip.y - leaf.hinge.y) * (leaf.free.x - leaf.hinge.x);
      elementsSvg += `<line x1="${SX(leaf.hinge.x)}" y1="${SY(leaf.hinge.y)}" x2="${SX(leaf.tip.x)}" y2="${SY(leaf.tip.y)}" stroke="#B45309" stroke-width="2"/>`;
      elementsSvg += `<path d="M ${SX(leaf.tip.x)} ${SY(leaf.tip.y)} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${SX(leaf.free.x)} ${SY(leaf.free.y)}" fill="none" stroke="#B45309" stroke-width="1.2" stroke-dasharray="3,3"/>`;
    });
    if (d.type === 'sliding') {
      elementsSvg += `<line x1="${SX(g.a.x)}" y1="${SY(g.a.y)}" x2="${SX(g.b.x)}" y2="${SY(g.b.y)}" stroke="#B45309" stroke-width="2"/>`;
    }
    elementsSvg += '</g>';
  });

  (layout.windows || []).forEach(win => {
    const g = getOpeningGeometry(win, layout.walls);
    const h = Math.max(1.5, (g.thickness * scale) / 2);
    const ax = SX(g.a.x); const ay = SY(g.a.y); const bx = SX(g.b.x); const by = SY(g.b.y);
    const nx = g.nx * h; const ny = g.ny * h;
    elementsSvg += `
      <g>
        <polygon points="${ax + nx},${ay + ny} ${bx + nx},${by + ny} ${bx - nx},${by - ny} ${ax - nx},${ay - ny}" fill="#BAE6FD" stroke="#0284C7" stroke-width="1.5"/>
        <text x="${SX(win.x)}" y="${SY(win.y) + 3}" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="#0369A1" text-anchor="middle">
          ${win.isBathroom || win.type === 'ventilator' ? 'V' : 'W'}
        </text>
      </g>
    `;
  });

  // 6b. Columns, CAD entities, user dimensions and text
  (layout.columns || []).forEach((c) => {
    const size = (c.size || 0.75) * scale;
    elementsSvg += c.shape === 'round'
      ? `<circle cx="${SX(c.x)}" cy="${SY(c.y)}" r="${size / 2}" fill="#475569"/>`
      : `<rect x="${SX(c.x) - size / 2}" y="${SY(c.y) - size / 2}" width="${size}" height="${size}" fill="#475569"/>`;
  });
  (layout.cadEntities || []).forEach((ent) => {
    const stroke = `fill="none" stroke="${ent.color || '#0F172A'}" stroke-width="1.5"`;
    if (ent.kind === 'line') {
      elementsSvg += `<line x1="${SX(ent.x1)}" y1="${SY(ent.y1)}" x2="${SX(ent.x2)}" y2="${SY(ent.y2)}" ${stroke}/>`;
    } else if (ent.points) {
      const pts = ent.points.map((p) => `${SX(p.x)},${SY(p.y)}`).join(' ');
      elementsSvg += ent.closed ? `<polygon points="${pts}" ${stroke}/>` : `<polyline points="${pts}" ${stroke}/>`;
    } else if (ent.kind === 'circle') {
      elementsSvg += `<circle cx="${SX(ent.cx)}" cy="${SY(ent.cy)}" r="${ent.r * scale}" ${stroke}/>`;
    } else {
      const a = pointAtAngle(ent, ent.start);
      const b = pointAtAngle(ent, ent.end);
      const r = ent.r * scale;
      elementsSvg += `<path d="M ${SX(a.x)} ${SY(a.y)} A ${r} ${r} 0 ${arcSweep(ent) > 180 ? 1 : 0} 1 ${SX(b.x)} ${SY(b.y)}" ${stroke}/>`;
    }
  });
  (layout.dimensions || []).filter((d) => !isPlotDimension(d.id)).forEach((d) => {
    const l = dimensionLine(d);
    const text = formatMeasurement(Math.hypot(d.x2 - d.x1, d.y2 - d.y1), unit);
    elementsSvg += `<line x1="${SX(d.x1)}" y1="${SY(d.y1)}" x2="${SX(l.x1)}" y2="${SY(l.y1)}" stroke="#B45309" stroke-width="0.8"/>`;
    elementsSvg += `<line x1="${SX(d.x2)}" y1="${SY(d.y2)}" x2="${SX(l.x2)}" y2="${SY(l.y2)}" stroke="#B45309" stroke-width="0.8"/>`;
    elementsSvg += `<line x1="${SX(l.x1)}" y1="${SY(l.y1)}" x2="${SX(l.x2)}" y2="${SY(l.y2)}" stroke="#B45309" stroke-width="1.2"/>`;
    elementsSvg += `<text x="${(SX(l.x1) + SX(l.x2)) / 2}" y="${(SY(l.y1) + SY(l.y2)) / 2 - 5}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#B45309" text-anchor="middle">${xmlText(text)}</text>`;
  });
  (layout.annotations || []).forEach((a) => {
    elementsSvg += `<text x="${SX(a.x)}" y="${SY(a.y)}" font-family="Arial, sans-serif" font-size="${a.fontSize || 12}" fill="${a.color || '#334155'}">${xmlText(a.text)}</text>`;
  });

  // 7. Title Block & North Compass
  const titleBlockY = originY + plotL * scale + 24;
  const compassX = svgW - padding - 30;
  const compassY = padding - 40;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" style="background-color: #F8FAFC;">
      <defs>
        <style>
          .txt-title { font-family: 'Segoe UI', Arial, sans-serif; font-size: 16px; font-weight: 800; fill: #070262; }
          .txt-meta { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; fill: #64748B; }
          .txt-bold { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 700; fill: #1E293B; }
        </style>
      </defs>

      <!-- Elements -->
      ${elementsSvg}

      <!-- North Arrow Indicator -->
      <g transform="translate(${compassX}, ${compassY}) rotate(${layout.plot?.compassAngle || 0})">
        <circle cx="0" cy="0" r="18" fill="#FFFFFF" stroke="#070262" stroke-width="1.5"/>
        <polygon points="0,-14 5,4 0,0 -5,4" fill="#DC2626"/>
        <polygon points="0,14 5,-4 0,0 -5,-4" fill="#070262"/>
        <text x="0" y="-18" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#DC2626" text-anchor="middle">N</text>
      </g>

      <!-- Architectural Title Block -->
      <g transform="translate(${originX}, ${titleBlockY})">
        <rect x="0" y="0" width="${plotW * scale}" height="64" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.5" rx="4"/>
        <line x1="${plotW * scale * 0.5}" y1="0" x2="${plotW * scale * 0.5}" y2="64" stroke="#CBD5E1" stroke-width="1"/>
        <line x1="${plotW * scale * 0.75}" y1="0" x2="${plotW * scale * 0.75}" y2="64" stroke="#CBD5E1" stroke-width="1"/>

        <!-- Project & Client -->
        <text x="16" y="24" class="txt-title">${xmlText(layout.title || 'AUTOPLOT ARCHITECTURAL PLAN')}</text>
        <text x="16" y="44" class="txt-meta">Client: <tspan class="txt-bold">${xmlText(layout.ownerName || 'Client')}</tspan> | Facing: <tspan class="txt-bold">${xmlText(layout.plot?.facing || 'North')}</tspan></text>

        <!-- Plot Dimensions -->
        <text x="${plotW * scale * 0.5 + 16}" y="24" class="txt-bold">Plot: ${formatMeasurement(plotW, unit)} × ${formatMeasurement(plotL, unit)}</text>
        <text x="${plotW * scale * 0.5 + 16}" y="44" class="txt-meta">Area: ${formatArea(plotW * plotL, unit)}</text>

        <!-- Date & Stamp -->
        <text x="${plotW * scale * 0.75 + 16}" y="24" class="txt-bold">SCALE: 1:50</text>
        <text x="${plotW * scale * 0.75 + 16}" y="44" class="txt-meta">Date: ${new Date().toLocaleDateString()}</text>
      </g>
    </svg>
  `;
}

/**
 * Download SVG file
 */
export function exportAsSVG(layout, unit = 'ft-in') {
  if (typeof window === 'undefined') return;
  try {
    const svgStr = generateLayoutSVG(layout, unit);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(layout.title || 'autoplot-plan').toLowerCase().replace(/\s+/g, '-')}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error exporting SVG:', err);
  }
}

/**
 * Export high-resolution PNG image
 */
export function exportAsPNG(layout, unit = 'ft-in') {
  if (typeof window === 'undefined') return;
  try {
    const svgStr = generateLayoutSVG(layout, unit);
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const pixelRatio = 2; // High-DPI 2x
      canvas.width = img.width * pixelRatio || 1600;
      canvas.height = img.height * pixelRatio || 1200;
      const ctx = canvas.getContext('2d');
      ctx.scale(pixelRatio, pixelRatio);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `${(layout.title || 'autoplot-plan').toLowerCase().replace(/\s+/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    };

    img.src = url;
  } catch (err) {
    console.error('Error exporting PNG:', err);
  }
}

/**
 * Trigger clean browser print preview
 */
export function printLayoutPlan(layout, unit = 'ft-in') {
  if (typeof window === 'undefined') return;
  try {
    const svgContent = generateLayoutSVG(layout, unit);
    const printWindow = window.open('', '_blank', 'width=1000,height=800');
    if (!printWindow) {
      alert('Please allow popups to open print preview.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${layout.title || 'Architectural Layout Plan'}</title>
          <style>
            @page { size: landscape; margin: 10mm; }
            body { margin: 0; padding: 20px; font-family: sans-serif; display: flex; justify-content: center; align-items: center; }
            .print-container { width: 100%; max-width: 95vw; }
            svg { width: 100%; height: auto; max-height: 90vh; }
          </style>
        </head>
        <body>
          <div class="print-container">
            ${svgContent}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 400);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  } catch (err) {
    console.error('Error triggering print:', err);
  }
}
