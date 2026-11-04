import test from 'node:test';
import assert from 'node:assert/strict';

import { createColumn, createWall, getPlotRect, getRoadBands, resizePlotBoundary, setPlotWallThickness } from '../components/editor/layoutModel.js';
import { EDITOR_VIEW, fileBaseName, generateLayoutSVG, getRasterScale, getSvgSheetSize, PLAN_VIEW } from '../components/editor/exportUtils.js';
import { syncLayoutToState } from '../components/editor/layoutBridge.js';
import { furnitureSvg } from '../components/editor/furnitureSvg.js';
import { buildJpegPdf } from '../components/editor/pdfWriter.js';
import { buildFixture } from './fixtures.mjs';

const latin = (bytes) => Buffer.from(bytes).toString('latin1');

function samplePdf(title = 'My Plan') {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  return { jpeg, pdf: buildJpegPdf({ jpeg, pixelWidth: 100, pixelHeight: 50, pageWidthPt: 200, pageHeightPt: 100, title }) };
}

test('the PDF has a valid header, page size, and image description', () => {
  const text = latin(samplePdf().pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes('/MediaBox [0 0 200.00 100.00]'));
  assert.ok(text.includes('/Width 100 /Height 50'));
  assert.ok(text.includes('/Filter /DCTDecode'));
});

test('the image bytes are stored unchanged, with the correct stream length', () => {
  const { jpeg, pdf } = samplePdf();
  const text = latin(pdf);
  const start = text.indexOf('stream\n') + 'stream\n'.length;
  assert.deepEqual([...pdf.slice(start, start + jpeg.length)], [...jpeg]);
  assert.ok(text.includes(`/Length ${jpeg.length} >>`));
});

