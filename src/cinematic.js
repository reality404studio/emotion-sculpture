import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const IMPACT_COLORS = [0xf5a524, 0xe4573d, 0x3b82f6];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// 카메라와 조명을 하나의 이야기로 묶는다:
// silhouette → ignition → casting track → milestone breath → sealed hero.
export class CinematicDirector {
  constructor({ camera, controls, renderer, bloomPass, lights, baseHeight, totalHeight }) {
    this.camera = camera;
    this.controls = controls;
    this.renderer = renderer;
    this.bloomPass = bloomPass;
    this.lights = lights;
    this.baseHeight = baseHeight;
    this.totalHeight = totalHeight;

    this.mode = 'idle';
    this.age = 0;
    this.impactAge = 99;
    this.impactStrength = 0;
    this.impactEmotion = 0;
    this.revealFromPos = new THREE.Vector3();
    this.revealFromTarget = new THREE.Vector3();
    this.goalPos = new THREE.Vector3();
    this.goalTarget = new THREE.Vector3();
    this.view = new THREE.Vector3();
    this.tangent = new THREE.Vector3();
    this.livePos = new THREE.Vector3();
    this.liveTarget = new THREE.Vector3();
    this.heroPos = new THREE.Vector3();
    this.heroTarget = new THREE.Vector3();
    this.viewport = { compact: false, portrait: false, landscape: false };

    this.resetIdle(true);
  }

  setViewport(width, height) {
    this.viewport.compact = width <= 900;
    this.viewport.portrait = width <= 680 && height > width;
    this.viewport.landscape = height <= 520 && width > height;
  }

  resetIdle(instant = false) {
    this.mode = 'idle';
    this.age = 0;
    this.impactAge = 99;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    const portrait = this.viewport.portrait;
    const angle = portrait ? 0.16 : 0.36;
    const distance = portrait ? 9.45 : 8.4;
    this.goalPos.set(Math.sin(angle) * distance, portrait ? 2.65 : 2.15, Math.cos(angle) * distance);
    this.goalTarget.set(0, portrait ? 2.55 : 2.2, 0);
    if (instant) {
      this.camera.position.copy(this.goalPos);
      this.controls.target.copy(this.goalTarget);
      this.camera.fov = portrait ? 43 : 40;
      this.camera.updateProjectionMatrix();
    }
    this._setLightTargets('idle', 1);
  }

