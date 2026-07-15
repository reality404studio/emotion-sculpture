// Emotion Trophy — temporary glass beads become a volumetric colour field.
//
// Collection state: every input is a small, discrete glass bead.
// Final state: bead geometry is completely removed. Only colour, quantity,
// chronology, and broad placement survive in a ray-marched internal field
// sampled by one fixed, continuous trophy mesh.

import * as THREE from 'three';
import { BASELINE, DECAY } from './emotions.js';
import { hashInt } from './noise.js';

const TOTAL_H = 4.4;
const BASE_H = TOTAL_H * 0.18;
const GLASS_H = TOTAL_H - BASE_H;
const R_UNIT = 1.05;
const CAPACITY = 48;
const BEAD_RADIUS = 0.245 * 0.25; // requested: exactly 1/4 of the previous bead radius

const FIELD_X = 48;
const FIELD_Y = 96;
const FIELD_Z = 48;
const FIELD_COLS = 8;
const FIELD_ROWS = 6;
const FIELD_W = FIELD_X * FIELD_COLS;
const FIELD_H = FIELD_Y * FIELD_ROWS;
const FIELD_BOUND = 1.22;

const UPPER_PROFILE = [
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

// The foot, stem, bowl, and rim are one calm lathed silhouette.
const BASE_PROFILE = [
  [0.0, 0.88],
  [0.018, 0.98],
  [0.07, 1.0],
  [0.115, 0.74],
  [0.155, 0.45],
  [0.18, 0.36],
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

function interpolateProfile(profile, u) {
  const x = clamp01(u);
  let i = 0;
  while (i < profile.length - 2 && x > profile[i + 1][0]) i++;
  const [u0, r0] = profile[i];
  const [u1, r1] = profile[i + 1];
  const t = smooth((x - u0) / Math.max(0.0001, u1 - u0));
  return r0 + (r1 - r0) * t;
}

function upperProfileAt(u) {
  return interpolateProfile(UPPER_PROFILE, u);
}

function trophyRadiusAt(normalizedY) {
  const y = clamp01(normalizedY);
  if (y <= 0.18) return interpolateProfile(BASE_PROFILE, y) * R_UNIT;
  return upperProfileAt((y - 0.18) / 0.82) * R_UNIT;
}

function makeTrophyGeometry(radialScale = 1) {
  const points = BASE_PROFILE.map(([u, r]) => new THREE.Vector2(r * R_UNIT * radialScale, u * TOTAL_H));
  for (let i = 1; i <= 88; i++) {
    const u = i / 88;
    points.push(new THREE.Vector2(upperProfileAt(u) * R_UNIT * radialScale, BASE_H + u * GLASS_H));
  }
  const geometry = new THREE.LatheGeometry(points, 112);
  geometry.computeVertexNormals();
  return geometry;
}

function makePhysicalGlass(color, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: options.roughness ?? 0.1,
    transmission: options.transmission ?? 0.9,
    thickness: options.thickness ?? 2.6,
    ior: 1.48,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    attenuationDistance: 4.8,
    attenuationColor: new THREE.Color(0xe8f1ee),
    envMapIntensity: options.envMapIntensity ?? 1.45,
    specularIntensity: 1,
    specularColor: new THREE.Color(0xffffff),
    transparent: true,
    opacity: options.opacity ?? 0.42,
    depthWrite: false,
    side: options.side ?? THREE.FrontSide,
  });
}

