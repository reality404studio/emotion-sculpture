// 감정 조각 — 오케스트레이터.
// Phase 흐름: idle → live(자라남) → result(박제) → compare(비교).
import './polyfills.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Trophy, BASE_H, GLASS_H } from './trophy.js';
import { InputController } from './input.js';
import {
  createSession,
  sessionSeed,
  computeSculptureHash,
  saveSession,
} from './session.js';
import { makeAdapter } from './onchain.js';
import { seedSessions } from './seed-data.js';
import { CastSound } from './sound.js';
import { CinematicDirector } from './cinematic.js';

// ── 타이밍 ──
const TICK_MS = 700; // 링 하나 = 0.7s (§5.5)
const SESSION_MS = 180_000; // 3분 하이라이트 (§2)

// ── DOM ──
const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const startBtn = $('#start-btn');
const endBtn = $('#end-btn');
const palette = $('#palette');
const phaseTag = $('#phase-tag');
const resultEl = $('#result');
const compareBar = $('#compare-bar');
const castFeedback = $('#cast-feedback');

const CAST_COLORS = ['#f5a524', '#e4573d', '#3b82f6'];
const castSound = new CastSound();

// ─────────────────────────────────────────────────────────────
// 렌더러 / 씬 / 카메라 / 조명
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// 스타디움 나이트 — 가산 블렌딩 파티클의 발광은 어두운 무대에서만 산다
renderer.setClearColor(0x0a0d18, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d18);
scene.fog = new THREE.FogExp2(0x0a0d18, 0.012);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 2.3, 8.4);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 5.2;
controls.maxDistance = 14;
controls.autoRotate = false;
controls.target.set(0, 2.05, 0);

// 어두운 주조 의식 — 차가운 윤곽 위를 따뜻한 주조광이 올라간다.
const ambient = new THREE.HemisphereLight(0x7188d8, 0x080b13, 0.13);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffe0b0, 0.24);
key.position.set(4.8, 8.5, 6.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.target.position.set(0, 2, 0);

const rim = new THREE.DirectionalLight(0x7695ff, 1.8);
rim.position.set(-5.5, 6.5, -6.5);
rim.target.position.set(0, 2.2, 0);

const fill = new THREE.PointLight(0xffb66b, 0.08, 18, 2);
fill.position.set(4.2, 2.5, 4.4);

const stage = new THREE.SpotLight(0xffd29a, 0.75, 18, 0.36, 0.9, 1.5);
stage.position.set(0, 7.5, 3.5);
stage.target.position.set(0, 0.15, 0);

const casting = new THREE.PointLight(0xff9d35, 0, 4.6, 2);
const impactLight = new THREE.PointLight(0xffffff, 0, 2.8, 2);
const sweepLight = new THREE.PointLight(0xffe5ba, 0, 8.5, 1.6);
scene.add(
  key,
  key.target,
  rim,
  rim.target,
  fill,
  stage,
  stage.target,
  casting,
  impactLight,
  sweepLight
);

// 야간 피치 — 잔디 그린 바닥 + 은은한 후광
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(10, 96),
  new THREE.MeshStandardMaterial({
    color: 0x12391e,
    roughness: 0.88,
    metalness: 0.02,
    emissive: new THREE.Color(0x0a2e12),
    emissiveIntensity: 0.14,
  })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.035;
floor.receiveShadow = true;
scene.add(floor);

// 블룸 — 파티클과 주조선이 물리적으로 빛나게 (다크 스테이지 전제)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,
  0.72,
  0.55
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const cinematic = new CinematicDirector({
  camera,
  controls,
  renderer,
  bloomPass,
  baseHeight: BASE_H,
  totalHeight: BASE_H + GLASS_H,
  lights: {
    ambient,
    key,
    rim,
    fill,
    stage,
    casting,
    impact: impactLight,
    sweep: sweepLight,
  },
});

// ─────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────
let phase = 'idle';
let session = null;
let sculpture = null;
let input = null;
let compareGroup = null;
let compareTrophies = [];
let ruler = null; // 결과 화면의 발광 시간 눈금자

const fmtTime = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ─────────────────────────────────────────────────────────────
// 시간 눈금자 — y=0(트로피 바닥)부터 기록 종료 시각까지, 30초 간격.
// 자 몸통 없이 흰색 발광 눈금선만. 분 단위는 길게, 30초는 짧게.
// ─────────────────────────────────────────────────────────────
function makeTickLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 30px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(238, 244, 255, 0.92)';
  ctx.fillText(text, 6, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.8, depthWrite: false })
  );
  sprite.scale.set(0.62, 0.248, 1);
  return sprite;
}

