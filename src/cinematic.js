import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const IMPACT_COLORS = [0xf5a524, 0xe4573d, 0x3b82f6];
const MILESTONES = [0.25, 0.5, 0.75];
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
    this.nextMilestone = 0;
    this.milestoneAge = 99;
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

    this.resetIdle(true);
  }

  resetIdle(instant = false) {
    this.mode = 'idle';
    this.age = 0;
    this.nextMilestone = 0;
    this.milestoneAge = 99;
    this.impactAge = 99;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.goalPos.set(3.15, 1.72, 8.15);
    this.goalTarget.set(0, 1.95, 0);
    if (instant) {
      this.camera.position.copy(this.goalPos);
      this.controls.target.copy(this.goalTarget);
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
    }
    this._setLightTargets('idle', 1);
  }

  beginLive() {
    this.mode = 'live';
    this.age = 0;
    this.nextMilestone = 0;
    this.milestoneAge = 99;
    this.impactAge = 99;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  impact(emotion, worldY) {
    this.impactEmotion = emotion;
    this.impactAge = 0;
    this.impactStrength = Math.min(1.25, this.impactStrength + (emotion === 2 ? 0.45 : 0.8));
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
    const angle = 0.34;
    this.goalTarget.set(0, this.totalHeight * 0.47, 0);
    this.goalPos.set(Math.sin(angle) * 8.7, this.totalHeight * 0.57, Math.cos(angle) * 8.7);
    if (instant) {
      this.camera.position.copy(this.goalPos);
      this.controls.target.copy(this.goalTarget);
      this.camera.fov = 38;
      this.camera.updateProjectionMatrix();
    }
    this.controls.enabled = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.55;
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
    this.milestoneAge += step;

    if (this.mode === 'live') this._updateLive(step, progress, castY);
    else if (this.mode === 'reveal') this._updateReveal(step);
    else if (this.mode === 'idle') this._updateIdle(step);
    else this._updateStableLights(step);

    this.impactStrength *= Math.exp(-step / 0.32);
    this.lights.impact.intensity = 4.4 * this.impactStrength * Math.exp(-this.impactAge / 0.24);
  }

  _updateIdle(dt) {
    // 멈춘 화면이 아니라 숨을 참고 있는 듯한 4° 이내의 아주 느린 드리프트.
    const angle = 0.37 + Math.sin(this.age * 0.16) * 0.025;
    this.goalPos.set(Math.sin(angle) * 8.7, 1.72, Math.cos(angle) * 8.7);
    this.goalTarget.set(0, 1.95, 0);
    this._moveCamera(dt, 42, 1.25);
    this._setLightTargets('idle', dt);
  }

  _updateLive(dt, progress, castY) {
    if (this.nextMilestone < MILESTONES.length && progress >= MILESTONES[this.nextMilestone]) {
      this.nextMilestone++;
      this.milestoneAge = 0;
    }

    const intro = ease(this.age / 1.15);
    const angle = 0.19 - progress * 0.38;
    let distance = 5.35 + progress * 1.55;
    let targetY = this.baseHeight + 0.12 + (castY - this.baseHeight) * 0.72;
    const builtCenter = (this.baseHeight + castY) * 0.5;
    const milestonePulse = this.milestoneAge < 1.05 ? Math.sin((this.milestoneAge / 1.05) * Math.PI) : 0;
    distance += milestonePulse * 2.0;
    targetY += (builtCenter - targetY) * milestonePulse * 0.72;

    this.livePos.set(Math.sin(angle) * distance, targetY + 0.34, Math.cos(angle) * distance);
    this.liveTarget.set(0, targetY, 0);
    this.goalPos.set(1.05, 1.16, 5.25).lerp(this.livePos, intro);
    this.goalTarget.set(0, this.baseHeight + 0.08, 0).lerp(this.liveTarget, intro);

    // 충돌 프레임에만 작은 반동. 이동 중에는 카메라를 흔들지 않는다.
    if (this.impactAge < 0.75 && this.impactStrength > 0.01) {
      const envelope = Math.exp(-this.impactAge / 0.2) * this.impactStrength;
      const kick = Math.sin(this.impactAge * 22) * envelope;
      this.view.subVectors(this.goalTarget, this.goalPos).normalize();
      this.tangent.crossVectors(this.view, UP).normalize();
      if (this.impactEmotion === 0) this.goalPos.addScaledVector(this.view, kick * 0.18);
      else if (this.impactEmotion === 1) this.goalPos.addScaledVector(this.tangent, kick * 0.12);
      else this.goalPos.y += envelope * 0.065;
    }

    this._moveCamera(dt, 41.5 - milestonePulse * 1.5, 5.8);
    this.lights.casting.position.set(1.15, castY + 0.22, 1.85);
    this._setLightTargets('live', dt);
  }

  _updateReveal(dt) {
    const t = ease(this.age / 2.05);
    const angle = 0.34;
    this.heroTarget.set(0, this.totalHeight * 0.47, 0);
    this.heroPos.set(Math.sin(angle) * 8.7, this.totalHeight * 0.57, Math.cos(angle) * 8.7);
    this.goalPos.lerpVectors(this.revealFromPos, this.heroPos, t);
    this.goalTarget.lerpVectors(this.revealFromTarget, this.heroTarget, t);
    this._moveCamera(dt, 38, 8.0);

    const dark = this.age < 0.16
      ? 1 - ease(this.age / 0.16) * 0.82
      : 0.18 + ease((this.age - 0.16) / 0.72) * 0.82;
    // 완성 컷은 일반적인 댐핑보다 빠르게 노출을 내려 실제 암전으로 읽히게 한다.
    this._setLightTargets('result', 1, dark);
    const sweepT = clamp01((this.age - 0.14) / 0.88);
    this.lights.sweep.position.set(0.25, this.baseHeight + sweepT * (this.totalHeight - this.baseHeight), 1.6);
    this.lights.sweep.intensity = Math.sin(sweepT * Math.PI) * 10.5;

    if (this.age >= 2.15) this.showResult(false);
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
      ? { ambient: 0.13, key: 0.24, rim: 1.8, fill: 0.08, stage: 0.75, casting: 0, exposure: 0.88, bloom: 0.34 }
      : sceneMode === 'live'
        ? { ambient: 0.19, key: 0.72, rim: 2.35, fill: 0.32, stage: 1.7, casting: 2.8, exposure: 1.0, bloom: 0.5 }
        : { ambient: 0.3, key: 1.02, rim: 2.5, fill: 0.55, stage: 1.4, casting: 0, exposure: 1.04, bloom: 0.56 };

    for (const name of ['ambient', 'key', 'rim', 'fill', 'stage', 'casting']) {
      const target = targets[name] * scale;
      this.lights[name].intensity += (target - this.lights[name].intensity) * k;
    }
    this.renderer.toneMappingExposure += (targets.exposure * scale - this.renderer.toneMappingExposure) * k;
    this.bloomPass.strength += (targets.bloom * scale - this.bloomPass.strength) * k;
  }
}
