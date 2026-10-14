/**
 * AutoPlot Architectural Plan Export Utilities
 * Generates:
 * - High-Resolution Architectural PNG with Title Block & North Arrow
 * - Clean Scalable Vector Graphics (SVG)
 * - Browser Print Window trigger
 */

import { formatMeasurement, formatArea } from './units';

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
          ${room.name || 'Room'}
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
          ${p.label || 'PARKING'}
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
          ${u.name || 'Utility'}
        </text>
      </g>
    `;
  });

  (layout.staircases || []).forEach(s => {
    const sx = originX + s.x * scale;
    const sy = originY + s.y * scale;
    const sw = s.width * scale;
    const sh = s.length * scale;
    elementsSvg += `
      <g>
        <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="#F8FAFC" stroke="#475569" stroke-width="1.5"/>
    `;
    const steps = s.steps || 12;
    for (let i = 1; i < steps; i++) {
      elementsSvg += `<line x1="${sx}" y1="${sy + (sh / steps) * i}" x2="${sx + sw}" y2="${sy + (sh / steps) * i}" stroke="#94A3B8" stroke-width="1"/>`;
    }
    elementsSvg += `
        <text x="${sx + sw / 2}" y="${sy + sh / 2}" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#0F172A" text-anchor="middle">
          ${s.label || 'STAIRS'}
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

  // 6. Doors & Windows
  (layout.doors || []).forEach(d => {
    const dx = originX + d.x * scale;
    const dy = originY + d.y * scale;
    const dw = (d.width || 3.0) * scale;
    elementsSvg += `
      <g>
        <circle cx="${dx}" cy="${dy}" r="4" fill="#B45309"/>
        <line x1="${dx}" y1="${dy}" x2="${dx + dw * 0.7}" y2="${dy - dw * 0.7}" stroke="#B45309" stroke-width="2"/>
        <path d="M ${dx} ${dy - dw} A ${dw} ${dw} 0 0 1 ${dx + dw} ${dy}" fill="none" stroke="#B45309" stroke-width="1.2" stroke-dasharray="3,3"/>
      </g>
    `;
  });

  (layout.windows || []).forEach(win => {
    const wx = originX + win.x * scale;
    const wy = originY + win.y * scale;
    const ww = (win.width || 4.0) * scale;
    elementsSvg += `
      <g>
        <rect x="${wx - ww / 2}" y="${wy - 3}" width="${ww}" height="6" fill="#0EA5E9" stroke="#0284C7" stroke-width="1.5"/>
        <text x="${wx}" y="${wy - 6}" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="#0284C7" text-anchor="middle">
          ${win.isBathroom ? 'V' : 'W'}
        </text>
      </g>
    `;
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
        <text x="16" y="24" class="txt-title">${layout.title || 'AUTOPLOT ARCHITECTURAL PLAN'}</text>
        <text x="16" y="44" class="txt-meta">Client: <tspan class="txt-bold">${layout.ownerName || 'Client'}</tspan> | Facing: <tspan class="txt-bold">${layout.plot?.facing || 'North'}</tspan></text>

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
