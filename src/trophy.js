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

export const COLLECTION_CONFIG = Object.freeze({
  minManualCastCount: 12,
  targetSphereCount: 42,
  hardMaxSphereCount: 48,
  autoCastFillHeight: 0.80,
  autoCastMinCount: 36,
  sphereDiameterToInnerCupWidth: 0.115,
  spawnIntervalMs: 120,
  settleVelocityThreshold: 0.035,
  settleDurationMs: 350,
});

export const COLOR_FIELD_CONFIG = Object.freeze({
  minFlowCount: 5,
  maxFlowCount: 9,
  minMajorFlows: 2,
  maxMajorFlows: 3,
  maxSingleFlowContribution: 0.28,
  minClearGlassFraction: 0.35,
  maxClearGlassFraction: 0.60,
  minFlowWidth: 0.035,
  maxFlowWidth: 0.095,
  maxFlowOpacity: 0.72,
  minFlowOpacity: 0.18,
});

const CAPACITY = COLLECTION_CONFIG.hardMaxSphereCount;

const FIELD_X = 64;
const FIELD_Y = 128;
const FIELD_Z = 64;
const FIELD_COLS = 8;
const FIELD_ROWS = 8;
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

const MAX_INNER_BOWL_WIDTH = upperProfileAt(0.96) * R_UNIT * 2 * 0.9;
const BEAD_RADIUS = MAX_INNER_BOWL_WIDTH * COLLECTION_CONFIG.sphereDiameterToInnerCupWidth * 0.5;
const WALL_MARGIN = BEAD_RADIUS * 1.15;
const RIM_MARGIN = BEAD_RADIUS * 1.5;
const BOTTOM_MARGIN = BEAD_RADIUS * 0.75;
const BOWL_JUNCTION_Y = BASE_H + GLASS_H * 0.31;
const FILL_MIN_Y = BOWL_JUNCTION_Y + BOTTOM_MARGIN;
const FILL_MAX_Y = TOTAL_H - RIM_MARGIN;

const FILL_VOLUME = Object.freeze({
  center: new THREE.Vector3(0, (FILL_MIN_Y + FILL_MAX_Y) * 0.5, 0),
  minY: FILL_MIN_Y,
  maxY: FILL_MAX_Y,
  maxRadiusAtY(y) {
    const normalizedY = clamp01(y / TOTAL_H);
    return Math.max(BEAD_RADIUS, trophyRadiusAt(normalizedY) * 0.86 - WALL_MARGIN);
  },
});

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