function buildRuler(durationMs) {
  const group = new THREE.Group();
  const durS = Math.max(1, Math.round(durationMs / 1000));
  const x0 = 1.72;
  const yAt = (s) => BASE_H + (s / durS) * GLASS_H;

  const points = [];
  const addTick = (s, len) => points.push(x0, yAt(s), 0, x0 + len, yAt(s), 0);
  addTick(0, 0.3);
  for (let s = 30; s < durS; s += 30) addTick(s, s % 60 === 0 ? 0.3 : 0.16);
  addTick(durS, 0.4); // 최상단 = 기록을 끝낸 시각

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.LineSegments(geom, mat));

  const labels = [[0, '0:00']];
  for (let s = 60; s < durS; s += 60) labels.push([s, fmtTime(s * 1000)]);
  labels.push([durS, fmtTime(durS * 1000)]);
  for (const [s, text] of labels) {
    const sprite = makeTickLabel(text);
    sprite.position.set(x0 + 0.72, yAt(s), 0);
    group.add(sprite);
  }

  scene.add(group);
  return {
    group,
    dispose() {
      scene.remove(group);
      geom.dispose();
      mat.dispose();
      group.traverse((o) => {
        if (o.isSprite) {
          o.material.map.dispose();
          o.material.dispose();
        }
      });
    },
  };
}

let acc = 0;
let last = performance.now();
let elapsed = 0;
let liveProgress = 0;

// ─────────────────────────────────────────────────────────────
// Phase: 시작
// ─────────────────────────────────────────────────────────────
function startMatch() {
  if (phase !== 'idle') return;
  castSound.reset();
  // Start 제스처에서 잠금 해제를 시작한다. 준비 중 들어온 감정음은 CastSound가 큐에 보존한다.
  castSound.unlock().catch(() => {});
  session = createSession();
  // 결산용 라이브 카운터 — 탭 횟수와 홀드 누적 시간
  session.stats = { yesTaps: 0, noTaps: 0, holdMs: 0 };
  sculpture = new Trophy(sessionSeed(session));
  scene.add(sculpture.group);
  // live 시간 매핑: 3분 = 트로피 전체 높이 (조기 종료 시 finishCast가 재정규화)
  sculpture.beginLive(Math.round(SESSION_MS / TICK_MS));

  input = new InputController({
    onVisualPulse: (emo, detail) => {
      flashButton(emo);
      launchCastParticle(emo, detail);
      if (emo === 0) session.stats.yesTaps++;
      if (emo === 1) session.stats.noTaps++;
    },
    onHoldEnd: (holdStep) => castSound.releaseHold(holdStep),
  });
  input.enable();

  phase = 'live';
  elapsed = 0;
  liveProgress = 0;
  acc = 0;
  last = performance.now();

  startBtn.hidden = true;
  endBtn.hidden = false;
  palette.hidden = false;
  resultEl.hidden = true;
  phaseTag.textContent = 'Casting — pour your emotions';
  document.body.classList.add('is-live');
  // 점화 클로즈업에서 시작해 주조선과 함께 올라가는 카메라·조명 시퀀스.
  cinematic.beginLive();
}

