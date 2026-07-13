// 감정 조각 — 오케스트레이터.
// Phase 흐름: idle → live(자라남) → result(박제) → compare(비교).
import './polyfills.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { Sculpture, LAYER_HEIGHT } from './sculpture.js';
import { InputController } from './input.js';
import {
  createSession,
  sessionSeed,
  computeSculptureHash,
  saveSession,
} from './session.js';
import { makeAdapter } from './onchain.js';
import { seedSessions } from './seed-data.js';
import { EMOTIONS } from './emotions.js';

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
const progressFill = $('#progress-fill');
const resultEl = $('#result');
const compareBar = $('#compare-bar');

// ─────────────────────────────────────────────────────────────
// 렌더러 / 씬 / 카메라 / 조명 / bloom
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
scene.fog = new THREE.FogExp2(0x05070c, 0.02);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 3, 12);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.6;
controls.target.set(0, 2, 0);

// 은은한 조명 1~2개 (§5.4)
scene.add(new THREE.AmbientLight(0x334455, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(5, 10, 7);
scene.add(key);
const rim = new THREE.PointLight(0x3b82f6, 0.5, 40);
rim.position.set(-6, 4, -6);
scene.add(rim);

// bloom: 밝은(격렬한) 정점이 피어오른다 (§5.4)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85, // strength
  0.5, // radius
  0.18 // threshold
);
composer.addPass(bloom);

// 바닥 그리드(공간감)
const grid = new THREE.GridHelper(60, 60, 0x1b2430, 0x0e141d);
grid.position.y = -0.02;
scene.add(grid);

// ─────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────
let phase = 'idle';
let session = null;
let sculpture = null;
let input = null;
let compareGroup = null;

let acc = 0;
let last = performance.now();
let elapsed = 0;

// ─────────────────────────────────────────────────────────────
// Phase: 시작
// ─────────────────────────────────────────────────────────────
function startMatch() {
  session = createSession();
  sculpture = new Sculpture(sessionSeed(session));
  scene.add(sculpture.mesh);

  input = new InputController({ onVisualPulse: flashButton });
  input.enable();

  phase = 'live';
  elapsed = 0;
  acc = 0;
  last = performance.now();

  startBtn.hidden = true;
  endBtn.hidden = false;
  palette.hidden = false;
  resultEl.hidden = true;
  phaseTag.textContent = '진행 중 — 감정을 흘려보내세요';
  controls.autoRotateSpeed = 0.6;
}

// ─────────────────────────────────────────────────────────────
// Phase: 종료 → 박제 화면
// ─────────────────────────────────────────────────────────────
async function endMatch() {
  if (phase !== 'live') return;
  phase = 'result';
  input.disable();
  session.endedAt = Date.now();

  session.signatureHash = await computeSculptureHash(session);
  saveSession(session);

  endBtn.hidden = true;
  palette.hidden = true;
  phaseTag.textContent = '완성 — 조각을 돌려보세요';

  $('#r-beats').textContent = String(session.beats.length);
  $('#r-hash').textContent = session.signatureHash.slice(0, 24) + '…';
  $('#mint-status').textContent = '';
  $('#mint-result').hidden = true;
  resultEl.hidden = false;

  // 카메라가 멀어지며 전체 조각이 드러난다 (부록2, step 4)
  revealCamera();
}

function revealCamera() {
  const h = sculpture.height;
  controls.target.set(0, h / 2, 0);
  const dist = Math.max(10, h * 0.9 + 6);
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.autoRotateSpeed = 1.0;
}

// ─────────────────────────────────────────────────────────────
// 버튼 시각 피드백
// ─────────────────────────────────────────────────────────────
function flashButton(emo) {
  const btn = palette.querySelector(`[data-emo="${emo}"]`);
  if (!btn) return;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 140);
}

// 팔레트 입력 배선 (마우스/터치 + 키보드는 InputController 내부)
palette.querySelectorAll('.emo-btn').forEach((btn) => {
  const emo = Number(btn.dataset.emo);
  if (emo === 0) {
    btn.addEventListener('pointerdown', () => input && input.tapYes());
  } else if (emo === 1) {
    btn.addEventListener('pointerdown', () => input && input.tapNo());
  } else if (emo === 2) {
    btn.addEventListener('pointerdown', () => input && input.holdPleaseStart());
    btn.addEventListener('pointerup', () => input && input.holdPleaseEnd());
    btn.addEventListener('pointerleave', () => input && input.holdPleaseEnd());
  }
});

