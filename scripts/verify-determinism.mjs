// Headless determinism checks for the accumulated-glass casting model.
// Same seed + same material history must reproduce bead placement and flow.
import { Trophy, COLLECTION_CONFIG, COLOR_FIELD_CONFIG } from '../src/trophy.js';
import { seedSessions } from '../src/seed-data.js';

function snapshot(trophy) {
  const materials = trophy.materials.map((item) => [
    item.emotion,
    item.target.x,
    item.target.y,
    item.target.z,
    item.flow.x,
    item.flow.y,
    item.flow.z,
    item.size,
  ]);
  const data = trophy._fieldTexture.image.data;
  let fieldHash = 2166136261;
  for (let i = 0; i < data.length; i += 17) {
    fieldHash ^= data[i];
    fieldHash = Math.imul(fieldHash, 16777619) >>> 0;
  }
  return { materials, fieldHash };
}

function identical(a, b) {
  if (a.fieldHash !== b.fieldHash || a.materials.length !== b.materials.length) return false;
  for (let i = 0; i < a.materials.length; i++) {
    if (a.materials[i].length !== b.materials[i].length) return false;
    for (let j = 0; j < a.materials[i].length; j++) {
      if (a.materials[i][j] !== b.materials[i][j]) return false;
    }
  }
  return true;
}

const { beats } = seedSessions()[0];
let failed = false;

// 1. Same seed + beat history produces byte-identical material placement.
{
  const a = new Trophy(12345);
  a.setBeats(beats);
  const b = new Trophy(12345);
  b.setBeats(beats);
  const ok = identical(snapshot(a), snapshot(b));
  console.log(`${ok ? 'PASS' : 'FAIL'}  same seed + beats -> identical glass history (${a.materials.length} beads)`);
  if (!ok) failed = true;
}

// 2. The live insertion path is deterministic for an identical input sequence.
{
  const sequence = [0, 0, 1, 2, 2, 0, 1, 2, 0, 2];
  const a = new Trophy(777);
  const b = new Trophy(777);
  a.beginLive();
  b.beginLive();
  for (const emotion of sequence) {
    a.insertSphere(emotion);
    b.insertSphere(emotion);
  }
  const ok = identical(snapshot(a), snapshot(b));
  console.log(`${ok ? 'PASS' : 'FAIL'}  identical live inputs -> identical accumulated material`);
  if (!ok) failed = true;
}

// 3. A different seed or beat history changes the cast interior.
{
  const a = new Trophy(1);
  a.setBeats(beats);
  const b = new Trophy(2);
  b.setBeats(beats);
  const okSeed = !identical(snapshot(a), snapshot(b));
  const c = new Trophy(1);
  c.setBeats(seedSessions()[1].beats);
  const okBeats = !identical(snapshot(a), snapshot(c));
  console.log(`${okSeed ? 'PASS' : 'FAIL'}  different seed -> different glass flow`);
  console.log(`${okBeats ? 'PASS' : 'FAIL'}  different beats -> different colour history`);
  if (!okSeed || !okBeats) failed = true;
}

// 4. Casting splits the immutable bead snapshot into several bounded flows and
// keeps the specified amount of genuinely clear glass.
{
  const a = new Trophy(424242);
  const sequence = [2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 1];
  a.beginLive();
  sequence.forEach((emotion, index) => a.insertSphere(emotion, { sequence: index }));
  a.finishCast();
  const roles = a._fieldComposition.roles;
  const ok =
    a._fieldSeeds.length >= COLOR_FIELD_CONFIG.minFlowCount &&
    a._fieldSeeds.length <= COLOR_FIELD_CONFIG.maxFlowCount &&
    roles.filter((item) => item.role === 'major').length >= COLOR_FIELD_CONFIG.minMajorFlows &&
    a._largestFlowContribution <= COLOR_FIELD_CONFIG.maxSingleFlowContribution &&
    a._clearGlassFraction >= COLOR_FIELD_CONFIG.minClearGlassFraction &&
    a._clearGlassFraction <= COLOR_FIELD_CONFIG.maxClearGlassFraction &&
    a._fieldValidation.valid;
  console.log(`${ok ? 'PASS' : 'FAIL'}  anti-snake field uses ${a._fieldSeeds.length} flows (${Math.round(a._clearGlassFraction * 100)}% clear glass)`);
  if (!ok) failed = true;
}

// 5. Heavy input remains finite and stops exactly at the physical mould capacity.
{
  const a = new Trophy(999);
  a.beginLive();
  for (let i = 0; i < 257; i++) a.insertSphere(i % 3);
  const rows = snapshot(a).materials;
  let ok = rows.length === a.capacity;
  for (const row of rows) {
    for (const value of row) if (!Number.isFinite(value)) ok = false;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  full mould stops safely at ${a.materials.length}/${a.capacity} beads`);
  if (!ok) failed = true;
}

// 6. Visible bead tops, not elapsed time or shader density, unlock auto-cast.
{
  const a = new Trophy(3030);
  a.beginLive();
  for (let i = 0; i < COLLECTION_CONFIG.autoCastMinCount - 1; i++) a.insertSphere(i % 3);
  a.update(1);
  const earlyBlocked = !a.autoCastReady;
  for (let i = a.sphereCount; i < COLLECTION_CONFIG.targetSphereCount; i++) a.insertSphere(i % 3);
  a.update(2);
  const fullReady = a.sphereCount >= COLLECTION_CONFIG.autoCastMinCount &&
    a.visibleFillHeight >= COLLECTION_CONFIG.autoCastFillHeight &&
    a.autoCastReady;
  const ok = earlyBlocked && fullReady;
  console.log(`${ok ? 'PASS' : 'FAIL'}  visible fill gates auto-cast (${a.sphereCount} beads, ${a.visibleFillHeight.toFixed(2)} fill)`);
  if (!ok) failed = true;
}

process.exit(failed ? 1 : 0);
