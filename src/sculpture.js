// Emotion Sculpture — one closed, fluid rock.
//
// Time is not rendered as stacked geometry. Beats accumulate into deterministic
// material fields, while the live input only changes those fields immediately.

import * as THREE from 'three';
import {
  EMOTIONS,
  N_EMOTIONS,
  BASELINE,
  totalIntensity,
} from './emotions.js';

const LONGITUDES = 72;
const LATITUDES = 32;
const INCLUSION_LONGITUDES = 48;
const INCLUSION_LATITUDES = 24;
const BASE_RADIUS = 1.2;
const ROCK_HEIGHT = 2.5;
const ROCK_CENTER_Y = 1.25;
const LIVE_BLEND = 0.86;
const QUIET = [BASELINE, BASELINE, BASELINE];
const GLASS = [0.78, 0.84, 0.94];

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

function seedPhase(seed, salt = 0) {
  return (((seed ^ (salt * 0x9e3779b9)) >>> 0) % 100000) / 100000 * Math.PI * 2;
}

function normalize(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function emotionColor(index) {
  return new THREE.Color(EMOTIONS[index].hex);
}

function fieldDirections(seed) {
  const phase = seedPhase(seed, 27);
  return [
    normalize(Math.cos(phase) * 0.8, 0.18, Math.sin(phase) * 0.8),
    normalize(Math.cos(phase + 2.12) * 0.72, -0.08, Math.sin(phase + 2.12) * 0.72),
    normalize(Math.cos(phase + 4.25) * 0.66, 0.1, Math.sin(phase + 4.25) * 0.66),
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function createRockGeometry(seed, longitudes = LONGITUDES, latitudes = LATITUDES) {
  const positions = new Float32Array((latitudes + 1) * longitudes * 3);
  const phaseA = seedPhase(seed, 1);
  const phaseB = seedPhase(seed, 2);
  const phaseC = seedPhase(seed, 3);

  for (let lat = 0; lat <= latitudes; lat++) {
    const v = lat / latitudes;
    const phi = v * Math.PI - Math.PI / 2;
    const yUnit = Math.sin(phi);
    const ringRadius = Math.cos(phi);

    for (let lon = 0; lon < longitudes; lon++) {
      const theta = (lon / longitudes) * Math.PI * 2;
      const macro =
        1 +
        0.12 * Math.sin(theta * 2.0 + phi * 1.55 + phaseA) +
        0.065 * Math.sin(theta * 3.0 - phi * 2.2 + phaseB) +
        0.02 * Math.cos(theta * 4.0 + phi * 2.4 + phaseC) +
        0.03 * Math.sin(theta * 1.1 + phaseC);
      const broad = 1 + 0.05 * Math.sin(phi * 2.0 + phaseB);
      // Fade angular deformation into the poles so the closed surface has no
      // accidental flat cap or pinched seam.
      const poleFade = Math.pow(ringRadius, 0.6);
      const radius = 1 + (macro * broad - 1) * poleFade;
      const index = (lat * longitudes + lon) * 3;

      positions[index] = BASE_RADIUS * ringRadius * radius * Math.cos(theta);
      const softenedY = Math.sign(yUnit) * Math.pow(Math.abs(yUnit), 1.24);
      positions[index + 1] = ROCK_CENTER_Y + (ROCK_HEIGHT * 0.5) * softenedY * radius;
      positions[index + 2] = BASE_RADIUS * ringRadius * radius * Math.sin(theta);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const indices = [];
  for (let lat = 0; lat < latitudes; lat++) {
    for (let lon = 0; lon < longitudes; lon++) {
      const next = (lon + 1) % longitudes;
      const a = lat * longitudes + lon;
      const b = lat * longitudes + next;
      const c = (lat + 1) * longitudes + next;
      const d = (lat + 1) * longitudes + lon;
      indices.push(a, b, d, b, c, d);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createInclusionGeometry(seed) {
  const geometry = createRockGeometry(seed, INCLUSION_LONGITUDES, INCLUSION_LATITUDES);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, position.getX(i) / BASE_RADIUS, (position.getY(i) - ROCK_CENTER_Y) / (ROCK_HEIGHT * 0.5), position.getZ(i) / BASE_RADIUS);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export class Sculpture {
  constructor(sessionSeed) {
    this.seed = sessionSeed >>> 0;
    this.beats = [];
    this.live = false;
    this.liveE = QUIET.slice();
    this._fieldE = QUIET.slice();
    this._lastEma = QUIET.slice();
    this._pulse = 0;
    this._impulse = 0;
    this._impulseEmotion = 0;
    this._directions = fieldDirections(this.seed);

    this.geometry = createRockGeometry(this.seed);
    this.material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      transparent: false,
      roughness: 0.13,
      metalness: 0.025,
      clearcoat: 0.82,
      clearcoatRoughness: 0.12,
      // Keep the optical read stable on browsers whose transmission buffer
      // can introduce a black matte; clearcoat carries the glass highlight.
      transmission: 0,
      thickness: 0.85,
      ior: 1.44,
      attenuationColor: new THREE.Color(0x9bbdff),
      attenuationDistance: 3.8,
      emissive: new THREE.Color(0x11182b),
      emissiveIntensity: 0.045,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.auraMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xdceaff,
      transparent: true,
      opacity: 0.08,
      roughness: 0.08,
      transmission: 0,
      thickness: 0.2,
      ior: 1.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.aura = new THREE.Mesh(this.geometry, this.auraMaterial);
    this.aura.scale.setScalar(1.025);

    // These are broad internal inclusions, not external emotion lines. Their
    // positions and scales are stable for a seed, then material fields animate.
    const inclusionScales = [
      [0.7, 0.32, 0.5],
      [0.48, 0.6, 0.42],
      [0.65, 0.25, 0.7],
    ];
    this.inclusions = EMOTIONS.map((emotion, index) => {
      const geometry = createInclusionGeometry(this.seed + 101 + index * 7919);
      const material = new THREE.MeshPhysicalMaterial({
        color: emotionColor(index),
        transparent: true,
        opacity: 0.18,
        roughness: index === 1 ? 0.2 : 0.12,
        metalness: 0.02,
        clearcoat: 0.7,
        clearcoatRoughness: 0.15,
        transmission: 0,
        thickness: 0.28,
        ior: 1.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const direction = this._directions[index];
      const scale = inclusionScales[index];
      mesh.position.set(direction[0] * 0.2, ROCK_CENTER_Y + direction[1] * 0.25, direction[2] * 0.2);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.renderOrder = 1;
      return mesh;
    });

    this.group = new THREE.Group();
    this.inclusions.forEach((inclusion) => this.group.add(inclusion));
    // The clearcoat on the hero shell already supplies the glass edge. A
    // second coplanar shell produces aliasing bands, so keep it off-canvas.
    this.group.add(this.mesh);
    this._updateSurfaceColors();
    this._updateMaterialFields();
  }

  get height() {
    return ROCK_HEIGHT;
  }

  beginLive() {
    this.live = true;
    this.liveE = QUIET.slice();
    this.rebuild();
  }

  reset() {
    this.beats = [];
    this.liveE = QUIET.slice();
    this.rebuild();
  }

  addBeat(beat) {
    this.beats.push(beat);
    this.rebuild();
  }

  setBeats(beats) {
    this.live = false;
    this.beats = beats.slice();
    this.rebuild();
  }

  pulse(emotionIndex) {
    this._pulse = Math.min(1.8, this._pulse + (emotionIndex === 2 ? 0.55 : 0.8));
    this._impulse = Math.min(1.35, this._impulse + 1.0);
    this._impulseEmotion = emotionIndex;
    this.liveE[emotionIndex] = Math.min(1, this.liveE[emotionIndex] + (emotionIndex === 1 ? 0.62 : 0.34));
    this._updateMaterialFields();
  }

  _accumulateFields() {
    const fields = QUIET.slice();
    const ema = QUIET.slice();
    for (const beat of this.beats) {
      for (let i = 0; i < N_EMOTIONS; i++) {
        ema[i] = lerp(ema[i], beat.e[i], 0.28);
        fields[i] = Math.min(1, fields[i] * 0.9 + Math.max(0, beat.e[i] - BASELINE) * 0.65);
      }
    }
    this._lastEma = ema;
    return fields;
  }

  _surfaceField(point, index) {
    const direction = this._directions[index];
    const facing = Math.max(0, dot(point, direction));
    const width = index === 1 ? 0.58 : index === 2 ? 0.9 : 0.78;
    const broad = Math.pow(0.5 + 0.5 * facing, 1 / width);
    const swirl = 0.72 + 0.28 * Math.sin(point[0] * 4.0 + point[1] * 3.0 + point[2] * 3.5 + seedPhase(this.seed, index + 8));
    return broad * swirl;
  }

  _updateSurfaceColors() {
    const position = this.geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const point = normalize(position.getX(i) / BASE_RADIUS, (position.getY(i) - ROCK_CENTER_Y) / (ROCK_HEIGHT * 0.5), position.getZ(i) / BASE_RADIUS);
      const weights = this._fieldE.map((strength, index) => strength * this._surfaceField(point, index));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let r = GLASS[0] * (1 - Math.min(0.72, total * 0.35));
      let g = GLASS[1] * (1 - Math.min(0.68, total * 0.32));
      let b = GLASS[2] * (1 - Math.min(0.55, total * 0.2));

      // Weighted field layering preserves separate color masses instead of
      // collapsing all emotions into one RGB average.
      weights.forEach((weight, index) => {
        const amount = Math.min(0.84, weight * 1.05);
        const color = EMOTIONS[index].rgb;
        r = lerp(r, color[0], amount);
        g = lerp(g, color[1], amount);
        b = lerp(b, color[2], amount);
      });

      const edgeLight = 0.86 + 0.28 * Math.pow(1 - Math.abs(point[1]), 1.7);
      colors[i * 3] = Math.min(1.35, r * edgeLight);
      colors[i * 3 + 1] = Math.min(1.35, g * edgeLight);
      colors[i * 3 + 2] = Math.min(1.35, b * edgeLight);
    }
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  _updateMaterialFields() {
    const live = this.live ? this.liveE : QUIET;
    for (let i = 0; i < N_EMOTIONS; i++) {
      const strength = clamp01(this._fieldE[i] + live[i] * LIVE_BLEND);
      const inclusion = this.inclusions[i];
      const material = inclusion.material;
      const impulse = this._impulseEmotion === i ? this._impulse : 0;
      material.opacity = 0.1 + strength * (i === 1 ? 0.28 : 0.22) + impulse * 0.06;
      const base = i === 0 ? 1 + strength * 0.16 : i === 1 ? 1 - strength * 0.08 : 1 + strength * 0.08;
      const pulse = i === 2 ? 1 + Math.sin(this._breathTime || 0) * strength * 0.045 : 1;
      inclusion.scale.multiplyScalar(1 / (inclusion.userData.lastScale || 1));
      inclusion.scale.multiplyScalar(base * pulse);
      inclusion.userData.lastScale = base * pulse;
    }
    this.material.emissiveIntensity = 0.035 + totalIntensity(this._fieldE) * 0.055 + this._pulse * 0.018;
  }

  rebuild() {
    this._fieldE = this._accumulateFields();
    this._updateSurfaceColors();
    this._updateMaterialFields();
  }

  // Kept as the input controller's update hook. It updates material fields;
  // there is deliberately no live top ring to mutate.
  updateLiveRing(liveE) {
    if (!this.live) return;
    this.liveE = liveE.slice();
    this._updateMaterialFields();
  }

  update(timeSec) {
    this._breathTime = timeSec * 0.9;
    this._pulse *= 0.91;
    this._impulse = Math.max(0, this._impulse - 0.055);
    this.auraMaterial.opacity = 0.065 + this._pulse * 0.035;
    this.mesh.scale.setScalar(1 + this._pulse * 0.008);
    this.aura.scale.setScalar(1.025 + this._pulse * 0.012);
    this.group.rotation.y = timeSec * 0.055;
    this.group.rotation.z = Math.sin(timeSec * 0.32) * 0.012;
    this._updateMaterialFields();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.auraMaterial.dispose();
    this.inclusions.forEach((inclusion) => {
      inclusion.geometry.dispose();
      inclusion.material.dispose();
    });
  }
}

export { BASE_RADIUS };