// ─────────────────────────────────────────────────────────────
// tick: 강도 스냅샷 → 링 추가
// ─────────────────────────────────────────────────────────────
function tick() {
  const { e, kind } = input.tick();
  const beat = { t: session.beats.length, e, kind };
  session.beats.push(beat);
  sculpture.addBeat(beat);

  // 성장 중 카메라가 천천히 상승하며 새 켜를 따라간다 (§5.5)
  const h = sculpture.height;
  controls.target.y += (h / 2 - controls.target.y) * 0.08;
  const desired = Math.max(9, h * 0.75 + 5);
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  const cur = dir.length();
  dir.normalize();
  camera.position.copy(controls.target).addScaledVector(dir, cur + (desired - cur) * 0.05);
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
    acc += dt;
    elapsed += dt;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      tick();
    }
    const p = Math.min(1, elapsed / SESSION_MS);
    progressFill.style.width = (p * 100).toFixed(1) + '%';
    if (elapsed >= SESSION_MS) endMatch();
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

  statusEl.textContent = useDevnet ? 'devnet 커밋 준비…' : 'mock 커밋…';
  try {
    const res = await adapter.commitSculpture(session);
    resultBox.hidden = false;
    const box = resultBox.querySelector('.explorer');
    if (res.explorerUrl) {
      statusEl.textContent = '✓ devnet에 실제로 박혔습니다.';
      box.innerHTML = `이 조각이 이 시각에 온체인에 박혔습니다.<br/>
        <a href="${res.explorerUrl}" target="_blank" rel="noopener">Solana Explorer에서 보기 ↗</a>
        <br/><small class="mono">acct ${res.account}</small>`;
    } else {
      statusEl.textContent = '✓ mock 커밋 완료 (오프라인). 실연동은 체크박스로.';
      box.innerHTML = `<small class="mono">sig ${res.signature}</small><br/>
        <small style="color:var(--dim)">"실제 devnet에 커밋"을 켜면 explorer 링크가 생깁니다.</small>`;
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = '✗ 커밋 실패: ' + (err && err.message ? err.message : err) +
      ' (devnet 에어드랍 제한일 수 있음 — 잠시 후 재시도)';
  } finally {
    mintBtn.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────────
// 비교 뷰 (§9) — "같은 경기, 다른 형상"
// ─────────────────────────────────────────────────────────────
function buildCompare() {
  compareGroup = new THREE.Group();
  const seeds = seedSessions();
  const gap = 6;
  seeds.forEach((s, i) => {
    const sc = new Sculpture(1000 + i);
    sc.setBeats(s.beats);
    sc.mesh.position.x = i === 0 ? -gap : gap;
    // 상대팀 조각은 뒤집힌 서사 — 살짝 반대로 기울여 대비
    if (i === 1) sc.mesh.rotation.y = Math.PI;
    compareGroup.add(sc.mesh);
    sc._userData = s;
  });
  scene.add(compareGroup);
}

$('#compare-btn').addEventListener('click', () => {
  resultEl.hidden = true;
  if (sculpture) sculpture.mesh.visible = false;
  if (!compareGroup) buildCompare();
  compareGroup.visible = true;
  compareBar.hidden = false;
  phase = 'compare';
  controls.target.set(0, 4, 0);
  camera.position.set(0, 5, 20);
  controls.autoRotateSpeed = 0.8;
});

$('#compare-back').addEventListener('click', () => {
  if (compareGroup) compareGroup.visible = false;
  if (sculpture) sculpture.mesh.visible = true;
  compareBar.hidden = true;
  resultEl.hidden = false;
  phase = 'result';
  revealCamera();
});

$('#replay-btn').addEventListener('click', () => {
  if (sculpture) {
    scene.remove(sculpture.mesh);
    sculpture.dispose();
  }
  resultEl.hidden = true;
  progressFill.style.width = '0%';
  phase = 'idle';
  startBtn.hidden = false;
  phaseTag.textContent = '경기 시작 전';
  controls.target.set(0, 2, 0);
  camera.position.set(0, 3, 12);
});

// ─────────────────────────────────────────────────────────────
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
