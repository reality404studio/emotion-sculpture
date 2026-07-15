// Headless determinism checks for the accumulated-glass casting model.
// Same seed + same material history must reproduce bead placement and flow.
import { Trophy } from '../src/trophy.js';
import { seedSessions } from '../src/seed-data.js';

function snapshot(trophy) {
  return trophy.materials.map((item) => [
    item.emotion,
    item.target.x,
    item.target.y,
    item.target.z,
    item.flow.x,
    item.flow.y,
    item.flow.z,
    item.size,
  ]);
}

function identical(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) return false;
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

// 4. Heavy input remains finite and stops exactly at the physical mould capacity.
{
  const a = new Trophy(999);
  a.beginLive();
  for (let i = 0; i < 257; i++) a.insertSphere(i % 3);
  const rows = snapshot(a);
  let ok = rows.length === a.capacity;
  for (const row of rows) {
    for (const value of row) if (!Number.isFinite(value)) ok = false;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  full mould stops safely at ${a.materials.length}/${a.capacity} beads`);
  if (!ok) failed = true;
}

process.exit(failed ? 1 : 0);