function createEmptyFieldTexture() {
  const texture = new THREE.DataTexture(
    new Uint8Array(FIELD_W * FIELD_H * 4),
    FIELD_W,
    FIELD_H,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
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
    this._fieldReveal = 0;
    this._shader = null;
    this._cameraLocal = new THREE.Vector3();

    this.group = new THREE.Group();
    this._buildField();
    this._buildBody();
    this._buildMaterials();
    this.group.add(this._bodyGroup, this._materialGroup);
  }

  get height() {
    return TOTAL_H;
  }

  get capacity() {
    return CAPACITY;
  }

  castFrontY() {
    if (this.materials.length === 0) return BASE_H + GLASS_H * 0.32;
    const layer = Math.floor((this.materials.length - 1) / 12);
    return BASE_H + GLASS_H * 0.32 + Math.min(3, layer) * 0.14;
  }

  _buildField() {
    this._fieldTexture = createEmptyFieldTexture();
  }

  _buildBody() {
    this._bodyGroup = new THREE.Group();
    this._bodyGeom = makeTrophyGeometry();
    this._glassMat = makePhysicalGlass(0xdce5e1, {
      opacity: 0.34,
      transmission: 0.96,
      roughness: 0.1,
      thickness: 3.1,
      envMapIntensity: 1.65,
    });

    this._glassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGlassField = { value: this._fieldTexture };
      shader.uniforms.uGlassFieldReveal = { value: this._fieldReveal };
      shader.uniforms.uGlassCameraLocal = { value: this._cameraLocal };

      shader.vertexShader = `
        varying vec3 vGlassLocalPosition;
        varying vec3 vGlassRayDirection;
        uniform vec3 uGlassCameraLocal;
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlassLocalPosition = position;
        vGlassRayDirection = normalize(position - uGlassCameraLocal);`
      );

      shader.fragmentShader = `
        uniform sampler2D uGlassField;
        uniform float uGlassFieldReveal;
        varying vec3 vGlassLocalPosition;
        varying vec3 vGlassRayDirection;

        vec4 sampleGlassVolume(vec3 p) {
          vec3 uvw = vec3(
            p.x / ${(FIELD_BOUND * 2).toFixed(4)} + 0.5,
            p.y / ${TOTAL_H.toFixed(4)},
            p.z / ${(FIELD_BOUND * 2).toFixed(4)} + 0.5
          );
          if (uvw.x <= 0.0 || uvw.x >= 1.0 ||
              uvw.y <= 0.0 || uvw.y >= 1.0 ||
              uvw.z <= 0.0 || uvw.z >= 1.0) return vec4(0.0);

          float slice = clamp(uvw.z, 0.0, 0.9999) * ${FIELD_Z - 1}.0;
          float z0 = floor(slice);
          float z1 = min(z0 + 1.0, ${FIELD_Z - 1}.0);
          float mixZ = fract(slice);
          vec2 grid = vec2(${FIELD_COLS}.0, ${FIELD_ROWS}.0);
          vec2 uv0 = (vec2(mod(z0, ${FIELD_COLS}.0), floor(z0 / ${FIELD_COLS}.0)) + uvw.xy) / grid;
          vec2 uv1 = (vec2(mod(z1, ${FIELD_COLS}.0), floor(z1 / ${FIELD_COLS}.0)) + uvw.xy) / grid;
          return mix(texture2D(uGlassField, uv0), texture2D(uGlassField, uv1), mixZ);
        }
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec4 glassVolume = vec4(0.0);
        vec3 glassMarch = vGlassLocalPosition + vGlassRayDirection * 0.035;
        for (int glassStep = 0; glassStep < 12; glassStep++) {
          glassMarch += vGlassRayDirection * 0.205;
          vec4 glassSample = sampleGlassVolume(glassMarch);
          float sampleAlpha = glassSample.a * 0.55 * uGlassFieldReveal;
          float remain = 1.0 - glassVolume.a;
          glassVolume.rgb += glassSample.rgb * sampleAlpha * remain;
          glassVolume.a += sampleAlpha * remain;
        }
        vec3 internalGlassColor = glassVolume.rgb / max(glassVolume.a, 0.001);
        internalGlassColor = min(vec3(1.0), pow(internalGlassColor, vec3(0.74)) * 1.24);
        float internalGlassAmount = smoothstep(0.008, 0.3, glassVolume.a);
        diffuseColor.rgb = mix(diffuseColor.rgb, internalGlassColor, internalGlassAmount * 0.98);`
      );
      this._shader = shader;
    };
    this._glassMat.customProgramCacheKey = () => 'emotion-art-glass-volume-v1';

    this._body = new THREE.Mesh(this._bodyGeom, this._glassMat);
    this._body.castShadow = true;
    this._body.receiveShadow = true;
    this._body.renderOrder = 3;
    this._body.onBeforeRender = (_renderer, _scene, camera) => {
      this._cameraLocal.copy(camera.position);
      this._body.worldToLocal(this._cameraLocal);
      if (this._shader) {
        this._shader.uniforms.uGlassCameraLocal.value.copy(this._cameraLocal);
        this._shader.uniforms.uGlassFieldReveal.value = this._fieldReveal;
        this._shader.uniforms.uGlassField.value = this._fieldTexture;
      }
    };

    this._rimMat = makePhysicalGlass(0xe6eeeb, {
      opacity: 0.58,
      transmission: 0.92,
      roughness: 0.06,
      thickness: 0.48,
      envMapIntensity: 1.8,
    });
    this._rim = new THREE.Mesh(
      new THREE.TorusGeometry(upperProfileAt(1) * R_UNIT, 0.032, 16, 128),
      this._rimMat
    );
    this._rim.rotation.x = Math.PI / 2;
    this._rim.position.y = TOTAL_H;
    this._rim.renderOrder = 4;

    this._collarMat = new THREE.MeshStandardMaterial({
      color: 0x59625f,
      roughness: 0.62,
      metalness: 0.02,
      transparent: true,
      opacity: 0.32,
    });
    this._collar = new THREE.Mesh(
      new THREE.TorusGeometry(upperProfileAt(1) * R_UNIT + 0.075, 0.015, 8, 128),
      this._collarMat
    );
    this._collar.rotation.x = Math.PI / 2;
    this._collar.position.y = TOTAL_H + 0.015;

    this._bodyGroup.add(this._body, this._rim, this._collar);
  }

  _buildMaterials() {
    this._materialGroup = new THREE.Group();
    this._beadGeom = new THREE.IcosahedronGeometry(BEAD_RADIUS, 3);
    this._beadMaterials = COLORS.map((color) => {
      const material = makePhysicalGlass(color, {
        opacity: 0.96,
        transmission: 0.24,
        roughness: 0.11,
        thickness: 0.18,
      });
      material.depthWrite = true;
      return material;
    });
  }

  beginLive() {
    this.live = true;
    this.mode = 'collecting';
    this.beats = [];
    this.castU = 0;
    this._castAge = 0;
    this._fieldReveal = 0;
    this._materialGroup.visible = true;
    this._setBodyState(0);
  }

  setCastProgress() {
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
    const size = 0.9 + rnd(this.seed, index, 8) * 0.2;
    mesh.scale.setScalar(size);
    mesh.position.copy(immediate ? target : new THREE.Vector3(0, TOTAL_H + 0.28, 0));
    mesh.rotation.set(
      rnd(this.seed, index, 11) * Math.PI,
      rnd(this.seed, index, 12) * Math.PI,
      rnd(this.seed, index, 13) * Math.PI
    );
    mesh.renderOrder = 2;

    const item = {
      index,
      emotion: emotionIndex,
      detail,
      mesh,
      target,
      flow: target.clone(),
      born: immediate ? -100 : this._now,
      size,
    };
    this.materials.push(item);
    this._materialGroup.add(mesh);
    this.castU = this.materials.length / CAPACITY;
    this._settlePulse = 1;
    return this.materials.length >= CAPACITY;
  }

  _packingPosition(index) {
    const perLayer = 12;
    const layer = Math.floor(index / perLayer);
    const slot = index % perLayer;
    const inner = slot < 4;
    const localSlot = inner ? slot : slot - 4;
    const slotCount = inner ? 4 : 8;
    const u = 0.33 + layer * 0.04;
    const angle = (localSlot / slotCount) * Math.PI * 2 + layer * 0.43 + (rnd(this.seed, index, 3) - 0.5) * 0.08;
    const radial = upperProfileAt(u) * R_UNIT * (inner ? 0.3 : 0.68);
    return new THREE.Vector3(
      Math.cos(angle) * radial,
      BASE_H + u * GLASS_H + (rnd(this.seed, index, 5) - 0.5) * 0.025,
      Math.sin(angle) * radial
    );
  }

  finishCast() {
    this.live = false;
    this.mode = 'melting';
    this._castAge = 0;
    this.castU = this.materials.length / CAPACITY;
    this._prepareFieldSeeds();
    this._generateColorField();
  }

  setBeats(beats) {
    this.live = false;
    this.mode = 'sealed';
    this.beats = beats.slice();
    let prev = [BASELINE, BASELINE, BASELINE];
    for (let i = 0; i < beats.length && this.materials.length < CAPACITY; i++) {
      const beat = beats[i];
      const delta = beat.e.map((value, k) => Math.max(0, value - prev[k] * DECAY));
      let emotion = beat.kind === 'tap' ? 0 : beat.kind === 'single' ? 1 : beat.kind === 'hold' ? 2 : -1;
      if (emotion < 0) {
        const max = Math.max(...delta);
        emotion = max > 0.08 ? delta.indexOf(max) : -1;
      }
      if (emotion >= 0) this.insertSphere(emotion, { sequence: i }, true);
      prev = beat.e;
    }
    this._prepareFieldSeeds();
    this._generateColorField();
    this._materialGroup.visible = false;
    this._fieldReveal = 1;
    this._setBodyState(1);
  }

  _prepareFieldSeeds() {
    const count = this.materials.length;
    const span = Math.max(1, count - 1);
    const chronological = [...this.materials].sort((a, b) =>
      (a.detail.sequence ?? a.index) - (b.detail.sequence ?? b.index)
    );
    const chronology = new Map(chronological.map((item, index) => [item, index]));
    this._fieldSeeds = this.materials.map((item) => {
      const order = chronology.get(item) / span;
      const normalizedY = 0.23 + order * 0.68;
      const radius = trophyRadiusAt(normalizedY) * (0.16 + rnd(this.seed, item.index, 22) * 0.4);
      const angle = Math.atan2(item.target.z, item.target.x) + (rnd(this.seed, item.index, 23) - 0.5) * 0.7;
      const color = new THREE.Color(COLORS[item.emotion]);
      const seed = {
        color,
        x: Math.cos(angle) * radius,
        y: normalizedY * TOTAL_H,
        z: Math.sin(angle) * radius,
        width: 0.16 + rnd(this.seed, item.index, 24) * 0.12,
        thin: 0.035 + rnd(this.seed, item.index, 25) * 0.03,
        stretch: 0.42 + rnd(this.seed, item.index, 26) * 0.28 + item.emotion * 0.055,
        curl: 0.045 + rnd(this.seed, item.index, 27) * 0.095,
        phase: rnd(this.seed, item.index, 28) * Math.PI * 2,
        angle: angle + (rnd(this.seed, item.index, 29) - 0.5) * 1.2,
        weight: 0.75 + rnd(this.seed, item.index, 30) * 0.55,
      };
      item.flow.set(seed.x, seed.y, seed.z);
      return seed;
    });
  }

  _generateColorField() {
    const data = new Uint8Array(FIELD_W * FIELD_H * 4);
    const seeds = this._fieldSeeds || [];
    if (seeds.length === 0) {
      this._replaceFieldTexture(data);
      return;
    }

    for (let iz = 0; iz < FIELD_Z; iz++) {
      const z = -FIELD_BOUND + ((iz + 0.5) / FIELD_Z) * FIELD_BOUND * 2;
      const atlasX = (iz % FIELD_COLS) * FIELD_X;
      const atlasY = Math.floor(iz / FIELD_COLS) * FIELD_Y;
      for (let iy = 0; iy < FIELD_Y; iy++) {
        const y = ((iy + 0.5) / FIELD_Y) * TOTAL_H;
        const normalizedY = y / TOTAL_H;
        const maxRadius = trophyRadiusAt(normalizedY) * 0.88;
        for (let ix = 0; ix < FIELD_X; ix++) {
          const x = -FIELD_BOUND + ((ix + 0.5) / FIELD_X) * FIELD_BOUND * 2;
          if (Math.hypot(x, z) > maxRadius) continue;

          let densitySum = 0;
          let red = 0;
          let green = 0;
          let blue = 0;
          for (const seed of seeds) {
            const dy = y - seed.y;
            if (Math.abs(dy) > seed.stretch * 2.4) continue;
            const bendX = seed.x + Math.sin(dy * 1.45 + seed.phase) * seed.curl + dy * 0.035 * Math.cos(seed.phase);
            const bendZ = seed.z + Math.cos(dy * 1.2 + seed.phase) * seed.curl + dy * 0.03 * Math.sin(seed.phase);
            const dx = x - bendX;
            const dz = z - bendZ;
            const c = Math.cos(seed.angle);
            const s = Math.sin(seed.angle);
            const broad = dx * c + dz * s;
            const narrow = -dx * s + dz * c;
            const shape =
              (broad * broad) / (seed.width * seed.width) +
              (narrow * narrow) / (seed.thin * seed.thin) +
              (dy * dy) / (seed.stretch * seed.stretch);
            const density = Math.exp(-shape * 0.72) * seed.weight;
            if (density < 0.015) continue;
            densitySum += density;
            red += seed.color.r * density;
            green += seed.color.g * density;
            blue += seed.color.b * density;
          }

          if (densitySum < 0.025) continue; // preserve clear glass between currents
          const alpha = clamp01(1 - Math.exp(-densitySum * 0.72));
          const pixelX = atlasX + ix;
          const pixelY = atlasY + iy;
          const offset = (pixelY * FIELD_W + pixelX) * 4;
          data[offset] = Math.round(clamp01(red / densitySum) * 255);
          data[offset + 1] = Math.round(clamp01(green / densitySum) * 255);
          data[offset + 2] = Math.round(clamp01(blue / densitySum) * 255);
          data[offset + 3] = Math.round(alpha * 255);
        }
      }
    }
    this._replaceFieldTexture(data);
  }

  _replaceFieldTexture(data) {
    const previous = this._fieldTexture;
    this._fieldTexture = new THREE.DataTexture(data, FIELD_W, FIELD_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this._fieldTexture.minFilter = THREE.LinearFilter;
    this._fieldTexture.magFilter = THREE.LinearFilter;
    this._fieldTexture.generateMipmaps = false;
    this._fieldTexture.wrapS = THREE.ClampToEdgeWrapping;
    this._fieldTexture.wrapT = THREE.ClampToEdgeWrapping;
    this._fieldTexture.colorSpace = THREE.NoColorSpace;
    this._fieldTexture.needsUpdate = true;
    if (this._shader) this._shader.uniforms.uGlassField.value = this._fieldTexture;
    previous?.dispose();
  }

  pulse() {}

  impact() {
    this._settlePulse = 1;
  }

  setLive() {}
  setPixelRatio() {}

  _setBodyState(progress) {
    const p = smooth(progress);
    this._glassMat.opacity = 0.34 + p * 0.66;
    this._glassMat.roughness = 0.1 - p * 0.07;
    this._glassMat.transmission = 0.96 - p * 0.08;
    this._glassMat.thickness = 2.45 + p * 0.65;
    this._rimMat.opacity = 0.58 + p * 0.4;
    this._rimMat.roughness = 0.06 - p * 0.025;
    this._collarMat.opacity = 0.32 * (1 - p);
  }

  update(timeSec) {
    const dt = Math.min(0.08, Math.max(0, timeSec - this._lastT));
    this._lastT = timeSec;
    this._now = timeSec;

    if (this.mode === 'collecting') {
      for (const item of this.materials) {
        const age = timeSec - item.born;
        if (age < 0 || age > 1.1) continue;
        const fall = smooth(age / 0.72);
        item.mesh.position.lerpVectors(new THREE.Vector3(0, TOTAL_H + 0.28, 0), item.target, fall);
        if (age > 0.66) {
          const bounceAge = age - 0.66;
          item.mesh.position.y += Math.sin(bounceAge * 20) * Math.exp(-bounceAge * 9) * 0.018;
        }
      }
      this._fieldReveal = 0;
      this._setBodyState(0);
    } else if (this.mode === 'melting') {
      this._castAge += dt;
      const heat = smooth((this._castAge - 0.15) / 1.05);
      const draw = smooth((this._castAge - 0.6) / 3.0);
      const cool = smooth((this._castAge - 3.55) / 1.45);
      this._fieldReveal = draw;
      this._setBodyState(smooth((this._castAge - 0.4) / 4.3));

      const beadVisibility = 1 - smooth((this._castAge - 0.28) / 1.85);
      for (const material of this._beadMaterials) {
        material.opacity = beadVisibility * 0.96;
        material.transmission = 0.24 + heat * 0.48;
        material.roughness = 0.11 - heat * 0.065;
      }
      for (const item of this.materials) {
        const collapse = smooth((this._castAge - 0.38 - item.index * 0.008) / 1.55);
        const vanish = smooth((this._castAge - 1.1 - item.index * 0.006) / 1.0);
        const radial = item.size * (1 - collapse * 0.9);
        const vertical = item.size * (1 + collapse * 3.8) * (1 - vanish * 0.9);
        item.mesh.scale.set(Math.max(0.025, radial), Math.max(0.025, vertical), Math.max(0.025, radial));
      }
      if (this._castAge > 2.25) this._materialGroup.visible = false;

      this._glassMat.roughness = 0.03 + (1 - cool) * 0.065;
      if (this._castAge >= 5.2) {
        this.mode = 'sealed';
        this._materialGroup.visible = false;
        this._fieldReveal = 1;
        this._setBodyState(1);
      }
    }

    this._settlePulse *= Math.exp(-dt / 0.22);
    const settle = Math.sin(this._settlePulse * Math.PI) * this._settlePulse * 0.006;
    this.group.scale.set(1 + settle, 1 - settle * 0.35, 1 + settle);
    if (this._shader) this._shader.uniforms.uGlassFieldReveal.value = this._fieldReveal;
  }

  dispose() {
    this._bodyGeom.dispose();
    this._beadGeom.dispose();
    this._body.traverse((object) => object.geometry?.dispose?.());
    for (const material of [this._glassMat, this._rimMat, this._collarMat, ...this._beadMaterials]) material.dispose();
    this._rim.geometry.dispose();
    this._collar.geometry.dispose();
    this._fieldTexture.dispose();
  }
}

export { TOTAL_H, BASE_H, GLASS_H };
