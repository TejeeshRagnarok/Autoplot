// Runs the reflow engine against layouts produced by the real generator.
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateStructuredLayoutFromState } from '../components/editor/layoutBridge.js';
import { applySiteChange, cloneLayout } from '../components/editor/layoutModel.js';
import { validateOpenings, validateSiteFit } from '../components/editor/constraintEngine.js';
import { sharedEdges, wallJunctions, byId, distanceToWall } from './fixtures.mjs';

const state = {
  siteWidth: '30', siteLength: '40', eastOpen: '2', westOpen: '2', northOpen: '4', southOpen: '4',
  mainDoorDirection: 'North', ownerName: 'Test', stairsLocation: 'Southwest',
  customRooms: [
    { id: 'r1', name: 'Master Bedroom', width: '12', length: '12' },
    { id: 'r2', name: 'Bedroom 2', width: '10', length: '10' },
    { id: 'r3', name: 'Kitchen', width: '10', length: '8' },
    { id: 'r4', name: 'Pooja', width: '5', length: '5' },
    { id: 'r5', name: 'Toilet', width: '5', length: '7' },
    { id: 'r6', name: 'Dining', width: '10', length: '8' },
  ],
};

for (const [label, change] of [
  ['width 30 -> 25', { width: 25 }],
  ['width 30 -> 36 (west edge)', { width: 36, edge: 'left' }],
  ['length 40 -> 46', { length: 46 }],
  ['length 40 -> 37 (north edge)', { length: 37, edge: 'top' }],
]) {
  test(`generated layout: ${label}`, () => {
    const before = generateStructuredLayoutFromState(state);
    const res = applySiteChange(before, change);
    const after = res.nextLayout;

    if (change.width) assert.equal(after.plot.width, change.width);
    if (change.length) assert.equal(after.plot.length, change.length);

    // Never deletes anything; IDs stable
    for (const k of ['rooms', 'walls', 'doors', 'windows', 'staircases', 'utilities']) {
      assert.deepEqual(after[k].map((e) => e.id).sort(), before[k].map((e) => e.id).sort(), k);
    }
    // Adjacency and wall corners preserved, whether or not the change was feasible
    assert.deepEqual([...sharedEdges(after)].sort(), [...sharedEdges(before)].sort());
    for (const j of wallJunctions(before)) assert.ok(wallJunctions(after).has(j), j);

    // Openings remain on the walls they were hosted on
    const hosts = cloneLayout(before);
    validateOpenings(hosts);
    for (const o of [...after.doors, ...after.windows]) {
      const prev = [...hosts.doors, ...hosts.windows].find((p) => p.id === o.id);
      if (!prev.wallId) continue;
      assert.equal(o.wallId, prev.wallId, o.id);
      assert.ok(distanceToWall(o, byId(after.walls, o.wallId)) < 1e-3, o.id);
    }

    if (res.success) {
      // A successful result introduces no new overlaps and nothing new leaves the plot
      const key = (c) => `${c.code}:${c.id}:${c.otherId || ''}`;
      const pre = new Set(validateSiteFit(before).map(key));
      const introduced = validateSiteFit(after).filter((c) => !pre.has(key(c)) && ['room-overlap', 'outside-plot'].includes(c.code));
      assert.deepEqual(introduced, []);
    } else {
      assert.ok(res.conflicts.length > 0, 'failure always explains itself');
    }
  });
}
