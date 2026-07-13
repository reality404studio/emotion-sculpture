// 헤드리스 결정론 검증 (emotion-trophy-spec.md §6 · 파티클 주조판)
// 같은 seed + beats → 홈 위치·그래디언트 쌍·크기가 바이트 동일해야
// 온체인 해시(재현성) 주장이 성립한다. 스폰/생성시각은 애니메이션 전용이라 제외.
//   node scripts/verify-determinism.mjs
import { Trophy } from '../src/trophy.js';
import { seedSessions } from '../src/seed-data.js';

// 결정론 대상 속성만 비교 (birth/spawn은 라이브 연출 전용)
const DETERMINISTIC_ATTRS = ['position', 'aColA', 'aColB', 'aMix', 'aSize', 'aEnergy'];

function snapshot(trophy) {
  const n = trophy._count;
  const out = { count: n };
  for (const name of DETERMINISTIC_ATTRS) {
    const attr = trophy.geometry.getAttribute(name);
    out[name] = attr.array.slice(0, n * attr.itemSize);
  }
  return out;
}

function identical(a, b) {
  if (a.count !== b.count) return false;
  for (const name of DETERMINISTIC_ATTRS) {
    const x = a[name];
    const y = b[name];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

const { beats } = seedSessions()[0];
let failed = false;

// 1. 같은 seed + beats → 동일 파티클 버퍼
{
  const a = new Trophy(12345);
  a.setBeats(beats);
  const b = new Trophy(12345);
  b.setBeats(beats);
  const ok = identical(snapshot(a), snapshot(b));
  console.log(`${ok ? 'PASS' : 'FAIL'}  same seed + beats -> identical particles (${a._count} particles)`);
  if (!ok) failed = true;
}

// 2. live 경로(addBeat 순차 + finishCast) === setBeats 일괄 경로
{
  const a = new Trophy(777);
  a.beginLive(beats.length);
  for (const beat of beats) a.addBeat(beat);
  a.finishCast();
  const b = new Trophy(777);
  b.setBeats(beats);
  const ok = identical(snapshot(a), snapshot(b));
  console.log(`${ok ? 'PASS' : 'FAIL'}  live path === batch path after finishCast`);
  if (!ok) failed = true;
}

// 3. 다른 seed → 다른 위상 / 다른 beats → 다른 트로피
{
  const a = new Trophy(1);
  a.setBeats(beats);
  const b = new Trophy(2);
  b.setBeats(beats);
  const okSeed = !identical(snapshot(a), snapshot(b));
  const c = new Trophy(1);
  c.setBeats(seedSessions()[1].beats);
  const okBeats = !identical(snapshot(a), snapshot(c));
  console.log(`${okSeed ? 'PASS' : 'FAIL'}  different seed -> different phase`);
  console.log(`${okBeats ? 'PASS' : 'FAIL'}  different beats -> different trophy`);
  if (!okSeed || !okBeats) failed = true;
}

// 4. 아름다움 하한선 스모크 체크 (§7-2): 풀스팸에도 홈 위치가 유한·양수 반지름,
//    풀 상한(MAX_PARTICLES) 안에서 안전하게 멈춘다
{
  const spam = [];
  for (let t = 0; t < 257; t++) spam.push({ t, e: [1, 1, 1], kind: 'tap' });
  const a = new Trophy(999);
  a.setBeats(spam);
  const pos = a.geometry.getAttribute('position').array;
  let ok = a._count > 0 && a._count <= 200000;
  for (let i = 0; i < a._count && ok; i += 97) {
    const rad = Math.hypot(pos[i * 3], pos[i * 3 + 2]);
    const y = pos[i * 3 + 1];
    if (!Number.isFinite(rad) || rad <= 0 || !Number.isFinite(y)) ok = false;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  full spam stays finite inside pool (${a._count} particles)`);
  if (!ok) failed = true;
}

process.exit(failed ? 1 : 0);
