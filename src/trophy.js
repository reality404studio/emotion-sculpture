// Emotion Trophy — accumulated glass casting.
//
// Inputs are not particles. Each input becomes a glass bead, falls through the
// open mouth of the mould, and keeps its colour and place in the pile. Casting
// softens those same beads from the bottom upward. They spread into overlapping
// inclusions while a single clear-glass body closes around them. The finished
// object therefore preserves the location, order, and dominance of the inputs.

import * as THREE from 'three';
import { BASELINE, DECAY } from './emotions.js';
import { hashInt } from './noise.js';

const TOTAL_H = 4.4;
const BASE_H = TOTAL_H * 0.18;
const GLASS_H = TOTAL_H - BASE_H;
const R_UNIT = 1.05;
const CAPACITY = 48;

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

const COLORS = [0xffb23f, 0xef5847, 0x4d86ed];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

function rnd(seed, index, salt = 0) {
  const n = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  return hashInt(n);
}

function profileAt(u) {
  const x = clamp01(u);
  let i = 0;
  while (i < PROFILE.length - 2 && x > PROFILE[i + 1][0]) i++;
  const [u0, r0] = PROFILE[i];
  const [u1, r1] = PROFILE[i + 1];
  const t = smooth((x - u0) / Math.max(0.0001, u1 - u0));
  return r0 + (r1 - r0) * t;
}

function makeLatheGeometry(radialScale = 1) {
  const points = [];
  for (let i = 0; i <= 72; i++) {
    const u = i / 72;
    points.push(new THREE.Vector2(profileAt(u) * R_UNIT * radialScale, BASE_H + u * GLASS_H));
  }
  const geometry = new THREE.LatheGeometry(points, 96);
  geometry.computeVertexNormals();
  return geometry;
}

function glassMaterial(color, { opacity = 1, transmission = 0.25, roughness = 0.12, thickness = 0.7 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness,
    transmission,
    thickness,
    ior: 1.46,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    transparent: opacity < 1 || transmission > 0,
    opacity,
    depthWrite: opacity >= 0.98,
  });
}

export class Trophy {
  constructor(sessionSeed) {
    this.seed = sessionSeed >>> 0;
    this.beats = [];
    this.materials = [];
    this.live = false;
    this.mode = 'dormant';
    this.castU = 0;
    this._now = 0;
    this._lastT = 0;
    this._castAge = 0;
    this._settlePulse = 0;

    this.group = new THREE.Group();
    this._buildBody();
    this._buildBase();
    this._buildMaterials();
    this.group.add(this._baseGroup, this._bodyGroup, this._materialGroup);
  }

  get height() {
    return TOTAL_H;
  }

  get capacity() {
    return CAPACITY;
  }

  castFrontY() {
    if (this.materials.length === 0) return BASE_H + GLASS_H * 0.31;
    const layer = Math.floor((this.materials.length - 1) / 4);
    return BASE_H + GLASS_H * 0.31 + Math.min(11, layer) * ((GLASS_H * 0.63 - 0.16) / 11);
  }

  _buildBody() {
    this._bodyGroup = new THREE.Group();
    this._shellGeom = makeLatheGeometry(1);
    this._innerGeom = makeLatheGeometry(0.965);

    this._shellMat = glassMaterial(0xd9e4e5, {
      opacity: 0.2,
      transmission: 0.72,
      roughness: 0.11,
      thickness: 1.45,
    });
    this._shellMat.depthWrite = false;
    this._innerMat = glassMaterial(0x7f9398, {
      opacity: 0.1,
      transmission: 0.68,
      roughness: 0.2,
      thickness: 0.35,
    });
    this._innerMat.side = THREE.BackSide;
    this._innerMat.depthWrite = false;

    this._shell = new THREE.Mesh(this._shellGeom, this._shellMat);
    this._shell.renderOrder = 5;
    this._innerShell = new THREE.Mesh(this._innerGeom, this._innerMat);
    this._innerShell.renderOrder = 4;

    this._rimMat = glassMaterial(0xc8d6d8, {
      opacity: 0.44,
      transmission: 0.78,
      roughness: 0.13,
      thickness: 0.35,
    });
    this._rimMat.depthWrite = false;
    this._rim = new THREE.Mesh(new THREE.TorusGeometry(profileAt(1) * R_UNIT, 0.035, 14, 112), this._rimMat);
    this._rim.rotation.x = Math.PI / 2;
    this._rim.position.y = TOTAL_H;

    // A restrained mould collar makes the empty state legible without wireframe.
    this._collarMat = new THREE.MeshStandardMaterial({
      color: 0x20272a,
      roughness: 0.72,
      metalness: 0.06,
      transparent: true,
      opacity: 0.45,
    });
    this._collar = new THREE.Mesh(
      new THREE.TorusGeometry(profileAt(1) * R_UNIT + 0.08, 0.018, 8, 112),
      this._collarMat
    );
    this._collar.rotation.x = Math.PI / 2;
    this._collar.position.y = TOTAL_H + 0.015;

    this._bodyGroup.add(this._innerShell, this._shell, this._rim, this._collar);
  }

