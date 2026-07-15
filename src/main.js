// 감정 유리 주조 — 오케스트레이터.
// Phase 흐름: idle → live(유리구슬 축적) → casting(용융/냉각) → result(보존).
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
import { FoundryAtmosphere } from './atmosphere.js';

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
const resultCard = $('.result-card');
const resultPanelToggle = $('#result-panel-toggle');
const resultPanelBody = $('#result-panel-body');
const compareBar = $('#compare-bar');
const castFeedback = $('#cast-feedback');

const CAST_COLORS = ['#f5a524', '#e4573d', '#3b82f6'];
const castSound = new CastSound();

// 브라우저별 자동재생 정책에 가장 확실한 시점은 click보다 앞선 실제 pointerdown/keydown이다.
// 캡처 단계에서 먼저 컨텍스트를 깨우면 새로고침·다시하기·백그라운드 복귀 뒤에도
// 이어지는 감정 버튼 핸들러가 이미 running 상태의 오디오를 사용할 수 있다.
const armCastAudio = () => castSound.unlock().catch(() => {});
window.addEventListener('pointerdown', armCastAudio, { capture: true, passive: true });
window.addEventListener('touchend', armCastAudio, { capture: true, passive: true });
window.addEventListener('click', armCastAudio, { capture: true, passive: true });
window.addEventListener('keydown', armCastAudio, { capture: true });

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const readViewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
  portrait: window.innerWidth <= 680 && window.innerHeight > window.innerWidth,
  compact: window.innerWidth <= 900 || coarsePointer,
});
let viewport = readViewport();
const renderPixelRatio = () => Math.min(window.devicePixelRatio || 1, viewport.compact ? 1.35 : 2);

// ─────────────────────────────────────────────────────────────
// 렌더러 / 씬 / 카메라 / 조명
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(renderPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Emotion Foundry — 색은 오브젝트에서만 나오고 공간은 거의 무채색으로 유지한다.
renderer.setClearColor(0x050609, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050609);
scene.fog = new THREE.FogExp2(0x050609, 0.018);

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

// 검은 주조실 — 아이보리 키와 코발트 림이 유리의 두께만 드러낸다.
const ambient = new THREE.HemisphereLight(0xc7d0e8, 0x020306, 0.11);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xf5f0df, 0.24);
key.position.set(4.8, 8.5, 6.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.target.position.set(0, 2, 0);

const rim = new THREE.DirectionalLight(0x6d86ff, 1.8);
rim.position.set(-5.5, 6.5, -6.5);
rim.target.position.set(0, 2.2, 0);

const fill = new THREE.PointLight(0xe6e1d4, 0.08, 18, 2);
fill.position.set(4.2, 2.5, 4.4);

const stage = new THREE.SpotLight(0xf3eddd, 0.75, 18, 0.3, 0.92, 1.5);
stage.position.set(0, 7.5, 3.5);
stage.target.position.set(0, 0.15, 0);

const casting = new THREE.PointLight(0xff9d35, 0, 4.6, 2);
const impactLight = new THREE.PointLight(0xffffff, 0, 2.8, 2);
const sweepLight = new THREE.PointLight(0xffe5ba, 0, 8.5, 1.6);
const glassKey = new THREE.RectAreaLight(0x8ba0ff, 2.4, 2.2, 5.8);
glassKey.position.set(-3.7, 3.1, -2.6);
glassKey.lookAt(0, 2.2, 0);
const glassEdge = new THREE.RectAreaLight(0xf5f0df, 1.5, 1.4, 4.8);
glassEdge.position.set(3.8, 2.8, 1.4);
glassEdge.lookAt(0, 2.1, 0);
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
  sweepLight,
  glassKey,
  glassEdge
);