test('every cross-reference entry points at its object', () => {
  const text = latin(samplePdf().pdf);
  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(xrefAt).startsWith('xref\n0 7\n'));
  const rows = text.slice(xrefAt).split('\n').slice(3, 9);
  rows.forEach((row, i) => {
    const offset = Number(row.slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`);
  });
});

test('a non-English title is stored safely in the metadata', () => {
  const text = latin(samplePdf('వాస్తు').pdf);
  assert.ok(text.includes('/Title <FEFF0C350C3E0C380C4D0C240C41>'));
});

test('the sheet is the same size as before for a plan inside its plot', () => {
  const sheet = getSvgSheetSize(generateLayoutSVG(buildFixture(), 'ft'));
  // 30 x 40 ft at 20 px/ft, 100 px padding, plus the 80 px title block allowance.
  assert.deepEqual(sheet, { width: 800, height: 1080 });
});

test('the drawing includes the outer plot dimensions and quadrant labels', () => {
  const svg = generateLayoutSVG(buildFixture(), 'ft');
  assert.ok(svg.includes('data-plot-dimensions'));
  for (const label of ['>NW<', '>NE<', '>SW<', '>SE<']) assert.ok(svg.includes(label), label);
  assert.match(svg, />30(\.0+)?'?[^<]*<\/text>/);
  assert.match(svg, />40(\.0+)?'?[^<]*<\/text>/);
});

test('the dimensions follow a resized plot, and the building stays in place relative to it', () => {
  const next = resizePlotBoundary(buildFixture(), { width: 36, edge: 'left' }).nextLayout;
  const svg = generateLayoutSVG(next, 'ft');
  assert.deepEqual(getSvgSheetSize(svg), { width: 920, height: 1080 });
  assert.match(svg, />36(\.0+)?'?[^<]*<\/text>/);
});

test('nothing is cut off: the sheet grows to hold objects far outside the plot', () => {
  const layout = buildFixture();
  layout.walls = [...layout.walls, createWall({ id: 'far-left', x1: -40, y1: 5, x2: -30, y2: 5 })];
  layout.columns = [createColumn({ id: 'far-down', x: 15, y: 70 })];
  const svg = generateLayoutSVG(layout, 'ft');
  const [, left, top, width, height] = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/).map(Number);
  // World x=-40 is at 100 - 800 = -700 px; world y=70 is at 100 + 1400 = 1500 px.
  assert.ok(left <= -700, `left ${left}`);
  assert.ok(top + height >= 1500, `bottom ${top + height}`);
  assert.ok(left + width >= 700, 'the plot is still inside');
});

test('the title block sits below an object past the plot', () => {
  const layout = buildFixture();
  layout.columns = [createColumn({ id: 'far-down', x: 15, y: 70 })];
  const svg = generateLayoutSVG(layout, 'ft');
  const y = Number(svg.match(/translate\(100, (-?[\d.]+)\)">\s*<rect x="0" y="0"/)[1]);
  assert.ok(y > 100 + 70 * 20, `title block at ${y}`);
});

test('plot wall thicknesses reach the drawing', () => {
  const layout = setPlotWallThickness(buildFixture(), 'north', 8).layout;
  const svg = generateLayoutSVG(layout, 'ft');
  assert.match(svg, /<polygon data-plot-wall="north" points="100,100 700,100 690,113\.\d+ 110,113\.\d+" fill="#64748B"\/>/);
});

test('the north arrow sits beside the plot, clear of the width dimension', () => {
  const svg = generateLayoutSVG(buildFixture(), 'ft');
  const [, x, y] = svg.match(/translate\((-?[\d.]+), (-?[\d.]+)\) rotate/).map(Number);
  assert.ok(x - 18 > 700, `arrow left edge ${x - 18} is right of the plot edge at 700`);
  assert.ok(x + 18 < 800, 'and inside the sheet');
  assert.ok(y - 28 > 100 - 2.5 * 20 + 10, 'and below the dimension line');
});

test('file names are safe and keep any language', () => {
  assert.equal(fileBaseName({ title: "Venkat's Residence Plan" }), 'venkat-s-residence-plan');
  assert.equal(fileBaseName({ title: 'వాస్తు ప్లాన్' }), 'వాస్తు-ప్లాన్');
  assert.equal(fileBaseName({ title: 'a/b:c?' }), 'a-b-c');
  assert.equal(fileBaseName({ title: '///' }), 'autoplot-plan');
  assert.equal(fileBaseName({}), 'autoplot-plan');
});

test('the plan view adds furniture, road, gate, and open space without moving geometry', () => {
  const layout = buildFixture();
  layout.plot.roadDirection = 'North Road';
  const plain = generateLayoutSVG(layout, 'ft');
  const plan = generateLayoutSVG(layout, 'ft', PLAN_VIEW);

  for (const marker of ['data-furniture', 'data-layer="road"', 'data-layer="main-gate"', 'data-layer="open-space"']) {
    assert.ok(plan.includes(marker), marker);
    assert.ok(!plain.includes(marker), `${marker} stays out of the plain drawing`);
  }
  // Rooms and walls are drawn at identical coordinates in both.
  const geometry = (svg) => svg.match(/<rect data-room-id[^>]*>|<polygon points="[^"]*" fill="#0F172A"[^>]*>/g);
  assert.ok(geometry(plain).length > 9);
  assert.deepEqual(geometry(plan), geometry(plain));
  assert.deepEqual(getSvgSheetSize(plan), getSvgSheetSize(plain));
});

test('each plan toggle controls its own layer', () => {
  const layout = buildFixture();
  const off = (o) => generateLayoutSVG(layout, 'ft', { ...PLAN_VIEW, ...o });
  assert.ok(!off({ showFurniture: false }).includes('data-furniture'));
  assert.ok(!off({ showGrid: false }).includes('data-layer="grid"'));
  assert.ok(off({ showGrid: true }).includes('data-layer="grid"'));
  assert.ok(!off({ showLabels: false }).includes('>\n          Kitchen\n'));
  assert.ok(off({ showLabels: true }).includes('Kitchen'));
  assert.ok(off({ showCirculation: true }).includes('data-layer="circulation"'));
  assert.ok(!off({ showCirculation: false }).includes('data-layer="circulation"'));
});

test('the road follows the road direction, and a south road clears the title block', () => {
  const layout = buildFixture();
  const roads = (direction) => {
    layout.plot.roadDirection = direction;
    return [...generateLayoutSVG(layout, 'ft', PLAN_VIEW).matchAll(/data-road="(\w+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(roads('North Road'), ['North']);
  assert.deepEqual(roads('East Road'), ['East']);
  assert.deepEqual(roads('Corner E+N'), ['North', 'East']);
  assert.deepEqual(roads('Corner W+S'), ['South', 'West']);

  layout.plot.roadDirection = 'South Road';
  const svg = generateLayoutSVG(layout, 'ft', PLAN_VIEW);
  const y = Number(svg.match(/translate\(100, (-?[\d.]+)\)">\s*<rect x="0" y="0"/)[1]);
  assert.ok(y >= 100 + 40 * 20 + 6 + 24, `title block at ${y} is below the road`);
});

test('the editor view draws the road and leaves out the 2D Plan extras', () => {
  const layout = buildFixture();
  layout.plot.roadDirection = 'North Road';
  const svg = generateLayoutSVG(layout, 'ft', EDITOR_VIEW);
  assert.ok(svg.includes('data-road="North"'));
  assert.ok(!svg.includes('data-furniture'));
  assert.ok(!svg.includes('data-layer="main-gate"'));
  assert.ok(!generateLayoutSVG(layout, 'ft').includes('data-road'), 'no road unless asked for');
});

test('road markers sit outside the plot, beyond the dimension line, on every side', () => {
  const layout = buildFixture();
  const rect = getPlotRect(layout);
  const band = (direction) => {
    layout.plot.roadDirection = direction;
    return getRoadBands(layout);
  };
  const [north] = band('North Road');
  assert.equal(north.width, rect.width);
  assert.ok(north.y + north.length < rect.y0 - 2);
  const [south] = band('South Road');
  assert.ok(south.y > rect.y1);
  const [east] = band('East Road');
  assert.ok(east.x > rect.x1);
  assert.equal(east.length, rect.length);
  const [west] = band('West Road');
  assert.ok(west.x + west.width < rect.x0 - 2);
  assert.deepEqual(band('Corner E+N').map((b) => b.side), ['North', 'East']);
  assert.deepEqual(band('Corner W + S').map((b) => b.side), ['South', 'West']);
  assert.deepEqual(band(''), []);
});

test('the road follows a resized plot and a moved dimension line', () => {
  const layout = buildFixture();
  layout.plot.roadDirection = 'North Road';
  const moved = resizePlotBoundary(layout, { width: 36, length: 46, edge: 'corner-nw' }).nextLayout;
  const [band] = getRoadBands(moved);
  assert.equal(band.x, -6);
  assert.equal(band.width, 36);
  assert.ok(band.y + band.length < -6);

  const before = getRoadBands(layout)[0].y;
  layout.dimensions = layout.dimensions.map((d) => (d.id === 'dim-plot-width' ? { ...d, offset: d.offset + 3 } : d));
  assert.equal(getRoadBands(layout)[0].y, before - 3);
});

test('a road edited in the editor reaches the inputs the report reads', () => {
  const layout = buildFixture();
  layout.plot.roadDirection = 'East Road';
  layout.plot.facing = 'East';
  const next = syncLayoutToState(layout, { roadDirection: 'North Road', siteFacing: 'North', customRooms: [] });
  assert.equal(next.roadDirection, 'East Road');
  assert.equal(next.siteFacing, 'East');
});

test('furniture comes from the room name, and small rooms get none', () => {
  const ft = 20;
  assert.match(furnitureSvg('Master Bedroom', 0, 0, 200, 200, ft), /data-furniture="bed"/);
  assert.match(furnitureSvg('Kitchen', 0, 0, 200, 200, ft), /data-furniture="kitchen"/);
  assert.match(furnitureSvg('Bathroom/Toilet 1', 0, 0, 100, 100, ft), /data-furniture="bath"/);
  assert.match(furnitureSvg('Living Room (Hall)', 0, 0, 200, 200, ft), /data-furniture="sofa"/);
  assert.match(furnitureSvg('Dining Room', 0, 0, 200, 200, ft), /data-furniture="dining"/);
  assert.match(furnitureSvg('Pooja Room', 0, 0, 100, 100, ft), /data-furniture="pooja"/);
  assert.equal(furnitureSvg('Store Room', 0, 0, 200, 200, ft), '');
  assert.equal(furnitureSvg('Kitchen', 0, 0, 30, 200, ft), '');
  assert.equal(furnitureSvg(undefined, 0, 0, 200, 200, ft), '');
});

test('resolution is 300 DPI for a normal plan and capped for a huge one', () => {
  assert.ok(Math.abs(getRasterScale({ width: 800, height: 1080 }) - 3.6) < 1e-9);
  const huge = getRasterScale({ width: 6000, height: 9000 });
  assert.ok(huge * 9000 <= 8000 + 1e-6);
  assert.ok(huge * huge * 6000 * 9000 <= 40e6 + 1);
});