  beginLive() {
    this.mode = 'live';
    this.age = 0;
    this.impactAge = 99;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  impact(emotion, worldY) {
    this.impactEmotion = emotion;
    this.impactAge = 0;
    this.impactStrength = Math.min(0.28, this.impactStrength + 0.12);
    this.lights.impact.color.setHex(IMPACT_COLORS[emotion]);
    this.lights.impact.position.set(0, worldY + 0.08, 1.35);
  }

  finish() {
    this.mode = 'reveal';
    this.age = 0;
    this.revealFromPos.copy(this.camera.position);
    this.revealFromTarget.copy(this.controls.target);
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  showResult(instant = true) {
    this.mode = 'result';
    this.age = 0;
    const portrait = this.viewport.portrait;
    const angle = portrait ? 0.16 : 0.3;
    const distance = portrait ? 9.8 : 8.15;
    this.goalTarget.set(0, portrait ? 1.68 : this.totalHeight * 0.49, 0);
    this.goalPos.set(Math.sin(angle) * distance, portrait ? 2.25 : this.totalHeight * 0.58, Math.cos(angle) * distance);
    if (instant) {
      this.camera.position.copy(this.goalPos);
      this.controls.target.copy(this.goalTarget);
      this.camera.fov = portrait ? 42 : 37;
      this.camera.updateProjectionMatrix();
    }
    this.controls.enabled = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = portrait ? 0.34 : 0.55;
    this._setLightTargets('result', 1);
  }

  enterCompare() {
    this.mode = 'compare';
    this.age = 0;
    this.controls.enabled = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this._setLightTargets('result', 1);
  }

  update(dt, { progress = 0, castY = this.baseHeight } = {}) {
    const step = Math.min(0.05, Math.max(0, dt));
    this.age += step;
    this.impactAge += step;

    if (this.mode === 'live') this._updateLive(step, progress, castY);
    else if (this.mode === 'reveal') this._updateReveal(step);
    else if (this.mode === 'idle') this._updateIdle(step);
    else this._updateStableLights(step);

    this.impactStrength *= Math.exp(-step / 0.32);
    this.lights.impact.intensity = 1.15 * this.impactStrength * Math.exp(-this.impactAge / 0.32);
  }

  _updateIdle(dt) {
    // 멈춘 화면이 아니라 숨을 참고 있는 듯한 4° 이내의 아주 느린 드리프트.
    const portrait = this.viewport.portrait;
    const baseAngle = portrait ? 0.16 : 0.36;
    const angle = baseAngle + Math.sin(this.age * 0.14) * (portrait ? 0.014 : 0.022);
    const distance = portrait ? 9.45 : 8.4;
    this.goalPos.set(Math.sin(angle) * distance, portrait ? 2.65 : 2.15, Math.cos(angle) * distance);
    this.goalTarget.set(0, portrait ? 2.55 : 2.2, 0);
    this._moveCamera(dt, portrait ? 43 : 40, 1.1);
    this._setLightTargets('idle', dt);
  }

  _updateLive(dt, progress, castY) {
    const intro = ease(this.age / 1.15);
    const portrait = this.viewport.portrait;
    const angle = (portrait ? 0.1 : 0.22) - progress * (portrait ? 0.18 : 0.32);
    let distance = (portrait ? 9.2 : 8.45) + progress * (portrait ? 0.3 : 0.4);
    // 주조선을 추적하되 몰드 전체는 프레임 안에 둔다. 형상이 자라는 과정이 먼저 읽혀야 한다.
    let targetY = (portrait ? 2.28 : 2.2) + (castY - this.baseHeight) * (portrait ? 0.055 : 0.08);
    const builtCenter = (this.baseHeight + castY) * 0.5;
    targetY += (builtCenter - targetY) * 0.12;

    this.livePos.set(Math.sin(angle) * distance, targetY + 0.34, Math.cos(angle) * distance);
    this.liveTarget.set(0, targetY, 0);
    this.goalPos.set(portrait ? 0.85 : 1.7, portrait ? 2.62 : 2.42, portrait ? 8.9 : 8.15).lerp(this.livePos, intro);
    this.goalTarget.set(0, portrait ? 2.3 : 2.15, 0).lerp(this.liveTarget, intro);

    this._moveCamera(dt, portrait ? 43 : 39.5, 3.2);
    this.lights.casting.position.set(1.15, castY + 0.22, 1.85);
    this._setLightTargets('live', dt);
  }

  _updateReveal(dt) {
    const t = ease(this.age / 5.05);
    const portrait = this.viewport.portrait;
    const angle = portrait ? 0.16 : 0.3;
    const distance = portrait ? 9.8 : 8.15;
    this.heroTarget.set(0, portrait ? 1.68 : this.totalHeight * 0.49, 0);
    this.heroPos.set(Math.sin(angle) * distance, portrait ? 2.25 : this.totalHeight * 0.58, Math.cos(angle) * distance);
    this.goalPos.lerpVectors(this.revealFromPos, this.heroPos, t);
    this.goalTarget.lerpVectors(this.revealFromTarget, this.heroTarget, t);
    this._moveCamera(dt, portrait ? 42 : 37, 2.2);

    // The warm working light rises with the softening front, then fades as the glass cools.
    const heatT = clamp01((this.age - 0.35) / 3.2);
    const cooling = 1 - ease((this.age - 3.45) / 1.55);
    this._setLightTargets('result', dt);
    this.lights.casting.position.set(0.5, this.baseHeight + heatT * (this.totalHeight - this.baseHeight), 1.4);
    this.lights.casting.intensity = 2.2 * cooling;
    this.lights.sweep.intensity = 0;

    if (this.age >= 5.2) this.showResult(false);
  }

  _updateStableLights(dt) {
    this._setLightTargets('result', dt);
    this.lights.sweep.intensity *= Math.exp(-dt / 0.15);
  }

  _moveCamera(dt, targetFov, rate) {
    const k = damp(rate, dt);
    this.camera.position.lerp(this.goalPos, k);
    this.controls.target.lerp(this.goalTarget, k);
    this.camera.fov += (targetFov - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
  }

  _setLightTargets(sceneMode, dt, scale = 1) {
    const k = dt >= 1 ? 1 : damp(4.8, dt);
    const targets = sceneMode === 'idle'
      ? { ambient: 0.16, key: 0.48, rim: 1.55, fill: 0.18, stage: 0.8, casting: 0, exposure: 0.98, bloom: 0.08 }
      : sceneMode === 'live'
        ? { ambient: 0.21, key: 0.92, rim: 1.9, fill: 0.34, stage: 1.2, casting: 0.65, exposure: 1.02, bloom: 0.1 }
        : { ambient: 0.27, key: 1.2, rim: 2.1, fill: 0.52, stage: 1.05, casting: 0, exposure: 1.06, bloom: 0.12 };

    for (const name of ['ambient', 'key', 'rim', 'fill', 'stage', 'casting']) {
      const target = targets[name] * scale;
      this.lights[name].intensity += (target - this.lights[name].intensity) * k;
    }
    this.renderer.toneMappingExposure += (targets.exposure * scale - this.renderer.toneMappingExposure) * k;
    const bloomScale = this.viewport.compact ? 0.76 : 1;
    this.bloomPass.strength += (targets.bloom * bloomScale * scale - this.bloomPass.strength) * k;
  }
}