  _buildBase() {
    this._baseGroup = new THREE.Group();
    const smoke = glassMaterial(0x263034, {
      opacity: 0.92,
      transmission: 0.2,
      roughness: 0.2,
      thickness: 1.2,
    });
    const clear = glassMaterial(0x8b9da0, {
      opacity: 0.55,
      transmission: 0.62,
      roughness: 0.12,
      thickness: 0.8,
    });
    const footH = BASE_H * 0.36;
    const shoulderH = BASE_H * 0.34;
    const stemH = BASE_H - footH - shoulderH;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.02, footH, 72), smoke);
    foot.position.y = footH / 2;
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.78, shoulderH, 72), smoke);
    shoulder.position.y = footH + shoulderH / 2;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.43, stemH, 64), clear);
    stem.position.y = footH + shoulderH + stemH / 2;
    for (const mesh of [foot, shoulder, stem]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this._baseGroup.add(mesh);
    }
  }

  _buildMaterials() {
    this._materialGroup = new THREE.Group();
    this._beadGeom = new THREE.IcosahedronGeometry(0.245, 3);
    this._beadMaterials = COLORS.map((color) => glassMaterial(color, {
      opacity: 1,
      transmission: 0.12,
      roughness: 0.13,
      thickness: 0.72,
    }));
  }

  beginLive() {
    this.live = true;
    this.mode = 'collecting';
    this.beats = [];
    this.castU = 0;
    this._castAge = 0;
    this._setBodyState(0);
  }

  setCastProgress() {
    // Fill is determined by accumulated material, never by an abstract timer.
    this.castU = this.materials.length / CAPACITY;
  }

  addBeat(beat) {
    this.beats.push(beat);
  }

  insertSphere(emotionIndex, detail = {}, immediate = false) {
    if ((!this.live && !immediate) || this.materials.length >= CAPACITY) return false;
    const index = this.materials.length;
    const target = this._packingPosition(index);
    const mesh = new THREE.Mesh(this._beadGeom, this._beadMaterials[emotionIndex]);
    const radiusVariation = 0.9 + rnd(this.seed, index, 8) * 0.22;
    mesh.scale.setScalar(radiusVariation);
    mesh.position.copy(immediate ? target : new THREE.Vector3(0, TOTAL_H + 0.4, 0));
    mesh.rotation.set(
      rnd(this.seed, index, 11) * Math.PI,
      rnd(this.seed, index, 12) * Math.PI,
      rnd(this.seed, index, 13) * Math.PI
    );
    mesh.renderOrder = 2;

    const flow = target.clone();
    const flowAngle = Math.atan2(target.z, target.x) + (rnd(this.seed, index, 20) - 0.5) * 0.5;
    const drift = (rnd(this.seed, index, 21) - 0.5) * 0.16;
    flow.x = target.x * 0.82 + Math.cos(flowAngle) * drift;
    flow.z = target.z * 0.82 + Math.sin(flowAngle) * drift;
    flow.y += (rnd(this.seed, index, 22) - 0.5) * 0.12;

    const item = {
      index,
      emotion: emotionIndex,
      detail,
      mesh,
      target,
      flow,
      born: immediate ? -100 : this._now,
      size: radiusVariation,
    };
    this.materials.push(item);
    this._materialGroup.add(mesh);
    this.castU = this.materials.length / CAPACITY;
    this._settlePulse = 1;
    if (immediate) this._applySealedTransform(item);
    return this.materials.length >= CAPACITY;
  }

  _packingPosition(index) {
    const perLayer = 4;
    const layers = Math.ceil(CAPACITY / perLayer);
    const layer = Math.floor(index / perLayer);
    const slot = index % perLayer;
    const u = 0.31 + ((layer + 0.5) / layers) * 0.63;
    const radius = Math.max(0.02, profileAt(u) * R_UNIT * 0.72);
    const ringSlot = slot / perLayer;
    const angle = ringSlot * Math.PI * 2 + layer * 0.67 + (rnd(this.seed, index, 3) - 0.5) * 0.16;
    const radial = radius * (0.86 + rnd(this.seed, index, 4) * 0.14);
    const startY = BASE_H + GLASS_H * 0.31;
    const step = (GLASS_H * 0.63 - 0.16) / Math.max(1, layers - 1);
    return new THREE.Vector3(
      Math.cos(angle) * radial,
      startY + layer * step + (rnd(this.seed, index, 5) - 0.5) * 0.055,
      Math.sin(angle) * radial
    );
  }

  finishCast() {
    this.live = false;
    this.mode = 'melting';
    this._castAge = 0;
    this.castU = this.materials.length / CAPACITY;
    this._prepareCastFlow();
  }

  setBeats(beats) {
    this.live = false;
    this.mode = 'sealed';
    this.beats = beats.slice();
    let prev = [BASELINE, BASELINE, BASELINE];
    for (let i = 0; i < beats.length && this.materials.length < CAPACITY; i++) {
      const beat = beats[i];
      const delta = beat.e.map((v, k) => Math.max(0, v - prev[k] * DECAY));
      let emotion = beat.kind === 'tap' ? 0 : beat.kind === 'single' ? 1 : beat.kind === 'hold' ? 2 : -1;
      if (emotion < 0) {
        const max = Math.max(...delta);
        emotion = max > 0.08 ? delta.indexOf(max) : -1;
      }
      if (emotion >= 0) this.insertSphere(emotion, {}, true);
      prev = beat.e;
    }
    if (this.materials.length === 0) {
      for (let i = 0; i < 9; i++) this.insertSphere(i % 3, {}, true);
    }
    this._prepareCastFlow();
    for (const item of this.materials) this._applySealedTransform(item);
    this._setBodyState(1);
  }

  _prepareCastFlow() {
    const span = Math.max(1, this.materials.length - 1);
    for (const item of this.materials) {
      // Chronology remains readable from bottom to top. The radial drift is
      // restrained so every colour stays inside the calm outer silhouette.
      const u = 0.34 + (item.index / span) * 0.58;
      const angle = Math.atan2(item.target.z, item.target.x) + (rnd(this.seed, item.index, 41) - 0.5) * 0.5;
      const radial = profileAt(u) * R_UNIT * (0.16 + rnd(this.seed, item.index, 42) * 0.2);
      const direction = item.emotion === 0 ? 1.65 : item.emotion === 1 ? 2.1 : 2.55;
      const halfHeight = 0.245 * item.size * direction;
      const rawY = BASE_H + u * GLASS_H + (rnd(this.seed, item.index, 43) - 0.5) * 0.08;
      const minY = BASE_H + GLASS_H * 0.31 + halfHeight;
      const maxY = TOTAL_H - halfHeight - 0.1;
      item.flow.set(
        Math.cos(angle) * radial,
        Math.max(minY, Math.min(maxY, rawY)),
        Math.sin(angle) * radial
      );
    }
  }

  pulse() {}

  impact() {
    // A small compression is enough to show weight arriving; no blast or sparkle.
    this._settlePulse = 1;
  }

  setLive() {}
  setPixelRatio() {}
  stir() {}

  _setBodyState(progress) {
    const p = smooth(progress);
    this._shellMat.opacity = 0.2 + p * 0.42;
    this._innerMat.opacity = 0.1 + p * 0.09;
    this._rimMat.opacity = 0.44 + p * 0.18;
    this._collarMat.opacity = 0.45 * (1 - p);
    this._shellMat.roughness = 0.11 - p * 0.015;
    this._shellMat.color.lerpColors(new THREE.Color(0xf2b06a), new THREE.Color(0xd9e4e5), clamp01((p - 0.35) / 0.65));
  }

  _applySealedTransform(item) {
    item.mesh.position.copy(item.flow);
    const direction = item.emotion === 0 ? 1.65 : item.emotion === 1 ? 2.1 : 2.55;
    const lateral = item.emotion === 0 ? 1.15 : item.emotion === 1 ? 0.78 : 0.94;
    item.mesh.rotation.set(0, rnd(this.seed, item.index, 51) * Math.PI, (rnd(this.seed, item.index, 52) - 0.5) * 0.14);
    item.mesh.scale.set(item.size * lateral, item.size * direction, item.size * (1.0 + rnd(this.seed, item.index, 30) * 0.18));
  }

  update(timeSec) {
    const dt = Math.min(0.08, Math.max(0, timeSec - this._lastT));
    this._lastT = timeSec;
    this._now = timeSec;

    if (this.mode === 'collecting') {
      for (const item of this.materials) {
        const age = timeSec - item.born;
        if (age < 0 || age > 1.25) continue;
        const fall = smooth(age / 0.78);
        item.mesh.position.lerpVectors(new THREE.Vector3(0, TOTAL_H + 0.4, 0), item.target, fall);
        if (age > 0.7) {
          const bounceAge = age - 0.7;
          item.mesh.position.y += Math.sin(bounceAge * 18) * Math.exp(-bounceAge * 8) * 0.055;
          const squash = Math.sin(Math.min(1, bounceAge / 0.2) * Math.PI) * 0.12;
          item.mesh.scale.set(item.size * (1 + squash), item.size * (1 - squash), item.size * (1 + squash));
        }
      }
      this._setBodyState(0);
    } else if (this.mode === 'melting') {
      this._castAge += dt;
      const bodyP = clamp01((this._castAge - 0.35) / 4.5);
      this._setBodyState(bodyP);
      for (const item of this.materials) {
        const heightU = clamp01((item.target.y - BASE_H) / GLASS_H);
        const localP = smooth((this._castAge - 0.55 - heightU * 1.7) / 2.2);
        item.mesh.position.lerpVectors(item.target, item.flow, localP);
        const direction = item.emotion === 0 ? 1.65 : item.emotion === 1 ? 2.1 : 2.55;
        const lateral = item.emotion === 0 ? 1.15 : item.emotion === 1 ? 0.78 : 0.94;
        item.mesh.rotation.x *= 1 - localP * 0.12;
        item.mesh.rotation.z *= 1 - localP * 0.12;
        item.mesh.scale.set(
          item.size * (1 + (lateral - 1) * localP),
          item.size * (1 + (direction - 1) * localP),
          item.size * (1 + rnd(this.seed, item.index, 30) * 0.18 * localP)
        );
      }
      const heat = smooth(this._castAge / 1.25) * (1 - smooth((this._castAge - 2.65) / 2.0));
      for (const mat of this._beadMaterials) {
        mat.roughness = 0.13 - heat * 0.07 + smooth((this._castAge - 3.7) / 1.3) * 0.04;
        mat.transmission = 0.12 + heat * 0.26;
      }
      if (this._castAge >= 5.2) {
        this.mode = 'sealed';
        this._setBodyState(1);
        for (const mat of this._beadMaterials) {
          mat.transmission = 0.24;
          mat.roughness = 0.14;
        }
        for (const item of this.materials) this._applySealedTransform(item);
      }
    }

    // The whole object receives only a tiny weighted settling response.
    this._settlePulse *= Math.exp(-dt / 0.24);
    const settle = Math.sin(this._settlePulse * Math.PI) * this._settlePulse * 0.012;
    this.group.scale.set(1 + settle, 1 - settle * 0.45, 1 + settle);
  }

  dispose() {
    this.group.traverse((object) => {
      if (object.geometry && object.geometry !== this._beadGeom) object.geometry.dispose();
    });
    this._beadGeom.dispose();
    for (const material of [this._shellMat, this._innerMat, this._rimMat, this._collarMat, ...this._beadMaterials]) {
      material.dispose();
    }
    this._baseGroup.traverse((object) => object.material?.dispose?.());
  }
}

export { TOTAL_H, BASE_H, GLASS_H };