// 무광 주조실 바닥. 경기장 언어는 영상에만 남기고 무대는 하나의 재료 체계로 통일한다.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(12, 96),
  new THREE.MeshBasicMaterial({ color: 0x050609 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.035;
floor.receiveShadow = true;
scene.add(floor);

const stageRing = new THREE.Mesh(
  new THREE.TorusGeometry(2.05, 0.012, 8, 128),
  new THREE.MeshBasicMaterial({
    color: 0x9aa5a2,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  })
);
stageRing.rotation.x = Math.PI / 2;
stageRing.position.y = 0.008;
scene.add(stageRing);

const atmosphere = new FoundryAtmosphere({ density: viewport.compact ? 0.62 : 1 });
// The atmosphere system remains available for future environments, but this
// casting scene deliberately contains no decorative particle field.

// 블룸은 재질을 대신하지 않는다. 가장 밝은 유리 하이라이트에만 약하게 남긴다.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.14,
  0.35,
  0.82
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
cinematic.setViewport(viewport.width, viewport.height);
cinematic.resetIdle(true);
controls.enableZoom = !viewport.compact;
controls.minDistance = viewport.compact ? 7.2 : 5.2;
controls.maxDistance = viewport.compact ? 18 : 14;
atmosphere.setPixelRatio(renderPixelRatio());

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

function setResultPanelExpanded(expanded) {
  resultCard.classList.toggle('is-collapsed', !expanded);
  resultPanelToggle.setAttribute('aria-expanded', String(expanded));
  resultPanelToggle.setAttribute('aria-label', expanded ? 'Hide result information' : 'Show result information');
  resultPanelBody.setAttribute('aria-hidden', String(!expanded));
  resultPanelBody.toggleAttribute('inert', !expanded);
  $('.result-panel-toggle-label').textContent = expanded ? 'HIDE RESULT INFO' : 'VIEW RESULT INFO';
}

function resetResultPanel() {
  // 손가락 기반 기기에서는 트로피를 먼저 보여주고 정보는 사용자가 원할 때 연다.
  setResultPanelExpanded(!viewport.compact);
}

resultPanelToggle.addEventListener('click', () => {
  setResultPanelExpanded(resultPanelToggle.getAttribute('aria-expanded') !== 'true');
});

function installDormantTrophy() {
  sculpture = new Trophy(0x454d4f54);
  sculpture.setPixelRatio(renderPixelRatio());
  scene.add(sculpture.group);
}

installDormantTrophy();

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
  ctx.fillStyle = 'rgba(221, 226, 242, 0.54)';
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
    color: 0x8ea3ff,
    transparent: true,
    opacity: 0.28,
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
  document.body.classList.remove('is-result');
  atmosphere.reset();
  castSound.reset();
  // 시작 점화음으로 오디오 활성화를 즉시 확인한다. 준비 중 입력된 소리는 큐에 보존된다.
  castSound.wake();
  session = createSession();
  // 결산용 라이브 카운터 — 탭 횟수와 홀드 누적 시간
  session.stats = { yesTaps: 0, noTaps: 0, holdMs: 0 };
  session.materials = [];
  if (sculpture) {
    scene.remove(sculpture.group);
    sculpture.dispose();
  }
  sculpture = new Trophy(sessionSeed(session));
  sculpture.setPixelRatio(renderPixelRatio());
  scene.add(sculpture.group);
  sculpture.beginLive();

  input = new InputController({
    onVisualPulse: (emo, detail) => {
      flashButton(emo);
      launchGlassBead(emo, detail);
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
  phaseTag.textContent = 'COLLECTING / GLASS IN MOLD';
  document.body.classList.add('is-live');
  // 점화 클로즈업에서 시작해 주조선과 함께 올라가는 카메라·조명 시퀀스.
  cinematic.beginLive();
}

// ─────────────────────────────────────────────────────────────
// Phase: 종료 → 박제 화면
// ─────────────────────────────────────────────────────────────
async function endMatch() {
  if (phase !== 'live') return;
  phase = 'casting';
  const finishingSession = session;
  input.disable();
  castFeedback.replaceChildren();
  session.endedAt = Date.now();
  resultEl.hidden = true;
  document.body.classList.add('is-revealing');
  document.body.classList.add('is-result');
  resetResultPanel();

  // 같은 구슬들이 아래에서 위로 연화되고 겹쳐진 뒤 투명한 한 몸으로 냉각된다.
  sculpture.finishCast();
  revealCamera();
  window.setTimeout(() => {
    if (phase !== 'casting' || session !== finishingSession) return;
    phase = 'result';
    document.body.classList.remove('is-revealing');
    resultEl.hidden = false;
    if (ruler) ruler.group.visible = !viewport.portrait;
    phaseTag.textContent = 'COOLED / MOVE TO INSPECT';
  }, 5400);

  session.signatureHash = await computeSculptureHash(session);
  saveSession(session);

  endBtn.hidden = true;
  palette.hidden = true;
  phaseTag.textContent = 'MELTING / FUSING / COOLING';

  $('#r-beats').textContent = `${session.materials.length} beads`;
  $('#r-hash').textContent = session.signatureHash.slice(0, 24) + '…';
  $('#r-duration').textContent = fmtTime(elapsed);
  $('#mint-status').textContent = '';
  $('#mint-result').hidden = true;
  $('.result-details').open = false;
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
  // 변형을 계속 바라보며 천천히 전체 형상으로 물러난다.
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
// 입력 인과 사슬 — 버튼에서 집어 든 유리구슬이 몰드 입구까지 이동하고,
// 그 자리에서 실제 3D 구슬이 되어 내부로 떨어진다.
// ─────────────────────────────────────────────────────────────
function castTargetScreen() {
  if (!sculpture) return { x: window.innerWidth / 2, y: window.innerHeight * 0.48 };
  const local = new THREE.Vector3(0, BASE_H + GLASS_H + 0.08, 0);
  const world = sculpture.group.localToWorld(local);
  const ndc = world.project(camera);
  return {
    x: (ndc.x * 0.5 + 0.5) * window.innerWidth,
    y: (-ndc.y * 0.5 + 0.5) * window.innerHeight,
  };
}

function placeGlassBead(emo, detail, soundVoice) {
  if (phase === 'live' && sculpture) {
    const countBefore = sculpture.materials.length;
    const isFull = sculpture.insertSphere(emo, detail);
    if (sculpture.materials.length > countBefore) {
      session.materials.push({
        emotion: emo,
        atMs: Math.round(elapsed),
        holdStep: detail.holdStep || 0,
      });
      sculpture.impact(emo);
      cinematic.impact(emo, sculpture.castFrontY());
    }
    if (isFull && !session.autoCastQueued) {
      session.autoCastQueued = true;
      phaseTag.textContent = 'MOLD FULL / CASTING';
      window.setTimeout(() => endMatch(), 900);
    }
  }
  castSound.impact(emo, soundVoice);
}

function launchGlassBead(emo, detail = {}) {
  if (phase !== 'live' || !sculpture) return;
  const btn = palette.querySelector(`[data-emo="${emo}"]`);
  if (!btn) return;

  const rect = btn.getBoundingClientRect();
  const start = { x: rect.left + rect.width / 2, y: rect.top + 8 };
  const orb = document.createElement('span');
  orb.className = `cast-bead cast-bead--${emo}`;
  orb.style.setProperty('--cast-color', CAST_COLORS[emo]);
  orb.innerHTML = '<i></i>';
  castFeedback.appendChild(orb);

  btn.classList.add('sending');
  window.clearTimeout(btn._sendingTimer);
  btn._sendingTimer = window.setTimeout(() => btn.classList.remove('sending'), 420);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduceMotion ? 240 : emo === 2 ? 520 : 600;
  const bornAt = performance.now();
  const sourcePan = clampScreenPan(start.x);
  const soundVoice = castSound.launch(emo, detail, { duration: duration / 1000, pan: sourcePan });

  function fly(now) {
    if (!orb.isConnected) return;
    const raw = Math.min(1, (now - bornAt) / duration);
    const t = 1 - Math.pow(1 - raw, 3);
    const target = castTargetScreen();
    const control = {
      x: start.x + (target.x - start.x) * 0.34,
      y: Math.min(start.y, target.y) - (reduceMotion ? 18 : 48),
    };
    const omt = 1 - t;
    const x = omt * omt * start.x + 2 * omt * t * control.x + t * t * target.x;
    const y = omt * omt * start.y + 2 * omt * t * control.y + t * t * target.y;
    const dx = 2 * omt * (control.x - start.x) + 2 * t * (target.x - control.x);
    const dy = 2 * omt * (control.y - start.y) + 2 * t * (target.y - control.y);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const scale = 0.82 + Math.sin(Math.PI * raw) * 0.08 - raw * 0.12;

    orb.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})`;
    orb.style.opacity = String(Math.min(1, raw * 8));

    if (raw < 1 && phase === 'live') {
      requestAnimationFrame(fly);
      return;
    }

    orb.remove();
    if (phase === 'live') placeGlassBead(emo, detail, soundVoice);
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
    sculpture.setCastProgress();
    liveProgress = sculpture.castU;

    if (elapsed >= SESSION_MS) endMatch();
  }

  if (sculpture) sculpture.update(now / 1000);
  atmosphere.update(now / 1000);
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
  seeds.forEach((s, i) => {
    const sc = new Trophy(1000 + i);
    sc.setPixelRatio(renderPixelRatio());
    sc.setBeats(s.beats);
    // 같은 뼈대, 정반대의 상처 — 라이벌 트로피는 반대편을 보인다 (§6)
    if (i === 1) sc.group.rotation.y = Math.PI;
    compareGroup.add(sc.group);
    compareTrophies.push(sc);
  });
  layoutCompareTrophies();
  scene.add(compareGroup);
}

function layoutCompareTrophies() {
  const gap = viewport.portrait ? 1.5 : 2.8;
  compareTrophies.forEach((trophy, i) => {
    trophy.group.position.x = i === 0 ? -gap : gap;
  });
}

function frameCompare() {
  const portrait = viewport.portrait;
  controls.target.set(0, portrait ? 2.1 : 2.0, 0);
  camera.position.set(0, portrait ? 2.65 : 2.4, portrait ? 15.8 : 13.2);
  camera.fov = portrait ? 46 : 42;
  camera.updateProjectionMatrix();
}

$('#compare-btn').addEventListener('click', () => {
  resultEl.hidden = true;
  if (ruler) ruler.group.visible = false;
  if (sculpture) sculpture.group.visible = false;
  if (!compareGroup) buildCompare();
  compareGroup.visible = true;
  compareBar.hidden = false;
  phase = 'compare';
  frameCompare();
  cinematic.enterCompare();
});

$('#compare-back').addEventListener('click', () => {
  if (compareGroup) compareGroup.visible = false;
  if (ruler) ruler.group.visible = !viewport.portrait;
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
  phaseTag.textContent = 'MOLD 01 / READY';
  cinematic.resetIdle(true);
  document.body.classList.remove('is-live', 'is-result');
  sculpture = null;
  installDormantTrophy();
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

function applyViewportLayout() {
  viewport = readViewport();
  const pixelRatio = renderPixelRatio();
  camera.aspect = viewport.width / viewport.height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(viewport.width, viewport.height);
  if (typeof composer.setPixelRatio === 'function') composer.setPixelRatio(pixelRatio);
  composer.setSize(viewport.width, viewport.height);
  cinematic.setViewport(viewport.width, viewport.height);
  controls.enableZoom = !viewport.compact;
  controls.minDistance = viewport.compact ? 7.2 : 5.2;
  controls.maxDistance = viewport.compact ? 18 : 14;
  atmosphere.setPixelRatio(pixelRatio);
  if (sculpture) sculpture.setPixelRatio(pixelRatio);
  compareTrophies.forEach((trophy) => trophy.setPixelRatio(pixelRatio));
  layoutCompareTrophies();

  if (ruler) ruler.group.visible = phase === 'result' && !viewport.portrait;
  if (phase === 'idle') cinematic.resetIdle(true);
  else if (phase === 'result') cinematic.showResult(true);
  else if (phase === 'compare') frameCompare();
}

window.addEventListener('resize', applyViewportLayout);

// Space가 페이지 스크롤/버튼 클릭 트리거하지 않도록
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && phase === 'live') e.preventDefault();
});