// ─────────────────────────────────────────────────────────────
// Phase: 종료 → 박제 화면
// ─────────────────────────────────────────────────────────────
async function endMatch() {
  if (phase !== 'live') return;
  phase = 'result';
  const finishingSession = session;
  input.disable();
  castFeedback.replaceChildren();
  session.endedAt = Date.now();
  resultEl.hidden = true;
  document.body.classList.add('is-revealing');

  // 종료 휘슬 = 주조 완료. 남은 재료가 마저 부어지고 상단 돔이 닫힌다 (§2.2)
  sculpture.finishCast();
  revealCamera();
  window.setTimeout(() => {
    if (phase !== 'result' || session !== finishingSession) return;
    document.body.classList.remove('is-revealing');
    resultEl.hidden = false;
    if (ruler) ruler.group.visible = true;
  }, 2200);

  session.signatureHash = await computeSculptureHash(session);
  saveSession(session);

  endBtn.hidden = true;
  palette.hidden = true;
  phaseTag.textContent = 'Cast complete — rotate your trophy';

  $('#r-beats').textContent = String(session.beats.length);
  $('#r-hash').textContent = session.signatureHash.slice(0, 24) + '…';
  $('#r-duration').textContent = fmtTime(elapsed);
  $('#mint-status').textContent = '';
  $('#mint-result').hidden = true;
  fillReport(elapsed);

  // 시간 눈금자 — 이 세션의 실제 기록 길이에 맞춰 생성
  if (ruler) ruler.dispose();
  ruler = buildRuler(elapsed);
  ruler.group.visible = false;
}

// ─────────────────────────────────────────────────────────────
// 결산 — 횟수·홀드 시간·시간 점유율 파이 (beat.kind 기준)
// ─────────────────────────────────────────────────────────────
function fillReport(durationMs) {
  const total = Math.max(1, session.beats.length);
  const count = { tap: 0, single: 0, hold: 0 };
  for (const b of session.beats) if (b.kind in count) count[b.kind]++;
  const pctYes = (count.tap / total) * 100;
  const pctNo = (count.single / total) * 100;
  const pctHold = (count.hold / total) * 100;
  const pctQuiet = Math.max(0, 100 - pctYes - pctNo - pctHold);
  const p1 = pctYes;
  const p2 = p1 + pctNo;
  const p3 = p2 + pctHold;

  $('#pie').style.background = `conic-gradient(
    var(--gold) 0 ${p1}%,
    var(--red) ${p1}% ${p2}%,
    #4a8dff ${p2}% ${p3}%,
    #262c48 ${p3}% 100%)`;
  $('#rep-yes').textContent = `${session.stats.yesTaps}× · ${pctYes.toFixed(0)}%`;
  $('#rep-no').textContent = `${session.stats.noTaps}× · ${pctNo.toFixed(0)}%`;
  $('#rep-hold').textContent = `${fmtTime(session.stats.holdMs)} · ${pctHold.toFixed(0)}%`;
  $('#rep-quiet').textContent = `${pctQuiet.toFixed(0)}%`;
}

function revealCamera() {
  // 짧은 암전 → 아래에서 위로 훑는 광선 → 전체 형상을 드러내는 히어로 풀백.
  cinematic.finish();
}

// ─────────────────────────────────────────────────────────────
// 버튼 시각 피드백
// ─────────────────────────────────────────────────────────────
function flashButton(emo) {
  const btn = palette.querySelector(`[data-emo="${emo}"]`);
  if (!btn) return;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 240);
}

