/**
 * Minimal PDF writer: one page holding one JPEG image, edge to edge. An image
 * keeps every line and any script (Telugu names included) exactly as drawn,
 * which built-in PDF fonts could not.
 */

const ascii = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** A PDF text string as UTF-16 hex, so any language is safe in the metadata. */
function hexString(text) {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i += 1) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/**
 * @param {object} o
 * @param {Uint8Array} o.jpeg JPEG file bytes
 * @param {number} o.pixelWidth image width in pixels
 * @param {number} o.pixelHeight image height in pixels
 * @param {number} o.pageWidthPt page width in points (1/72 inch)
 * @param {number} o.pageHeightPt page height in points
 * @param {string} [o.title] document title
 * @returns {Uint8Array} PDF file bytes
 */
export function buildJpegPdf({ jpeg, pixelWidth, pixelHeight, pageWidthPt, pageHeightPt, title = '' }) {
  const w = pageWidthPt.toFixed(2);
  const h = pageHeightPt.toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;

  // Each object is its text, plus optional binary stream data.
  const objects = [
    { text: '<< /Type /Catalog /Pages 2 0 R >>' },
    { text: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { text: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>` },
    {
      text: `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      stream: jpeg,
    },
    { text: `<< /Length ${content.length} >>`, stream: ascii(content) },
    { text: `<< /Title ${hexString(title)} /Producer (AutoPlot) >>` },
  ];

  const parts = [];
  let offset = 0;
  const push = (bytes) => { parts.push(bytes); offset += bytes.length; };

  // The binary comment tells file tools this PDF holds binary data.
  push(ascii('%PDF-1.4\n%âãÏÓ\n'));
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(offset);
    push(ascii(`${i + 1} 0 obj\n${obj.text}\n`));
    if (obj.stream) {
      push(ascii('stream\n'));
      push(obj.stream);
      push(ascii('\nendstream\n'));
    }
    push(ascii('endobj\n'));
  });

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(ascii(xref));

  const out = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
