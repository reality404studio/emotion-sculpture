// Emotion Sculpture — an organic, light-carrying form built from deterministic beats.
// The mesh is still reproducible from beats; only the live pulse and breathing are visual.

import * as THREE from 'three';
import {
  EMOTIONS,
  N_EMOTIONS,
  emotionAngle,
  BASELINE,
  QUIET_THRESHOLD,
  totalIntensity,
} from './emotions.js';
import { textureNoise } from './noise.js';

const SEG = 128;
const BASE_RADIUS = 0.82;
const LAYER_HEIGHT = 0.075;
const EMA_A = 0.28;
const LIVE_A = 0.86;
const TEX_AMP = 0.055;
const MICRO_PULSE = 0.035;
const CALM = new THREE.Color(0xbcc7f2);
const IVORY = new THREE.Color(0xf8f7ff);

const lerp = (a, b, t) => a + (b - a) * t;

function wrapAngle(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lobe(emotion, d) {
  const g = Math.exp(-(d * d) / (2 * emotion.lobeWidth * emotion.lobeWidth));
  return emotion.sharpen === 1 ? g : Math.pow(g, emotion.sharpen);
}

function colorForEmotion(index) {
  return new THREE.Color(EMOTIONS[index].hex);
}

export class Sculpture {
  constructor(sessionSeed) {
    this.seed = sessionSeed >>> 0;
    this.beats = [];
    this.live = false;
    this.liveE = [BASELINE, BASELINE, BASELINE];
    this._liveKind = 'quiet';
    this._lastEma = [BASELINE, BASELINE, BASELINE];
    this._pulse = 0;
    this._pulseColor = new THREE.Color(0xffffff);

    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.26,
      metalness: 0.08,
      clearcoat: 0.72,
      clearcoatRoughness: 0.18,
      sheen: 0.35,
      sheenRoughness: 0.2,
      emissive: new THREE.Color(0x10152d),
      emissiveIntensity: 0.06,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    // Keep the main surface on Three's built-in physical shader for broad WebGL support.

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;

    // A translucent shell makes the silhouette read as light, not as a hard 3D print.
    this.auraMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.aura = new THREE.Mesh(this.geometry, this.auraMaterial);
    this.aura.scale.setScalar(1.035);

    this.group = new THREE.Group();
    this.group.add(this.mesh, this.aura);
    this.sparkles = this._createSparkles();
    this.group.add(this.sparkles);
  }

  get height() {
    return Math.max(LAYER_HEIGHT, (this.beats.length + 1) * LAYER_HEIGHT);
  }

  beginLive() {
    this.live = true;
    this.liveE = [BASELINE, BASELINE, BASELINE];
    this.rebuild();
  }

  reset() {
    this.beats = [];
    this.liveE = [BASELINE, BASELINE, BASELINE];
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
    this._pulse = Math.min(1.6, this._pulse + 0.78);
    this._pulseColor.copy(colorForEmotion(emotionIndex));
    // The upper ring is also updated here, so pointer feedback never waits for a tick.
    this.liveE[emotionIndex] = Math.min(1, this.liveE[emotionIndex] + (emotionIndex === 1 ? 0.45 : 0.2));
  }

  _createSparkles() {
    const count = 180;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const n = textureNoise(this.seed, 701, i);
      const angle = (i / count) * Math.PI * 12.0 + n * 0.7;
      const radius = 1.05 + textureNoise(this.seed, 702, i) * 0.45;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (i / count) * 1.2 + textureNoise(this.seed, 703, i) * 0.05;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      const c = i % 3 === 0 ? EMOTIONS[0].rgb : i % 3 === 1 ? EMOTIONS[2].rgb : [0.86, 0.85, 1];
      colors.set(c, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.035,
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.sparkleMaterial = material;
    return new THREE.Points(geometry, material);
  }

  _ringVertices(e, y, ringIndex, kind, out) {
    const total = totalIntensity(e);
    const quiet = e[0] < QUIET_THRESHOLD && e[1] < QUIET_THRESHOLD && e[2] < QUIET_THRESHOLD;
    const micro = quiet ? MICRO_PULSE * Math.sin(ringIndex * 0.35) : 0;
    const roughFactor =
      (kind === 'tap' ? 1 : kind === 'single' ? EMOTIONS[1].rough : 0) * Math.min(1, e[0] + e[1]);

    for (let s = 0; s < SEG; s++) {
      const theta = (s / SEG) * Math.PI * 2;
      let r = BASE_RADIUS + micro;
      let wSum = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (let i = 0; i < N_EMOTIONS; i++) {
        const d = wrapAngle(theta - emotionAngle(i));
        const l = lobe(EMOTIONS[i], d);
        r += e[i] * EMOTIONS[i].lobeAmp * l;
        const w = l + 1e-3;
        wSum += w;
        cr += w * EMOTIONS[i].rgb[0];
        cg += w * EMOTIONS[i].rgb[1];
        cb += w * EMOTIONS[i].rgb[2];
      }
      if (roughFactor > 0) r += TEX_AMP * roughFactor * textureNoise(this.seed, ringIndex, s);

      out.pos[s * 3] = r * Math.cos(theta);
      out.pos[s * 3 + 1] = y;
      out.pos[s * 3 + 2] = r * Math.sin(theta);

      cr /= wSum;
      cg /= wSum;
      cb /= wSum;
      // Quiet layers stay milky and calm; a reaction quickly hands the surface
      // back to the actual emotion colors instead of washing everything white.
      const calmMix = Math.max(0.1, 0.82 - total * 0.74);
      cr = lerp(cr, CALM.r, calmMix);
      cg = lerp(cg, CALM.g, calmMix);
      cb = lerp(cb, CALM.b, calmMix);
      const bright = 0.62 + 0.95 * total;
      out.col[s * 3] = Math.min(1.45, cr * bright);
      out.col[s * 3 + 1] = Math.min(1.45, cg * bright);
      out.col[s * 3 + 2] = Math.min(1.45, cb * bright);
      out.energy[s] = total;
    }
  }

  rebuild() {
    const nBeats = this.beats.length;
    const rings = [];
    if (nBeats > 0 || this.live) {
      rings.push({ e: [BASELINE, BASELINE, BASELINE], y: 0, index: 0, kind: 'quiet' });
    }

    const ema = [BASELINE, BASELINE, BASELINE];
    for (let ri = 0; ri < nBeats; ri++) {
      const beat = this.beats[ri];
      for (let i = 0; i < N_EMOTIONS; i++) ema[i] = lerp(ema[i], beat.e[i], EMA_A);
      rings.push({ e: ema.slice(), y: (ri + 1) * LAYER_HEIGHT, index: ri + 1, kind: beat.kind });
    }
    this._lastEma = ema.slice();

    if (this.live) {
      const liveRE = [
        lerp(this._lastEma[0], this.liveE[0], LIVE_A),
        lerp(this._lastEma[1], this.liveE[1], LIVE_A),
        lerp(this._lastEma[2], this.liveE[2], LIVE_A),
      ];
      rings.push({ e: liveRE, y: (nBeats + 1) * LAYER_HEIGHT, index: nBeats + 1, kind: this._liveKind });
    }

    if (rings.length < 2) {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.setIndex([]);
      return;
    }

    const ringCount = rings.length;
    const centerCount = 2;
    const positions = new Float32Array(ringCount * SEG * 3 + centerCount * 3);
    const colors = new Float32Array(ringCount * SEG * 3 + centerCount * 3);
    const energy = new Float32Array(ringCount * SEG + centerCount);
    const scratch = {
      pos: new Float32Array(SEG * 3),
      col: new Float32Array(SEG * 3),
      energy: new Float32Array(SEG),
    };

    for (let ri = 0; ri < ringCount; ri++) {
      const ring = rings[ri];
      this._ringVertices(ring.e, ring.y, ring.index, ring.kind, scratch);
      positions.set(scratch.pos, ri * SEG * 3);
      colors.set(scratch.col, ri * SEG * 3);
      energy.set(scratch.energy, ri * SEG);
    }

    const bottomCenter = ringCount * SEG;
    const topCenter = bottomCenter + 1;
    const topY = rings[ringCount - 1].y;
    positions.set([0, 0, 0], bottomCenter * 3);
    positions.set([0, topY, 0], topCenter * 3);
    colors.set([IVORY.r, IVORY.g, IVORY.b], bottomCenter * 3);
    colors.set([IVORY.r, IVORY.g, IVORY.b], topCenter * 3);

    const indices = [];
    for (let ri = 0; ri < ringCount - 1; ri++) {
      const a = ri * SEG;
      const b = (ri + 1) * SEG;
      for (let s = 0; s < SEG; s++) {
        const s1 = (s + 1) % SEG;
        indices.push(a + s, b + s, a + s1, a + s1, b + s, b + s1);
      }
    }
    for (let s = 0; s < SEG; s++) {
      const s1 = (s + 1) % SEG;
      indices.push(bottomCenter, s1, s);
      const top = (ringCount - 1) * SEG;
      indices.push(topCenter, top + s, top + s1);
    }

    this.geometry.setIndex(indices);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aEnergy', new THREE.BufferAttribute(energy, 1));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this.geometry.computeBoundingBox();
  }

  updateLiveRing(liveE, kind = 'quiet') {
    if (!this.live) return;
    this.liveE = liveE.slice();
    this._liveKind = kind;
    const nBeats = this.beats.length;
    const posAttr = this.geometry.getAttribute('position');
    const colAttr = this.geometry.getAttribute('color');
    const enAttr = this.geometry.getAttribute('aEnergy');
    if (!posAttr || !colAttr || !enAttr) return;

    const liveRE = [
      lerp(this._lastEma[0], liveE[0], LIVE_A),
      lerp(this._lastEma[1], liveE[1], LIVE_A),
      lerp(this._lastEma[2], liveE[2], LIVE_A),
    ];
    const scratch = {
      pos: new Float32Array(SEG * 3),
      col: new Float32Array(SEG * 3),
      energy: new Float32Array(SEG),
    };
    this._ringVertices(liveRE, (nBeats + 1) * LAYER_HEIGHT, nBeats + 1, kind, scratch);
    const offset = (nBeats + 1) * SEG;
    posAttr.array.set(scratch.pos, offset * 3);
    colAttr.array.set(scratch.col, offset * 3);
    enAttr.array.set(scratch.energy, offset);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    enAttr.needsUpdate = true;
  }

  update(timeSec) {
    this._pulse *= 0.9;
    this.auraMaterial.opacity = 0.08 + this._pulse * 0.055;
    this.mesh.scale.setScalar(1 + this._pulse * 0.012);
    this.aura.scale.setScalar(1.035 + this._pulse * 0.025);
    this.sparkleMaterial.opacity = 0.32 + this._pulse * 0.14;
    this.sparkles.scale.y = Math.max(0.2, this.height);
    this.sparkles.rotation.y = timeSec * 0.08;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.auraMaterial.dispose();
    this.sparkles.geometry.dispose();
    this.sparkleMaterial.dispose();
  }
}

export { LAYER_HEIGHT, BASE_RADIUS };