// ─────────────────────────────────────────────────────────────
// 입력 인과 사슬 — 버튼에서 태어난 빛 조각이 실제 3D 주조선까지 날아간 뒤 충돌한다.
// 버튼 반응과 트로피 반응을 같은 프레임에 터뜨리지 않고, 이동 시간을 사이에 둔다.
// ─────────────────────────────────────────────────────────────
function castTargetScreen(lift = 0) {
  if (!sculpture) return { x: window.innerWidth / 2, y: window.innerHeight * 0.48 };
  const local = new THREE.Vector3(0, sculpture.castFrontY() + 0.08 + lift, 0);
  const world = sculpture.group.localToWorld(local);
  const ndc = world.project(camera);
  return {
    x: (ndc.x * 0.5 + 0.5) * window.innerWidth,
    y: (-ndc.y * 0.5 + 0.5) * window.innerHeight,
  };
}

function showCastImpact(point, emo, soundVoice) {
  const impact = document.createElement('span');
  impact.className = `cast-impact cast-impact--${emo}`;
  impact.style.setProperty('--cast-color', CAST_COLORS[emo]);
  impact.style.left = `${point.x}px`;
  impact.style.top = `${point.y}px`;
  impact.innerHTML = '<i></i><b>✦</b>';
  castFeedback.appendChild(impact);
  impact.addEventListener('animationend', (ev) => {
    if (ev.target === impact) impact.remove();
  });

  if (phase === 'live' && sculpture) {
    sculpture.impact(emo);
    cinematic.impact(emo, sculpture.castFrontY());
  }
  castSound.impact(emo, soundVoice);
}