function makeTrophyGeometry(radialScale = 1, seed = 0) {
  const points = BASE_PROFILE.map(([u, r]) => new THREE.Vector2(r * R_UNIT * radialScale, u * TOTAL_H));
  for (let i = 1; i <= 88; i++) {
    const u = i / 88;
    points.push(new THREE.Vector2(upperProfileAt(u) * R_UNIT * radialScale, BASE_H + u * GLASS_H));
  }
  const geometry = new THREE.LatheGeometry(points, 112);
  const position = geometry.attributes.position;
  const phase = rnd(seed, 0, 91) * Math.PI * 2;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const u = clamp01(y / TOTAL_H);
    const angle = Math.atan2(z, x);
    const bowl = smooth((u - 0.18) / 0.28);
    const rim = smooth((u - 0.84) / 0.16);
    const radialVariation =
      1 +
      Math.sin(angle + phase) * 0.0048 * bowl +
      Math.sin(angle * 2 + y * 0.82 + phase * 0.63) * 0.0026;
    position.setXYZ(
      i,
      x * radialVariation,
      y + rim * (Math.sin(angle + phase) * 0.008 + Math.sin(angle * 3 - phase) * 0.0025),
      z * radialVariation
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function makeRimGeometry(seed) {
  const geometry = new THREE.TorusGeometry(upperProfileAt(1) * R_UNIT, 0.034, 18, 128);
  const position = geometry.attributes.position;
  const phase = rnd(seed, 0, 92) * Math.PI * 2;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(y, x);
    position.setZ(i, z + Math.sin(angle + phase) * 0.008 + Math.sin(angle * 3 - phase) * 0.002);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function makePhysicalGlass(color, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: options.roughness ?? 0.07,
    transmission: options.transmission ?? 1,
    thickness: options.thickness ?? 0.65,
    ior: 1.46,
    clearcoat: 0.15,
    clearcoatRoughness: 0.04,
    attenuationDistance: 2.4,
    attenuationColor: new THREE.Color(0xf7fbff),
    envMapIntensity: options.envMapIntensity ?? 1.45,
    specularIntensity: 1,
    specularColor: new THREE.Color(0xffffff),
    transparent: true,
    opacity: options.opacity ?? 1,
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
    this._stadiumOptics = 0;
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

  get sphereCount() {
    return this.materials.length;
  }

  get visibleFillHeight() {
    if (this.materials.length === 0) return 0;
    const topValues = this.materials
      .map((item) => item.mesh.position.y + BEAD_RADIUS * item.size)
      .sort((a, b) => a - b);
    const index = Math.floor((topValues.length - 1) * 0.9);
    return clamp01((topValues[index] - FILL_VOLUME.minY) / (FILL_VOLUME.maxY - FILL_VOLUME.minY));
  }

  get autoCastReady() {
    return this.sphereCount >= COLLECTION_CONFIG.autoCastMinCount &&
      this.visibleFillHeight >= COLLECTION_CONFIG.autoCastFillHeight;
  }

  get debugMetrics() {
    return {
      sphereCount: this.sphereCount,
      visibleFillHeight: this.visibleFillHeight,
      flowCount: this._fieldSeeds?.length ?? 0,
      largestFlowContribution: this._largestFlowContribution ?? 0,
      clearGlassFraction: this._clearGlassFraction ?? 1,
    };
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
    this._bodyGeom = makeTrophyGeometry(1, this.seed);
    this._glassMat = makePhysicalGlass(0xffffff, {
      opacity: 1,
      transmission: 1,
      roughness: 0.07,
      thickness: 0.65,
      envMapIntensity: 1.85,
    });

    this._glassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGlassField = { value: this._fieldTexture };
      shader.uniforms.uGlassFieldReveal = { value: this._fieldReveal };
      shader.uniforms.uGlassCameraLocal = { value: this._cameraLocal };
      shader.uniforms.uStadiumOptics = { value: this._stadiumOptics };

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
        uniform float uStadiumOptics;
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
        vec3 glassColorSum = vec3(0.0);
        float glassColorWeight = 0.0;
        float glassIntegratedDensity = 0.0;
        vec3 glassMarch = vGlassLocalPosition + vGlassRayDirection * 0.035;
        for (int glassStep = 0; glassStep < 24; glassStep++) {
          glassMarch += vGlassRayDirection * 0.1083;
          vec4 glassSample = sampleGlassVolume(glassMarch);
          float sampleDensity = glassSample.a * uGlassFieldReveal;
          float sampleWeight = sampleDensity * (0.65 + sampleDensity * 0.35);
          glassColorSum += glassSample.rgb * sampleWeight;
          glassColorWeight += sampleWeight;
          glassIntegratedDensity += sampleDensity;
        }
        vec3 internalGlassColor = glassColorSum / max(glassColorWeight, 0.001);
        internalGlassColor = min(vec3(1.0), pow(internalGlassColor, vec3(0.92)) * 1.08);
        float internalGlassAmount = smoothstep(0.18, 2.4, glassIntegratedDensity);
        diffuseColor.rgb = mix(diffuseColor.rgb, internalGlassColor, internalGlassAmount * 0.74);`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float stadiumFresnel = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.2);
        float stadiumHeight = clamp(vGlassLocalPosition.y / ${TOTAL_H.toFixed(4)}, 0.0, 1.0);
        float stadiumUpper = smoothstep(0.54, 0.94, stadiumHeight);
        float stadiumLower = 1.0 - smoothstep(0.18, 0.42, stadiumHeight);
        float stadiumWarmEdge = smoothstep(0.35, 0.82, vGlassLocalPosition.x / ${FIELD_BOUND.toFixed(4)})
          * smoothstep(0.32, 0.54, stadiumHeight)
          * (1.0 - smoothstep(0.54, 0.76, stadiumHeight));
        vec3 stadiumReflection =
          vec3(0.55, 0.72, 1.0) * stadiumUpper * 0.22 +
          vec3(0.28, 0.55, 0.36) * stadiumLower * 0.09 +
          vec3(1.0, 0.48, 0.25) * stadiumWarmEdge * 0.055 +
          vec3(0.72, 0.76, 0.78) * 0.035;
        outgoingLight += stadiumReflection * stadiumFresnel * uStadiumOptics;
        #include <opaque_fragment>`
      );
      this._shader = shader;
    };
    this._glassMat.customProgramCacheKey = () => 'emotion-art-glass-volume-v2';

    this._body = new THREE.Mesh(this._bodyGeom, this._glassMat);
    this._body.castShadow = true;
    this._body.receiveShadow = true;
    // The clear shell renders first; discrete collection beads render over it
    // while still being clipped by their bowl-only packing positions.
    this._body.renderOrder = 1;
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
      makeRimGeometry(this.seed),
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
    // Eight visible strata make the actual bead tops, rather than a shader
    // proxy, describe the fill height. Narrow lower layers never enter the stem.
    const layerCapacities = [4, 5, 6, 6, 7, 7, 7, 6];
    const layerHeights = [0.02, 0.15, 0.29, 0.43, 0.57, 0.71, 0.85, 0.96];
    let layer = 0;
    let firstInLayer = 0;
    while (layer < layerCapacities.length - 1 && index >= firstInLayer + layerCapacities[layer]) {
      firstInLayer += layerCapacities[layer];
      layer++;
    }
    const slot = index - firstInLayer;
    const slotCount = layerCapacities[layer];
    const y = FILL_VOLUME.minY + layerHeights[layer] * (FILL_VOLUME.maxY - FILL_VOLUME.minY);
    const maxRadius = FILL_VOLUME.maxRadiusAtY(y);
    const angle = (slot / slotCount) * Math.PI * 2 + layer * 0.49 + (rnd(this.seed, index, 3) - 0.5) * 0.06;
    const radial = Math.min(
      maxRadius * 0.78,
      BEAD_RADIUS * (slotCount <= 4 ? 1.12 : slotCount <= 5 ? 2.15 : 3.25 + layer * 0.08)
    );
    return new THREE.Vector3(
      Math.cos(angle) * radial,
      Math.min(FILL_VOLUME.maxY, Math.max(FILL_VOLUME.minY, y + (rnd(this.seed, index, 5) - 0.5) * 0.018)),
      Math.sin(angle) * radial
    );
  }

  finishCast() {
    this.live = false;
    this.mode = 'melting';
    this._castAge = 0;
    this.castU = this.materials.length / CAPACITY;
    this._snapshotCastSeeds();
    this._prepareFieldSeeds();
    this._generateColorField();
  }

  _snapshotCastSeeds() {
    this._castSeeds = Object.freeze(this.materials.map((item, index) => Object.freeze({
      localPosition: item.mesh.position.clone(),
      color: new THREE.Color(COLORS[item.emotion]),
      emotion: item.emotion,
      insertionIndex: item.detail.sequence ?? index,
      weight: 1,
    })));
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
    this._snapshotCastSeeds();
    this._prepareFieldSeeds();
    this._generateColorField();
    this._materialGroup.visible = false;
    this._fieldReveal = 1;
    this._setBodyState(1);
  }

  _prepareFieldSeeds() {
    const castSeeds = this._castSeeds || [];
    if (castSeeds.length === 0) {
      this._fieldSeeds = [];
      this._fieldComposition = { counts: [0, 0, 0], roles: [] };
      return;
    }

    const flowCount = Math.min(
      COLOR_FIELD_CONFIG.maxFlowCount,
      Math.max(COLOR_FIELD_CONFIG.minFlowCount, Math.floor(castSeeds.length / 5))
    );
    const byEmotion = [0, 1, 2].map((emotion) =>
      castSeeds
        .filter((seed) => seed.emotion === emotion)
        .sort((a, b) => a.insertionIndex - b.insertionIndex || a.localPosition.y - b.localPosition.y)
    );
    const allocation = byEmotion.map((seeds) => (seeds.length > 0 ? 1 : 0));
    while (allocation.reduce((sum, value) => sum + value, 0) < flowCount) {
      let chosen = 0;
      for (let emotion = 1; emotion < byEmotion.length; emotion++) {
        const score = byEmotion[emotion].length / Math.max(1, allocation[emotion] + 1);
        const chosenScore = byEmotion[chosen].length / Math.max(1, allocation[chosen] + 1);
        if (score > chosenScore) chosen = emotion;
      }
      allocation[chosen]++;
    }

    const groups = [];
    byEmotion.forEach((seeds, emotion) => {
      if (seeds.length === 0) return;
      const buckets = Array.from({ length: allocation[emotion] }, () => []);
      seeds.forEach((seed, index) => {
        buckets[Math.min(buckets.length - 1, Math.floor(index * buckets.length / seeds.length))].push(seed);
      });
      buckets.forEach((bucket) => groups.push({ seeds: bucket, emotion }));
    });
    groups.sort((a, b) =>
      (b.seeds.length - a.seeds.length) ||
      (a.seeds[0]?.insertionIndex ?? 0) - (b.seeds[0]?.insertionIndex ?? 0)
    );

    const heroAngle = 0.48;
    const screenRight = new THREE.Vector2(Math.cos(heroAngle), -Math.sin(heroAngle));
    const viewDepth = new THREE.Vector2(Math.sin(heroAngle), Math.cos(heroAngle));
    const anchorFractions = [0.16, 0.49, 0.82, -0.17, 0.34, 0.67, 0.92, 0.57, 0.24];
    const bowlSpan = FILL_VOLUME.maxY - FILL_VOLUME.minY;

    this._fieldSeeds = groups.map((group, ordinal) => {
      const contribution = Math.min(
        COLOR_FIELD_CONFIG.maxSingleFlowContribution,
        group.seeds.length / castSeeds.length
      );
      const normalizedWidth = THREE.MathUtils.clamp(
        0.048 + contribution * 0.18 + rnd(this.seed, ordinal, 211) * 0.018,
        COLOR_FIELD_CONFIG.minFlowWidth,
        COLOR_FIELD_CONFIG.maxFlowWidth
      );
      const width = normalizedWidth * MAX_INNER_BOWL_WIDTH;
      const opacity = THREE.MathUtils.clamp(
        COLOR_FIELD_CONFIG.minFlowOpacity + Math.sqrt(contribution / COLOR_FIELD_CONFIG.maxSingleFlowContribution) * 0.42,
        COLOR_FIELD_CONFIG.minFlowOpacity,
        COLOR_FIELD_CONFIG.maxFlowOpacity
      );
      const isStemTrace = ordinal === 3;
      const centerY = isStemTrace
        ? BOWL_JUNCTION_Y - 0.3
        : FILL_VOLUME.minY + clamp01(anchorFractions[ordinal]) * bowlSpan;
      const localRadius = trophyRadiusAt(centerY / TOTAL_H) * (isStemTrace ? 0.22 : 0.48);
      const side = ordinal % 2 === 0 ? -1 : 1;
      const screenOffset = side * localRadius * (0.55 + rnd(this.seed, ordinal, 214) * 0.35);
      const depthOffset = (rnd(this.seed, ordinal, 215) - 0.5) * localRadius * 1.25;
      const centerX = screenRight.x * screenOffset + viewDepth.x * depthOffset;
      const centerZ = screenRight.y * screenOffset + viewDepth.y * depthOffset;
      const phase = rnd(this.seed, ordinal, 216) * Math.PI * 2;
      const lobeCount = 5 + (ordinal % 2);
      const verticalSpan = isStemTrace ? 0.38 : 0.54 + rnd(this.seed, ordinal, 217) * 0.34;
      const lobes = [];

      for (let sampleIndex = 0; sampleIndex < lobeCount; sampleIndex++) {
        const t = sampleIndex / Math.max(1, lobeCount - 1) - 0.5;
        const branch = sampleIndex >= Math.ceil(lobeCount * 0.55) ? side : -side * 0.35;
        const pulse = 0.74 + 0.26 * Math.sin(sampleIndex * 2.17 + phase);
        const localY = centerY + t * verticalSpan + Math.sin(sampleIndex * 1.7 + phase) * 0.035;
        const radiusLimit = trophyRadiusAt(clamp01(localY / TOTAL_H)) * 0.64;
        const warpX = Math.sin(t * Math.PI * 1.6 + phase) * width * 0.78 + branch * width * Math.abs(t) * 0.55;
        const warpZ = Math.cos(t * Math.PI * 1.35 + phase) * width * 0.62 - branch * width * 0.28;
        const x = THREE.MathUtils.clamp(centerX + warpX, -radiusLimit, radiusLimit);
        const z = THREE.MathUtils.clamp(centerZ + warpZ, -radiusLimit, radiusLimit);
        lobes.push({
          center: new THREE.Vector3(x, localY, z),
          radiusX: width * pulse,
          radiusY: width * (1.55 + rnd(this.seed, sampleIndex, 221 + ordinal) * 0.72),
          radiusZ: width * (0.62 + rnd(this.seed, sampleIndex, 231 + ordinal) * 0.3),
          weight: (sampleIndex === Math.floor(lobeCount / 2) ? 0.54 : 0.7 + rnd(this.seed, sampleIndex, 241 + ordinal) * 0.3),
        });
      }

      return {
        role: ordinal < 3 ? 'major' : isStemTrace ? 'trace' : 'secondary',
        emotion: group.emotion,
        seeds: group.seeds,
        color: new THREE.Color(COLORS[group.emotion]),
        contribution,
        width: normalizedWidth,
        opacity,
        phase,
        lobes,
      };
    });

    this._largestFlowContribution = Math.max(...this._fieldSeeds.map((flow) => flow.contribution));
    this._fieldComposition = {
      counts: byEmotion.map((seeds) => seeds.length),
      roles: this._fieldSeeds.map(({ role, emotion, width, opacity, contribution }) => ({
        role,
        emotion,
        width,
        opacity,
        contribution,
      })),
    };
  }

  _generateColorField(attempt = 0) {
    const data = new Uint8Array(FIELD_W * FIELD_H * 4);
    const flows = this._fieldSeeds || [];
    if (flows.length === 0) {
      this._fieldCoverage = 0;
      this._clearGlassFraction = 1;
      this._replaceFieldTexture(data);
      return;
    }

    let insideCount = 0;
    let coloredCount = 0;
    for (let iz = 0; iz < FIELD_Z; iz++) {
      const z = -FIELD_BOUND + ((iz + 0.5) / FIELD_Z) * FIELD_BOUND * 2;
      const atlasX = (iz % FIELD_COLS) * FIELD_X;
      const atlasY = Math.floor(iz / FIELD_COLS) * FIELD_Y;
      for (let iy = 0; iy < FIELD_Y; iy++) {
        const y = ((iy + 0.5) / FIELD_Y) * TOTAL_H;
        const maxRadius = trophyRadiusAt(y / TOTAL_H) * 0.86;
        for (let ix = 0; ix < FIELD_X; ix++) {
          const x = -FIELD_BOUND + ((ix + 0.5) / FIELD_X) * FIELD_BOUND * 2;
          if (Math.hypot(x, z) > maxRadius) continue;
          insideCount++;

          let densitySum = 0;
          let red = 0;
          let green = 0;
          let blue = 0;
          for (const flow of flows) {
            let flowDensity = 0;
            for (const lobe of flow.lobes) {
              const dx = (x - lobe.center.x) / lobe.radiusX;
              const dy = (y - lobe.center.y) / lobe.radiusY;
              const dz = (z - lobe.center.z) / lobe.radiusZ;
              const shape = dx * dx + dy * dy + dz * dz;
              if (shape > 5.2) continue;
              flowDensity += Math.exp(-shape * 1.18) * lobe.weight;
            }
            flowDensity = Math.min(flowDensity * flow.opacity, COLOR_FIELD_CONFIG.maxSingleFlowContribution);
            if (flowDensity < 0.006) continue;
            densitySum += flowDensity;
            red += flow.color.r * flowDensity;
            green += flow.color.g * flowDensity;
            blue += flow.color.b * flowDensity;
          }

          densitySum = Math.min(0.78, densitySum);
          if (densitySum < 0.028) continue;
          const alpha = clamp01((densitySum - 0.02) / 0.42);
          if (alpha >= 0.11) coloredCount++;
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

    this._fieldCoverage = insideCount > 0 ? coloredCount / insideCount : 0;
    this._clearGlassFraction = 1 - this._fieldCoverage;
    const tooClear = this._clearGlassFraction > COLOR_FIELD_CONFIG.maxClearGlassFraction;
    const tooDense = this._clearGlassFraction < COLOR_FIELD_CONFIG.minClearGlassFraction;
    if ((tooClear || tooDense) && attempt < 4) {
      for (const flow of flows) {
        const scaleX = tooClear ? 1.04 : 0.94;
        const scaleY = tooClear ? 1.12 : 0.9;
        const scaleZ = tooClear ? 1.35 : 0.75;
        flow.opacity = THREE.MathUtils.clamp(
          flow.opacity * (tooClear ? 1.08 : 0.92),
          COLOR_FIELD_CONFIG.minFlowOpacity,
          COLOR_FIELD_CONFIG.maxFlowOpacity
        );
        for (const lobe of flow.lobes) {
          // Grow primarily through depth so the 3D density target can be met
          // without merging separate hero-view currents into one broad stripe.
          lobe.radiusX *= scaleX;
          lobe.radiusY *= scaleY;
          lobe.radiusZ *= scaleZ;
        }
      }
      this._generateColorField(attempt + 1);
      return;
    }

    this._fieldValidation = {
      valid: flows.length >= COLOR_FIELD_CONFIG.minFlowCount &&
        flows.length <= COLOR_FIELD_CONFIG.maxFlowCount &&
        this._largestFlowContribution <= COLOR_FIELD_CONFIG.maxSingleFlowContribution &&
        this._clearGlassFraction >= COLOR_FIELD_CONFIG.minClearGlassFraction &&
        this._clearGlassFraction <= COLOR_FIELD_CONFIG.maxClearGlassFraction,
      flowCount: flows.length,
      largestFlowContribution: this._largestFlowContribution,
      clearGlassFraction: this._clearGlassFraction,
    };
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

  setEnvironmentMap(texture) {
    const enhanced = Boolean(texture);
    this._stadiumOptics = enhanced ? 1 : 0;
    if (this._shader) this._shader.uniforms.uStadiumOptics.value = this._stadiumOptics;
    const materials = [this._glassMat, this._rimMat, ...this._beadMaterials];
    for (const material of materials) {
      material.envMap = texture;
      material.needsUpdate = true;
    }
    this._glassMat.envMapIntensity = enhanced ? 2.45 : 1.85;
    this._rimMat.envMapIntensity = enhanced ? 2.35 : 1.8;
    for (const material of this._beadMaterials) material.envMapIntensity = enhanced ? 1.72 : 1.45;
  }

  _setBodyState(progress) {
    const p = smooth(progress);
    this._glassMat.opacity = 1;
    this._glassMat.roughness = 0.07 - p * 0.02;
    this._glassMat.transmission = 1 - p * 0.025;
    this._glassMat.thickness = 0.65;
    this._rimMat.opacity = 0.54 + p * 0.44;
    this._rimMat.roughness = 0.06 - p * 0.032;
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

      this._glassMat.roughness = 0.018 + (1 - cool) * 0.057;
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
