// Emotion Trophy — 파티클 주조 (emotion-trophy-spec.md v3 + 파티클 부록)
//
// 트로피 아키타입 프로파일 P(u)는 유지하되, 재료가 유리 메시에서 입자로 바뀐다.
// 모든 입력은 입자를 낳는다:
//   좋아! = 한 점에서 터지는 스플랫 → 금빛 방울 클러스터로 정착
//   안돼! = 바깥에서 안으로 스냅되는 붉은 세로 시임
//   제발! = 흩어진 구름이 촘촘한 파란 실 한 줄로 응집 (홀드 시간 = 실의 개수)
// 고요한 틱도 옅은 샴페인 입자 링을 남긴다 — 침묵조차 기록이다.
//
// 성능 설계: 입자당 홈 위치·스폰 위치·생성시각·그래디언트 쌍을 버퍼에 1회 쓰고,
// 정착·산란·복귀·반짝임은 전부 버텍스 셰이더가 계산한다. CPU는 입력 순간에만 일한다.
//
// 결정론 (§6): 홈 위치·색·크기는 seed + beats의 순수 함수. Math.random() 금지.
// 스폰 위치/시각은 애니메이션 전용이며 finishCast 시 결정론 경로로 재구축된다.

import * as THREE from 'three';
import { BASELINE, DECAY } from './emotions.js';
import { hashInt } from './noise.js';

// ── 비례 (§2.1) ──
const TOTAL_H = 4.4;
const BASE_H = TOTAL_H * 0.18;
const GLASS_H = TOTAL_H - BASE_H;
const R_UNIT = 1.05;
const RINGS = 200; // P(u) 샘플 해상도

const MAX_PARTICLES = 200_000;
const FLOATS = { pos: 3, spawn: 3, birth: 1, dur: 1, size: 1, colA: 3, colB: 3, mix: 1, phase: 1, energy: 1 };

// 트로피 아키타입 프로파일 — 전원 공통 (§2.1)
const PROFILE = [
  [0.0, 0.36],
  [0.045, 0.21],
  [0.1, 0.185],
  [0.15, 0.235],
  [0.2, 0.175],
  [0.27, 0.22],
  [0.34, 0.4],
  [0.55, 0.68],
  [0.75, 0.88],
  [0.9, 0.985],
  [1.0, 1.04],
];

const QUIET = [BASELINE, BASELINE, BASELINE];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// 그래디언트 맵 (파티클 부록): 이벤트마다 오리진-인접 색 쌍을 하나 뽑아
// 입자별로 섞는다 — 단색 감정 대신 살아있는 그라데이션.
// 램프는 의도적으로 한 단계 어둡게(×0.78) — 블룸이 밝기를 얹으므로 원색은 탄다.
const dimRgb = (hex) => hexToRgb(hex).map((v) => v * 0.78);
const RAMPS = [
  [0xfff3c9, 0xffd9a0, 0xffb454, 0xf5a524, 0xff7847].map(dimRgb), // 좋아 — 크림→골드→코랄
  [0xffb09a, 0xff7b5c, 0xe4573d, 0xc13a55, 0x8a2040].map(dimRgb), // 안돼 — 코랄→레드→와인
  [0xd9f2ff, 0xa8d8ff, 0x5fb8ff, 0x3b82f6, 0x5a5fe0].map(dimRgb), // 제발 — 아이스→블루→인디고
];
const QUIET_PAIR = [hexToRgb(0xefe6cf), hexToRgb(0xd9cfb4)]; // 고요 — 옅은 샴페인

function seedPhase(seed, salt) {
  return ((((seed ^ (salt * 0x9e3779b9)) >>> 0) % 100000) / 100000) * Math.PI * 2;
}

// 결정론적 [0,1) — (seed, tick, emotion, particle, salt) 조합마다 독립
function rnd(seed, t, emo, i, salt) {
  const n =
    (seed ^
      Math.imul(t + 1, 0x9e3779b1) ^
      Math.imul(emo + 1, 0x85ebca6b) ^
      Math.imul(i + 1, 0xc2b2ae35) ^
      Math.imul(salt + 1, 0x27d4eb2f)) >>>
    0;
  return hashInt(n);
}
// 근사 가우시안 [-1.5, 1.5]
function gauss(seed, t, emo, i, salt) {
  return rnd(seed, t, emo, i, salt) + rnd(seed, t, emo, i, salt + 61) + rnd(seed, t, emo, i, salt + 131) - 1.5;
}