function launchCastParticle(emo, detail = {}) {
  if (phase !== 'live' || !sculpture) return;
  const btn = palette.querySelector(`[data-emo="${emo}"]`);
  if (!btn) return;

  const rect = btn.getBoundingClientRect();
  const start = { x: rect.left + rect.width / 2, y: rect.top + 8 };
  const orb = document.createElement('span');
  orb.className = `cast-orb cast-orb--${emo}`;
  orb.style.setProperty('--cast-color', CAST_COLORS[emo]);
  orb.innerHTML = '<i></i>';
  castFeedback.appendChild(orb);

  btn.classList.add('sending');
  window.clearTimeout(btn._sendingTimer);
  btn._sendingTimer = window.setTimeout(() => btn.classList.remove('sending'), 420);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduceMotion ? 240 : emo === 2 ? 500 : 620;
  const bornAt = performance.now();
  // HOLD 재료는 1초 안에도 착지점이 눈에 띄게 상승한다. 한 번의 홀드가 끝나면 0부터 다시 시작한다.
  const targetLift = emo === 2 ? Math.min(1.15, (detail.holdStep || 0) * 0.16) : 0;
  const sourcePan = clampScreenPan(start.x);
  const soundVoice = castSound.launch(emo, detail, { duration: duration / 1000, pan: sourcePan });

  function fly(now) {
    if (!orb.isConnected) return;
    const raw = Math.min(1, (now - bornAt) / duration);
    const t = 1 - Math.pow(1 - raw, 3);
    const target = castTargetScreen(targetLift);
    const control = {
      x: start.x + (target.x - start.x) * 0.34,
      y: Math.min(start.y, target.y) - (reduceMotion ? 24 : 112),
    };
    const omt = 1 - t;
    const x = omt * omt * start.x + 2 * omt * t * control.x + t * t * target.x;
    const y = omt * omt * start.y + 2 * omt * t * control.y + t * t * target.y;
    const dx = 2 * omt * (control.x - start.x) + 2 * t * (target.x - control.x);
    const dy = 2 * omt * (control.y - start.y) + 2 * t * (target.y - control.y);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const scale = 0.72 + Math.sin(Math.PI * raw) * 0.5 + raw * 0.18;

    orb.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})`;
    orb.style.opacity = String(Math.min(1, raw * 8));

    if (raw < 1 && phase === 'live') {
      requestAnimationFrame(fly);
      return;
    }

    orb.remove();
    if (phase === 'live') showCastImpact(target, emo, soundVoice);
  }

  requestAnimationFrame(fly);
}

function clampScreenPan(x) {
  return Math.max(-0.78, Math.min(0.78, (x / window.innerWidth) * 2 - 1));
}

// 팔레트 입력 배선 (마우스/터치 + 키보드는 InputController 내부)
palette.querySelectorAll('.emo-btn').forEach((btn) => {
  const emo = Number(btn.dataset.emo);
  if (emo === 0) {
    btn.addEventListener('pointerdown', () => input && input.tapYes());
  } else if (emo === 1) {
    btn.addEventListener('pointerdown', () => input && input.tapNo());
  } else if (emo === 2) {
    btn.addEventListener('pointerdown', (ev) => {
      btn.setPointerCapture(ev.pointerId);
      if (input) input.holdPleaseStart();
    });
    btn.addEventListener('pointerup', (ev) => {
      if (btn.hasPointerCapture(ev.pointerId)) btn.releasePointerCapture(ev.pointerId);
      if (input) input.holdPleaseEnd();
    });
    btn.addEventListener('lostpointercapture', () => input && input.holdPleaseEnd());
    btn.addEventListener('pointercancel', () => input && input.holdPleaseEnd());
  }
});

// ─────────────────────────────────────────────────────────────
// tick: 강도 스냅샷 → 내부 재료 필드에 기록
// ─────────────────────────────────────────────────────────────
function tick() {
  const { e, kind } = input.tick();
  const beat = { t: session.beats.length, e, kind };
  session.beats.push(beat);
  sculpture.addBeat(beat); // 주조선 아래로 응고 — 이후 소급 변경 불가
}

// ─────────────────────────────────────────────────────────────
// 애니메이션 루프
// ─────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = now - last;
  last = now;

  if (phase === 'live') {
    // 주조선 재질은 매 프레임, 영구 기록은 tick에서만 (§4 즉각+잔향 분리)
    sculpture.setLive(input.intensities);
    if (input.holding) session.stats.holdMs += dt; // 결산용 홀드 누적
    acc += dt;
    elapsed += dt;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      tick();
    }
    const p = Math.min(1, elapsed / SESSION_MS);
    liveProgress = p;
    sculpture.setCastProgress(p);

    if (elapsed >= SESSION_MS) endMatch();
  }

  if (sculpture) sculpture.update(now / 1000);
  compareTrophies.forEach((t) => t.update(now / 1000));
  cinematic.update(dt / 1000, {
    progress: liveProgress,
    castY: sculpture ? sculpture.castFrontY() : BASE_H,
  });
  // 눈금자는 항상 화면 오른쪽에 보이도록 카메라 방위각을 따라 돈다
  if (ruler && ruler.group.visible) {
    ruler.group.rotation.y = Math.atan2(camera.position.x, camera.position.z);
  }
  controls.update();
  composer.render();
}
animate();

// ─────────────────────────────────────────────────────────────
// 마우스 휘휘 — 완성된 트로피의 입자를 저으면 흩어졌다 홈으로 모인다
// ─────────────────────────────────────────────────────────────
const stirRay = new THREE.Raycaster();
const stirNdc = new THREE.Vector2();
const stirHit = new THREE.Vector3();
let lastStirX = 0;
let lastStirY = 0;
let lastStirAt = 0;
let lastStirDx = 0;
let lastStirDy = 0;
canvas.addEventListener('pointermove', (ev) => {
  const now = performance.now();
  const dx = ev.clientX - lastStirX;
  const dy = ev.clientY - lastStirY;
  const continuous = lastStirAt > 0 && now - lastStirAt < 150;
  const speed = continuous ? Math.min(1, Math.hypot(dx, dy) / 42) : 0;
  lastStirX = ev.clientX;
  lastStirY = ev.clientY;
  lastStirAt = now;
  if (phase !== 'result' && phase !== 'compare') {
    lastStirDx = 0;
    lastStirDy = 0;
    return;
  }
  if (speed < 0.02) return;

  const previousLength = Math.hypot(lastStirDx, lastStirDy);
  const currentLength = Math.hypot(dx, dy);
  const directionDot = previousLength > 0 && currentLength > 0
    ? (dx * lastStirDx + dy * lastStirDy) / (previousLength * currentLength)
    : 1;
  const sharpTurn = speed > 0.2 && previousLength > 4 && directionDot < -0.12;
  lastStirDx = dx;
  lastStirDy = dy;

  stirNdc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
  stirRay.setFromCamera(stirNdc, camera);
  const targets = phase === 'compare' ? compareTrophies : sculpture ? [sculpture] : [];
  let stirred = false;
  let stirHeight = 0;
  for (const trophy of targets) {
    // 트로피 축을 지나고 카메라를 향하는 평면과 레이의 교점 = 젓는 지점
    const axis = new THREE.Vector3();
    trophy.group.getWorldPosition(axis);
    axis.y = controls.target.y;
    const normal = new THREE.Vector3().subVectors(camera.position, axis).setY(0).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, axis);
    if (stirRay.ray.intersectPlane(plane, stirHit)) {
      const localPoint = trophy.group.worldToLocal(stirHit.clone());
      trophy.stir(localPoint, speed * 0.45);
      stirHeight = Math.max(stirHeight, Math.max(0, Math.min(1, (localPoint.y - BASE_H) / GLASS_H)));
      stirred = true;
    }
  }
  if (stirred) {
    castSound.stir({
      speed,
      pan: clampScreenPan(ev.clientX),
      height: stirHeight,
      turn: sharpTurn,
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 박제 (§10)
// ─────────────────────────────────────────────────────────────
$('#mint-btn').addEventListener('click', async () => {
  const useDevnet = $('#use-devnet').checked;
  const statusEl = $('#mint-status');
  const resultBox = $('#mint-result');
  const mintBtn = $('#mint-btn');
  mintBtn.disabled = true;

  const adapter = makeAdapter(useDevnet ? 'devnet' : 'mock');
  if (adapter.onStatus !== undefined) adapter.onStatus = (m) => (statusEl.textContent = m);

  statusEl.textContent = useDevnet ? 'Preparing devnet commit…' : 'Mock commit…';
  try {
    const res = await adapter.commitSculpture(session);
    resultBox.hidden = false;
    const box = resultBox.querySelector('.explorer');
    if (res.explorerUrl) {
      statusEl.textContent = '✓ Committed on devnet for real.';
      box.innerHTML = `This sculpture was written on-chain at this moment.<br/>
        <a href="${res.explorerUrl}" target="_blank" rel="noopener">View on Solana Explorer ↗</a>
        <br/><small class="mono">acct ${res.account}</small>`;
    } else {
      statusEl.textContent = '✓ Mock commit done (offline). Toggle the checkbox for a real one.';
      box.innerHTML = `<small class="mono">sig ${res.signature}</small><br/>
        <small style="color:var(--dim)">Enable "Commit to real devnet" to get an explorer link.</small>`;
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = '✗ Commit failed: ' + (err && err.message ? err.message : err) +
      ' (devnet airdrop may be rate-limited — retry shortly)';
  } finally {
    mintBtn.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────────
// 비교 뷰 (§9) — "같은 경기, 다른 형상"
// ─────────────────────────────────────────────────────────────
function buildCompare() {
  compareGroup = new THREE.Group();
  compareTrophies = [];
  const seeds = seedSessions();
  const gap = 2.8;
  seeds.forEach((s, i) => {
    const sc = new Trophy(1000 + i);
    sc.setBeats(s.beats);
    sc.group.position.x = i === 0 ? -gap : gap;
    // 같은 뼈대, 정반대의 상처 — 라이벌 트로피는 반대편을 보인다 (§6)
    if (i === 1) sc.group.rotation.y = Math.PI;
    compareGroup.add(sc.group);
    compareTrophies.push(sc);
  });
  scene.add(compareGroup);
}

$('#compare-btn').addEventListener('click', () => {
  resultEl.hidden = true;
  if (ruler) ruler.group.visible = false;
  if (sculpture) sculpture.group.visible = false;
  if (!compareGroup) buildCompare();
  compareGroup.visible = true;
  compareBar.hidden = false;
  phase = 'compare';
  controls.target.set(0, 2.0, 0);
  camera.position.set(0, 2.4, 13.2);
  camera.fov = 42;
  camera.updateProjectionMatrix();
  cinematic.enterCompare();
});

$('#compare-back').addEventListener('click', () => {
  if (compareGroup) compareGroup.visible = false;
  if (ruler) ruler.group.visible = true;
  if (sculpture) sculpture.group.visible = true;
  compareBar.hidden = true;
  resultEl.hidden = false;
  phase = 'result';
  cinematic.showResult(true);
});

$('#replay-btn').addEventListener('click', () => {
  if (sculpture) {
    scene.remove(sculpture.group);
    sculpture.dispose();
  }
  if (ruler) {
    ruler.dispose();
    ruler = null;
  }
  resultEl.hidden = true;
  castFeedback.replaceChildren();
  castSound.stopStir();
  phase = 'idle';
  liveProgress = 0;
  startBtn.hidden = false;
  phaseTag.textContent = 'Before kickoff';
  cinematic.resetIdle(true);
  document.body.classList.remove('is-live');
});

// ─────────────────────────────────────────────────────────────
// 유튜브 링크 → 임베드. 어떤 형태의 URL이든 video id를 뽑아 nocookie로 재생.
// 채널이 임베드를 막은 영상은 유튜브 정책상 재생 불가 — 안내만 남긴다.
// ─────────────────────────────────────────────────────────────
const videoPanel = $('#video-panel');
const videoToggle = $('#video-toggle');
const videoContent = $('#video-content');

function setVideoExpanded(expanded) {
  videoPanel.classList.toggle('is-collapsed', !expanded);
  videoToggle.setAttribute('aria-expanded', String(expanded));
  videoToggle.setAttribute('aria-label', expanded ? 'Hide YouTube highlight' : 'Open YouTube highlight');
  videoToggle.title = expanded ? 'Hide video — audio keeps playing' : 'Open YouTube highlight';
  videoContent.setAttribute('aria-hidden', String(!expanded));
  videoContent.toggleAttribute('inert', !expanded);
  $('.video-toggle-label').textContent = expanded ? 'Hide video' : 'Highlight';
}

videoToggle.addEventListener('click', () => {
  setVideoExpanded(videoToggle.getAttribute('aria-expanded') !== 'true');
});

videoPanel.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || videoToggle.getAttribute('aria-expanded') !== 'true') return;
  setVideoExpanded(false);
  videoToggle.focus();
});

function parseYouTubeId(url) {
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /[?&]v=([\w-]{11})/,
    /embed\/([\w-]{11})/,
    /shorts\/([\w-]{11})/,
    /live\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return /^[\w-]{11}$/.test(url.trim()) ? url.trim() : null;
}

function loadVideo() {
  const url = $('#yt-url').value;
  const note = $('#video-note');
  const id = parseYouTubeId(url);
  if (!id) {
    note.textContent = 'That does not look like a YouTube link.';
    return;
  }
  $('#highlight').src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`;
  note.textContent = 'If it refuses to play, the channel blocks embedding — try another clip.';
}
$('#yt-load').addEventListener('click', loadVideo);
$('#yt-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadVideo();
  e.stopPropagation(); // 입력 중 J/F/Space가 감정 입력으로 새지 않게
});

startBtn.addEventListener('click', startMatch);
endBtn.addEventListener('click', endMatch);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// Space가 페이지 스크롤/버튼 클릭 트리거하지 않도록
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && phase === 'live') e.preventDefault();
});