// ── P(u): Catmull-Rom 보간, 1회 샘플링 ──
const PU = (() => {
  const out = new Float32Array(RINGS + 1);
  const pts = PROFILE;
  for (let r = 0; r <= RINGS; r++) {
    const u = r / RINGS;
    let k = 0;
    while (k < pts.length - 2 && u > pts[k + 1][0]) k++;
    const [u0, r0] = pts[Math.max(0, k - 1)];
    const [u1, r1] = pts[k];
    const [u2, r2] = pts[k + 1];
    const [u3, r3] = pts[Math.min(pts.length - 1, k + 2)];
    const t = clamp01((u - u1) / (u2 - u1 || 1));
    const m1 = ((r2 - r0) / (u2 - u0 || 1)) * (u2 - u1);
    const m2 = ((r3 - r1) / (u3 - u1 || 1)) * (u2 - u1);
    const t2 = t * t;
    const t3 = t2 * t;
    out[r] = Math.max(
      0.13,
      (2 * t3 - 3 * t2 + 1) * r1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * r2 + (t3 - t2) * m2
    );
  }
  return out;
})();

function profileAt(u) {
  return PU[clamp(Math.round(clamp01(u) * RINGS), 0, RINGS)];
}

// ── 셰이더 — 정착·반짝임·완성 쇼크웨이브·포인터 소용돌이 전부 GPU ──
const VERT = /* glsl */ `
  attribute vec3 aSpawn;
  attribute float aBirth, aDur, aSize, aMix, aPhase, aEnergy;
  attribute vec3 aColA, aColB;
  uniform float uTime, uSwirl, uBurst, uPixelRatio;
  uniform vec3 uPointer;
  varying vec3 vColor;
  varying float vAlpha, vGlow;

  void main() {
    float t = clamp((uTime - aBirth) / aDur, 0.0, 1.0);
    float s = 1.0 - pow(1.0 - t, 3.0); // easeOutCubic: 스플랫 → 정착
    vec3 pos = mix(aSpawn, position, s);

    // 살아있는 숨 — 미세 셔머
    pos += 0.011 * (0.35 + aEnergy) * vec3(
      sin(uTime * 1.7 + aPhase),
      cos(uTime * 1.3 + aPhase * 1.7),
      sin(uTime * 2.1 + aPhase * 0.7));

    vec2 radial = normalize(pos.xz + vec2(1e-4));

    // 표면 안팎 맥동 — 겉에 붙은 점이 아니라 트로피 살갗의 일부처럼,
    // 고스트 메시 표면을 넘나들며 숨쉰다
    float breathe = sin(uTime * 1.2 + aPhase * 2.3) * (0.05 + 0.045 * aEnergy);
    pos.xz += radial * breathe;

    // 완성 쇼크웨이브 — 축에서 바깥으로 훅 퍼졌다 모인다
    float bw = uBurst * (0.55 + 0.45 * sin(aPhase * 7.0));
    pos.xz += radial * bw * 0.9;
    pos.y += bw * 0.22 * sin(aPhase * 11.0);

    // 포인터 소용돌이 — 휘휘 저으면 흩어지고, 놓으면 홈으로 복귀
    vec3 d = pos - uPointer;
    float r2 = dot(d, d);
    float infl = exp(-r2 * 1.4) * uSwirl;
    vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), d + vec3(1e-4)));
    pos += (tangent * 1.15 + normalize(d + vec3(1e-4)) * 0.5) * infl;
    pos += 0.4 * infl * vec3(
      sin(uTime * 6.0 + aPhase * 3.0),
      sin(uTime * 5.0 + aPhase * 5.0),
      cos(uTime * 7.0 + aPhase * 2.0));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uPixelRatio * (12.0 / -mv.z), 1.0, 90.0);

    vGlow = (1.0 - s) * 1.4 + infl * 1.2; // 갓 태어난 입자와 저어진 입자는 달아오른다
    vAlpha = aEnergy * smoothstep(0.0, 0.12, t);
    vColor = mix(aColA, aColB, clamp(aMix + 0.22 * sin(uTime * 0.7 + aPhase), 0.0, 1.0));
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha, vGlow;
  void main() {
    // 가우시안 이중 폴오프 — 밝은 심 + 넓고 부드럽게 퍼지는 블러 헤일로
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float halo = exp(-d * d * 3.2) * smoothstep(1.0, 0.72, d);
    float core = exp(-d * d * 14.0);
    float a = halo * vAlpha;
    if (a < 0.003) discard;
    vec3 c = vColor * (0.4 + 1.5 * core + vGlow * 0.8);
    gl_FragColor = vec4(c * a, a);
  }
`;

export class Trophy {
  constructor(sessionSeed) {
    this.seed = sessionSeed >>> 0;
    this.beats = [];
    this.live = false;
    this.castU = 1;
    this._timeTicks = 2;
    this._liveE = QUIET.slice();
    this._imp = [0, 0, 0];
    this._swirl = 0;
    this._burst = 0;
    this._flash = 0;
    this._now = 0;
    this._lastT = 0;
    this._count = 0;

    const phase = seedPhase(this.seed, 40);
    this._sector = [phase, phase + (Math.PI * 2) / 3, phase + (Math.PI * 4) / 3];

    this._buildParticles();
    this._buildGhost();
    this._buildBase();
    this._buildMolten();

    this.group = new THREE.Group();
    this.group.add(this._baseGroup, this._ghostGroup, this.points, this._moltenGroup);
  }

  get height() {
    return TOTAL_H;
  }

  castFrontY() {
    return BASE_H + clamp01(this.castU) * GLASS_H;
  }

  _buildParticles() {
    this._buf = {};
    this.geometry = new THREE.BufferGeometry();
    for (const [name, itemSize] of Object.entries(FLOATS)) {
      const arr = new Float32Array(MAX_PARTICLES * itemSize);
      const attrName = name === 'pos' ? 'position' : 'a' + name[0].toUpperCase() + name.slice(1);
      const attr = new THREE.BufferAttribute(arr, itemSize);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(attrName, attr);
      this._buf[name] = arr;
    }
    this.geometry.setDrawRange(0, 0);

    this._uniforms = {
      uTime: { value: 0 },
      uSwirl: { value: 0 },
      uBurst: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, -99, 0) },
      uPixelRatio: { value: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this._uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  // 고스트 트로피 — 입력이 없어도 항상 보이는 저폴리 삼각 메시 아키타입.
  // 어두운 패싯 필 + 와이어프레임 글로우. 감정 입자는 이 뼈대 위에 얹힌다.
  _buildGhost() {
    const ROWS_G = 46;
    const SEG_G = 40;
    const CAP_G = 5;
    const total = ROWS_G + 1 + CAP_G;
    const pos = new Float32Array(total * SEG_G * 3);
    for (let r = 0; r < total; r++) {
      const isCap = r > ROWS_G;
      const capT = isCap ? (r - ROWS_G) / CAP_G : 0;
      const u = isCap ? 1 : r / ROWS_G;
      const baseR = profileAt(u) * R_UNIT * 0.985; // 입자보다 살짝 안쪽
      const radius = isCap ? baseR * Math.cos((capT * Math.PI) / 2) : baseR;
      const y = isCap
        ? BASE_H + GLASS_H + 0.1 * Math.sin((capT * Math.PI) / 2)
        : BASE_H + u * GLASS_H;
      for (let s = 0; s < SEG_G; s++) {
        const theta = (s / SEG_G) * Math.PI * 2;
        const i = (r * SEG_G + s) * 3;
        pos[i] = radius * Math.cos(theta);
        pos[i + 1] = y;
        pos[i + 2] = radius * Math.sin(theta);
      }
    }
    const indices = [];
    for (let r = 0; r < total - 1; r++) {
      for (let s = 0; s < SEG_G; s++) {
        const next = (s + 1) % SEG_G;
        const a = r * SEG_G + s;
        const b = r * SEG_G + next;
        const c = (r + 1) * SEG_G + next;
        const d = (r + 1) * SEG_G + s;
        indices.push(a, b, d, b, c, d);
      }
    }
    this._ghostGeom = new THREE.BufferGeometry();
    this._ghostGeom.setIndex(indices);
    this._ghostGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._ghostGeom.computeVertexNormals();

    this._ghostFillMat = new THREE.MeshStandardMaterial({
      color: 0x1a2138,
      roughness: 0.38,
      metalness: 0.55,
      flatShading: true, // 삼각 패싯이 보이는 저폴리 결
      transparent: true,
      opacity: 0.62,
    });
    this._ghostWireMat = new THREE.MeshBasicMaterial({
      color: 0x4a5fa8,
      wireframe: true,
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const fill = new THREE.Mesh(this._ghostGeom, this._ghostFillMat);
    const wire = new THREE.Mesh(this._ghostGeom, this._ghostWireMat);
    this._ghostGroup = new THREE.Group();
    this._ghostGroup.add(fill, wire);
  }

  // 받침대 — 감정과 무관한 고정 지오메트리, 각인의 자리 (§2.1)
  _buildBase() {
    this._baseGroup = new THREE.Group();
    const h1 = BASE_H * 0.52;
    const h2 = BASE_H * 0.48;
    const stone = new THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.4, metalness: 0.6 });
    this._bandMat = new THREE.MeshStandardMaterial({
      color: 0xd7a545,
      roughness: 0.22,
      metalness: 0.95,
      emissive: new THREE.Color(0xa06a18),
      emissiveIntensity: 0.25,
    });
    const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.42, h1, 64), stone);
    tier1.position.y = h1 / 2;
    const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.18, h2, 64), stone);
    tier2.position.y = h1 + h2 / 2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.024, 12, 96), this._bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = h1;
    [tier1, tier2, band].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      this._baseGroup.add(m);
    });
  }

  // 주조선 — 차오르는 최상단의 용융 링 (§1, §4)
  _buildMolten() {
    this._moltenGroup = new THREE.Group();
    this._ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb84d,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._moltenRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 10, 96), this._ringMat);
    this._moltenRing.rotation.x = Math.PI / 2;
    this._moltenLight = new THREE.PointLight(0xffb35c, 0, 7);
    this._moltenGroup.add(this._moltenRing, this._moltenLight);
    this._moltenGroup.visible = false;
  }

  // ─────────────────────────────────────────────────────────
  // Phase API
  // ─────────────────────────────────────────────────────────
  beginLive(expectedTicks) {
    this.live = true;
    this.beats = [];
    this.castU = 0;
    this._timeTicks = Math.max(2, expectedTicks);
    this._count = 0;
    this.geometry.setDrawRange(0, 0);
    this._moltenGroup.visible = true;
  }

  setCastProgress(p) {
    if (this.live) this.castU = clamp01(p);
  }

  addBeat(beat) {
    const t = this.beats.length;
    const prev = t > 0 ? this.beats[t - 1].e : QUIET;
    this.beats.push(beat);
    const start = this._count;
    this._emitBeat(t, beat.e, prev, this._timeTicks, this._now);
    this._flushRange(start, this._count - start);
  }

  // 종료 휘슬 = 주조 완료. 실제 beats 길이로 재정규화해 트로피를 끝까지 채우고,
  // 쇼크웨이브 한 번으로 완성을 선언한다 (§2.2).
  finishCast() {
    this.live = false;
    this.castU = 1;
    this._timeTicks = Math.max(2, this.beats.length);
    this._rebuildAll();
    this._burst = 1.25;
    this._flash = 1;
  }

  setBeats(beats) {
    this.live = false;
    this.beats = beats.slice();
    this.castU = 1;
    this._timeTicks = Math.max(2, this.beats.length);
    this._rebuildAll();
    this._burst = 1.0; // 비교 뷰 입장 연출 — 흩어졌다 모이며 등장
    this._moltenGroup.visible = false;
  }

  // liveImpulse (§4) — 주조선 재질만 즉시 반응. 지오메트리 재생성 없음.
  pulse(emotionIndex) {
    this._imp[emotionIndex] = Math.min(1.6, this._imp[emotionIndex] + (emotionIndex === 2 ? 0.55 : 1.0));
  }

  setLive(liveE) {
    this._liveE = liveE.slice();
  }

  // 마우스 휘휘 — 포인터 지점(로컬 좌표) 주변 입자를 소용돌이로 젓는다
  stir(localPoint, amount) {
    this._uniforms.uPointer.value.copy(localPoint);
    this._swirl = Math.min(1.3, this._swirl + amount);
  }

  // ─────────────────────────────────────────────────────────
  // 입자 방출 — beats → 입자 (결정론 구간)
  // ─────────────────────────────────────────────────────────
  _rebuildAll() {
    this._count = 0;
    let prev = QUIET;
    for (let t = 0; t < this.beats.length; t++) {
      // birth를 과거로 두면 즉시 정착 상태 — 등장 연출은 uBurst가 담당
      this._emitBeat(t, this.beats[t].e, prev, this._timeTicks, -1000);
      prev = this.beats[t].e;
    }
    for (const name of Object.keys(FLOATS)) {
      const attrName = name === 'pos' ? 'position' : 'a' + name[0].toUpperCase() + name.slice(1);
      this.geometry.getAttribute(attrName).needsUpdate = true;
    }
    this.geometry.setDrawRange(0, this._count);
  }

  _emitBeat(t, e, prev, N, birth) {
    const u = t / Math.max(1, N - 1);

    // 고요의 기록 — 옅은 샴페인 링이 아키타입 실루엣을 항상 지킨다 (§2.4)
    this._emitQuiet(t, u, birth);

    const dYes = Math.max(0, e[0] - prev[0] * DECAY);
    const dNo = Math.max(0, e[1] - prev[1] * DECAY);
    const lvlPlease = Math.max(0, e[2] - BASELINE) / (1 - BASELINE);

    if (dYes > 0.02) this._emitSplat(t, u, Math.min(1, dYes * 2.6), birth);
    if (dNo > 0.25) this._emitSeam(t, u, Math.min(1, dNo / 0.85), birth);
    if (lvlPlease > 0.03) this._emitThread(t, u, lvlPlease, birth);
  }

  _pair(t, emo) {
    const ramp = RAMPS[emo];
    const k = Math.min(ramp.length - 2, Math.floor(rnd(this.seed, t, emo, 0, 7) * (ramp.length - 1)));
    return [ramp[k], ramp[k + 1]];
  }

  _surface(u, theta, bump) {
    const r = profileAt(u) * R_UNIT * (1 + bump);
    return [r * Math.cos(theta), BASE_H + clamp01(u) * GLASS_H, r * Math.sin(theta)];
  }

  _push(home, spawn, birth, dur, size, colA, colB, mix, phaseV, energy) {
    if (this._count >= MAX_PARTICLES) return;
    const i = this._count++;
    const b = this._buf;
    b.pos.set(home, i * 3);
    b.spawn.set(spawn, i * 3);
    b.birth[i] = birth;
    b.dur[i] = dur;
    b.size[i] = size;
    b.colA.set(colA, i * 3);
    b.colB.set(colB, i * 3);
    b.mix[i] = mix;
    b.phase[i] = phaseV;
    b.energy[i] = energy;
  }

  _emitQuiet(t, u, birth) {
    // 고스트 메시가 실루엣을 담당하므로 고요 입자는 표면의 미광 더스트
    const N = 90;
    const tickH = GLASS_H / Math.max(1, this._timeTicks - 1);
    for (let i = 0; i < N; i++) {
      const theta = rnd(this.seed, t, 3, i, 1) * Math.PI * 2;
      const du = (gauss(this.seed, t, 3, i, 2) * 0.5 * tickH) / GLASS_H;
      const home = this._surface(u + du, theta, gauss(this.seed, t, 3, i, 3) * 0.006);
      const j = gauss(this.seed, t, 3, i, 4) * 0.12;
      const spawn = [home[0] + j, home[1] + gauss(this.seed, t, 3, i, 5) * 0.1, home[2] + j];
      this._push(
        home,
        spawn,
        birth + rnd(this.seed, t, 3, i, 6) * 0.3,
        1.0,
        2.0 + rnd(this.seed, t, 3, i, 8) * 1.0,
        QUIET_PAIR[0],
        QUIET_PAIR[1],
        rnd(this.seed, t, 3, i, 9),
        rnd(this.seed, t, 3, i, 10) * Math.PI * 2,
        0.22
      );
    }
  }

  // 좋아! — 스플랫: 주조선 위 한 점에서 터져 금빛 방울 클러스터로 정착 (§3)
  _emitSplat(t, u, s, birth) {
    // 대충 눌러도 풍성하게 — 탭 하나가 잔칫상처럼 보여야 한다
    const N = Math.round(110 + 150 * s);
    const [cA, cB] = this._pair(t, 0);
    const thetaC = this._sector[0] + (rnd(this.seed, t, 0, 0, 11) * 2 - 1) * 1.15;
    const tickH = GLASS_H / Math.max(1, this._timeTicks - 1);
    const origin = this._surface(u, thetaC, 0.03);
    for (let i = 0; i < N; i++) {
      const dTheta = gauss(this.seed, t, 0, i, 12) * 0.26;
      const du = (gauss(this.seed, t, 0, i, 13) * 1.6 * tickH) / GLASS_H;
      const g = Math.exp(-(dTheta * dTheta) / 0.08 - (du * GLASS_H * du * GLASS_H) / (4 * tickH * tickH));
      const bump = 0.04 + 0.17 * g + rnd(this.seed, t, 0, i, 14) * 0.03;
      const home = this._surface(u + du, thetaC + dTheta, bump);
      const spawn = [
        origin[0] + gauss(this.seed, t, 0, i, 15) * 0.03,
        origin[1] + gauss(this.seed, t, 0, i, 16) * 0.03,
        origin[2] + gauss(this.seed, t, 0, i, 17) * 0.03,
      ];
      this._push(
        home,
        spawn,
        birth + rnd(this.seed, t, 0, i, 18) * 0.08,
        0.55 + 0.35 * rnd(this.seed, t, 0, i, 19),
        4.6 + 3.6 * rnd(this.seed, t, 0, i, 20), // 방울은 크게 — 히어로 입자

        cA,
        cB,
        rnd(this.seed, t, 0, i, 21),
        rnd(this.seed, t, 0, i, 22) * Math.PI * 2,
        0.85 + 0.45 * s
      );
    }
  }

  // 안돼! — 시임: 바깥의 흩어진 점들이 붉은 세로 상처 하나로 스냅 (§3)
  _emitSeam(t, u, s, birth) {
    const N = Math.round(130 + 90 * s);
    const [cA, cB] = this._pair(t, 1);
    const thetaC = this._sector[1] + (rnd(this.seed, t, 1, 0, 23) * 2 - 1) * 0.85;
    const tickH = GLASS_H / Math.max(1, this._timeTicks - 1);
    for (let i = 0; i < N; i++) {
      const dTheta = gauss(this.seed, t, 1, i, 24) * 0.05;
      const du = (gauss(this.seed, t, 1, i, 25) * 3.0 * tickH) / GLASS_H;
      const home = this._surface(u + du, thetaC + dTheta, -0.05 - rnd(this.seed, t, 1, i, 26) * 0.05);
      const out = this._surface(u + du * 2, thetaC + gauss(this.seed, t, 1, i, 27) * 0.5, 0.3);
      this._push(
        home,
        out,
        birth + rnd(this.seed, t, 1, i, 28) * 0.05,
        0.4 + 0.2 * rnd(this.seed, t, 1, i, 29),
        3.2 + 2.2 * rnd(this.seed, t, 1, i, 30),
        cA,
        cB,
        rnd(this.seed, t, 1, i, 31),
        rnd(this.seed, t, 1, i, 32) * Math.PI * 2,
        1.0
      );
    }
  }

  // 제발! — 글로우 라인: 홀드하는 동안 얇게 빛나는 선이 트로피를 감아 올라간다.
  // 틱마다 시작각이 전진해, 긴 홀드는 나선으로 감긴 한 줄의 실이 된다 (§3).
  _emitThread(t, u, level, birth) {
    // 촘촘하고 또렷한 나선 — 홀드한 시간이 한눈에 읽혀야 한다
    const N = Math.round(150 + 110 * level);
    const [cA, cB] = this._pair(t, 2);
    const tickH = GLASS_H / Math.max(1, this._timeTicks - 1);
    const thetaStart = this._sector[2] + t * 0.55; // 감아 올라가는 나선의 전진
    const span = 0.7 + 0.6 * level;
    for (let i = 0; i < N; i++) {
      const along = i / Math.max(1, N - 1); // 선 위의 위치 0..1
      const theta = thetaStart + along * span;
      const du = (gauss(this.seed, t, 2, i, 34) * 0.08 * tickH) / GLASS_H; // 아주 팽팽하게
      const home = this._surface(u + du, theta, 0.018 + rnd(this.seed, t, 2, i, 35) * 0.008);
      const out = gauss(this.seed, t, 2, i, 36) * 0.14;
      const spawn = [home[0] + home[0] * out * 0.3, home[1] + gauss(this.seed, t, 2, i, 37) * 0.08, home[2] + home[2] * out * 0.3];
      this._push(
        home,
        spawn,
        birth + along * 0.45, // 선이 "그려지듯" 진행 방향으로 태어난다
        0.5,
        2.8 + 1.2 * rnd(this.seed, t, 2, i, 40),
        cA,
        cB,
        along, // 그라데이션이 선을 따라 흐른다
        rnd(this.seed, t, 2, i, 42) * Math.PI * 2,
        1.15 + 0.3 * level
      );
    }
  }

  // 라이브 중 부분 업로드 — 새로 태어난 입자 범위만 GPU로 보낸다
  _flushRange(start, n) {
    if (n <= 0) return;
    for (const [name, itemSize] of Object.entries(FLOATS)) {
      const attrName = name === 'pos' ? 'position' : 'a' + name[0].toUpperCase() + name.slice(1);
      const attr = this.geometry.getAttribute(attrName);
      attr.addUpdateRange(start * itemSize, n * itemSize);
      attr.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, this._count);
  }

  // ─────────────────────────────────────────────────────────
  // 프레임 업데이트 — 유니폼만 만진다
  // ─────────────────────────────────────────────────────────
  update(timeSec) {
    const dt = Math.min(0.1, Math.max(0, timeSec - this._lastT));
    this._lastT = timeSec;
    this._now = timeSec;
    this._uniforms.uTime.value = timeSec;

    // 잔향 감쇠: 좋아 짧고 밝게 / 안돼 탁 / 제발 길게 (§3)
    const tau = [0.28, 0.5, 1.1];
    for (let i = 0; i < 3; i++) this._imp[i] *= Math.exp(-dt / tau[i]);

    this._swirl *= Math.exp(-dt / 0.55);
    this._burst *= Math.exp(-dt / 0.5);
    this._uniforms.uSwirl.value = this._swirl;
    this._uniforms.uBurst.value = this._burst;

    if (this.live) {
      const y = this.castFrontY();
      const rr = profileAt(this.castU) * R_UNIT;
      const impSum = this._imp[0] + this._imp[1] + this._imp[2];
      const hold = clamp01((this._liveE[2] - BASELINE) / (1 - BASELINE));

      this._moltenRing.position.y = y + 0.015;
      this._moltenRing.scale.set(rr * 1.02, rr * 1.02, 1 + hold * 1.3 + impSum * 0.5);

      // 입력 순간 주조선이 해당 감정 색으로 달아오른다 (§4 인과 사슬)
      let cr = 1.0;
      let cg = 0.72;
      let cb = 0.3;
      const deep = [RAMPS[0][3], RAMPS[1][2], RAMPS[2][3]];
      for (let i = 0; i < 3; i++) {
        const k = Math.min(1, this._imp[i]) * 0.8;
        cr += (deep[i][0] * 1.25 - cr) * k;
        cg += (deep[i][1] * 1.25 - cg) * k;
        cb += (deep[i][2] * 1.25 - cb) * k;
      }
      const glow = 0.75 + impSum * 0.7 + hold * 0.4;
      this._ringMat.color.setRGB(Math.min(1, cr * glow), Math.min(1, cg * glow), Math.min(1, cb * glow));
      this._ringMat.opacity = Math.min(1, 0.7 + impSum * 0.3);
      this._moltenLight.position.y = y + 0.35;
      this._moltenLight.intensity = 1.4 + impSum * 3.2 + hold * 1.2;
    } else {
      this._ringMat.opacity = Math.max(0, this._ringMat.opacity - dt * 1.6);
      this._moltenLight.intensity = Math.max(0, this._moltenLight.intensity - dt * 6);
      if (this._moltenGroup.visible && this._ringMat.opacity <= 0.01) this._moltenGroup.visible = false;
      // 완성 순간 받침대 금띠가 한 번 빛난다 — 각인
      this._flash *= Math.exp(-dt / 0.8);
      this._bandMat.emissiveIntensity = 0.25 + this._flash * 1.6;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this._ghostGeom.dispose();
    this._ghostFillMat.dispose();
    this._ghostWireMat.dispose();
    this._ringMat.dispose();
    this._bandMat.dispose();
    this._moltenRing.geometry.dispose();
    this._baseGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== this._bandMat) o.material.dispose();
    });
  }
}

export { TOTAL_H, BASE_H, GLASS_H };
