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
const BASE_RADIUS = 1.12;
const ROCK_HEIGHT = 2.25;
const LAYER_HEIGHT = ROCK_HEIGHT / 30;
const EMA_A = 0.28;
const LIVE_A = 0.86;
const TEX_AMP = 0.055;
const MICRO_PULSE = 0.035;
const CORE = new THREE.Color(0x6170b6);
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
    this._impulse = 0;
    this._impulseEmotion = 0;
    this._liveRingOffset = -1;

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
    this.nerveGroup = new THREE.Group();
    this.nerveLines = [];
    this.nerveAuras = [];
    this.nerveDots = [];
    this.nerveStrengths = [];
    for (let i = 0; i < N_EMOTIONS; i++) {
      const color = EMOTIONS[i].hex;
      const line = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.84, depthWrite: false, depthTest: false, toneMapped: false, blending: THREE.NormalBlending, side: THREE.DoubleSide })
      );
      const aura = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, depthTest: false, toneMapped: false, blending: THREE.NormalBlending, side: THREE.DoubleSide })
      );
      aura.scale.set(1.18, 1, 1.18);
      this.nerveLines.push(line);
      this.nerveAuras.push(aura);
      this.nerveGroup.add(aura, line);

      const dots = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.PointsMaterial({ color, size: 0.065, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, blending: THREE.NormalBlending, sizeAttenuation: true })
      );
      this.nerveDots.push(dots);
      this.nerveGroup.add(dots);
    }

    const pulseGeometry = new THREE.TorusGeometry(0.86, 0.018, 8, 96);
    this.impulseRing = new THREE.Mesh(
      pulseGeometry,
      new THREE.MeshBasicMaterial({ color: EMOTIONS[0].hex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.NormalBlending })
    );
    this.impulseGlow = new THREE.Mesh(
      pulseGeometry,
      new THREE.MeshBasicMaterial({ color: EMOTIONS[0].hex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.NormalBlending })
    );
    this.impulseRing.rotation.x = Math.PI / 2;
    this.impulseGlow.rotation.x = Math.PI / 2;
    this.impulseRing.visible = false;
    this.impulseGlow.visible = false;

    this.group.add(this.sparkles, this.nerveGroup, this.impulseGlow, this.impulseRing);
  }

  get height() {
    return ROCK_HEIGHT;
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
    this._pulse = Math.min(1.8, this._pulse + 0.92);
    this._impulse = Math.min(1.35, this._impulse + 1.0);
    this._impulseEmotion = emotionIndex;
    this._pulseColor.copy(colorForEmotion(emotionIndex));
    this.impulseRing.material.color.copy(this._pulseColor);
    this.impulseGlow.material.color.copy(this._pulseColor);
    this.impulseRing.visible = true;
    this.impulseGlow.visible = true;
    // The upper ring is also updated here, so pointer feedback never waits for a tick.
    this.liveE[emotionIndex] = Math.min(1, this.liveE[emotionIndex] + (emotionIndex === 1 ? 0.62 : 0.34));
    if (this.live) this._rebuildNerves();
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
      const heightT = Math.max(0, Math.min(1, y / ROCK_HEIGHT));
      const bodyEnvelope = 0.60 + 0.40 * Math.sin(Math.PI * heightT);
      const slowRock =
        1 +
        0.10 * Math.sin(theta + heightT * 2.8 + this.seed * 0.00001) +
        0.065 * Math.sin(theta * 2.0 - heightT * 4.0) +
        0.035 * Math.sin(theta * 5.0 - ringIndex * 0.11);
      let r = BASE_RADIUS * bodyEnvelope * slowRock + micro + total * 0.045;
      let wSum = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (let i = 0; i < N_EMOTIONS; i++) {
        const d = wrapAngle(theta - emotionAngle(i));
        const l = lobe(EMOTIONS[i], d);
        if (i === 0) {
          // Joy blooms outward, like a bright petal opening.
          r += e[i] * 0.42 * l;
        } else if (i === 1) {
          // No is subtractive: a sharp red bite taken out of the core.
          r -= e[i] * 0.58 * l;
          r -= e[i] * 0.11 * Math.pow(l, 0.42);
        } else {
          // Please is a liquid pressure field: broad swell plus a travelling ripple.
          r += e[i] * 0.27 * l;
          r += e[i] * 0.075 * Math.sin(theta * 2.0 + ringIndex * 0.36) * l;
        }
        const w = l + 1e-3;
        wSum += w;
        cr += w * EMOTIONS[i].rgb[0];
        cg += w * EMOTIONS[i].rgb[1];
        cb += w * EMOTIONS[i].rgb[2];
      }
      if (roughFactor > 0) r += TEX_AMP * roughFactor * textureNoise(this.seed, ringIndex, s);
      r = Math.max(0.32, r);

      out.pos[s * 3] = r * Math.cos(theta);
      out.pos[s * 3 + 1] = y;
      out.pos[s * 3 + 2] = r * Math.sin(theta);

      cr /= wSum;
      cg /= wSum;
      cb /= wSum;
      // The core is cool and translucent, while active layers keep their
      // own emotion hue instead of becoming a single averaged pastel.
      const coreMix = Math.max(0.08, 0.48 - total * 0.42);
      cr = lerp(cr, CORE.r, coreMix);
      cg = lerp(cg, CORE.g, coreMix);
      cb = lerp(cb, CORE.b, coreMix);
      const bright = 0.78 + 0.72 * total;
      out.col[s * 3] = Math.min(1.45, cr * bright);
      out.col[s * 3 + 1] = Math.min(1.45, cg * bright);
      out.col[s * 3 + 2] = Math.min(1.45, cb * bright);
      out.energy[s] = total;
    }
  }

  rebuild() {
    const nBeats = this.beats.length;
    const rings = [];
    const previewCount = nBeats === 0 && this.live ? 12 : 0;
    this._liveRingOffset = -1;

    if (previewCount > 0) {
      for (let ri = 0; ri < previewCount; ri++) {
        rings.push({ e: [BASELINE, BASELINE, BASELINE], y: (ri / (previewCount - 1)) * ROCK_HEIGHT, index: ri, kind: 'quiet' });
      }
      this._liveRingOffset = previewCount;
    } else if (nBeats > 0 || this.live) {
      rings.push({ e: [BASELINE, BASELINE, BASELINE], y: 0, index: 0, kind: 'quiet' });
    }

    const ema = [BASELINE, BASELINE, BASELINE];
    for (let ri = 0; ri < nBeats; ri++) {
      const beat = this.beats[ri];
      for (let i = 0; i < N_EMOTIONS; i++) ema[i] = lerp(ema[i], beat.e[i], EMA_A);
      const y = ((ri + 1) / Math.max(1, nBeats + 1)) * ROCK_HEIGHT;
      rings.push({ e: ema.slice(), y, index: ri + 1, kind: beat.kind });
    }
    this._lastEma = ema.slice();

    if (this.live) {
      const liveRE = [
        lerp(this._lastEma[0], this.liveE[0], LIVE_A),
        lerp(this._lastEma[1], this.liveE[1], LIVE_A),
        lerp(this._lastEma[2], this.liveE[2], LIVE_A),
      ];
      const liveIndex = previewCount > 0 ? previewCount : nBeats + 1;
      this._liveRingOffset = liveIndex;
      rings.push({ e: liveRE, y: ROCK_HEIGHT, index: liveIndex, kind: this._liveKind });
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
    this._rebuildNerves();
  }

  _rebuildNerves() {
    const totalLevels = Math.max(1, this.beats.length + 1);
    for (let i = 0; i < N_EMOTIONS; i++) {
      const points = [];
      const dots = [];
      let peak = BASELINE;
      const addPoint = (e, ringIndex) => {
        const intensity = e[i];
        peak = Math.max(peak, intensity);
        const angle =
          emotionAngle(i) +
          ringIndex * (0.3 + i * 0.055) +
          Math.sin(ringIndex * 0.62 + i * 1.9) * 0.42;
        const shape = i === 0 ? intensity * 0.12 : i === 1 ? -intensity * 0.16 : intensity * 0.08;
        const radius = Math.max(0.42, BASE_RADIUS * (0.72 + intensity * 0.13) + shape);
        const y = (ringIndex / totalLevels) * ROCK_HEIGHT;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
        if (intensity > 0.11) {
          dots.push(new THREE.Vector3(Math.cos(angle) * (radius + 0.045), y, Math.sin(angle) * (radius + 0.045)));
        }
      };

      addPoint([BASELINE, BASELINE, BASELINE], 0);
      for (let ri = 0; ri < this.beats.length; ri++) addPoint(this.beats[ri].e, ri + 1);
      if (this.live) addPoint(this.liveE, this.beats.length + 1);

      const line = this.nerveLines[i];
      const aura = this.nerveAuras[i];
      const dotMesh = this.nerveDots[i];
      line.geometry.dispose();
      aura.geometry.dispose();
      dotMesh.geometry.dispose();
      const safePoints = points.length > 1 ? points : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, ROCK_HEIGHT, 0)];
      const curve = new THREE.CatmullRomCurve3(safePoints, false, 'centripetal', 0.4);
      const tube = new THREE.TubeGeometry(curve, Math.max(12, safePoints.length * 2), i === 1 ? 0.022 : 0.032, 8, false);
      const tubePositions = tube.getAttribute('position');
      for (let vi = 0; vi < tubePositions.count; vi++) {
        tubePositions.setY(vi, Math.max(0, Math.min(ROCK_HEIGHT, tubePositions.getY(vi))));
      }
      tubePositions.needsUpdate = true;
      tube.computeBoundingSphere();
      line.geometry = tube;
      aura.geometry = tube.clone();
      dotMesh.geometry = new THREE.BufferGeometry().setFromPoints(dots);
      const strength = Math.max(0, peak - BASELINE) / (1 - BASELINE);
      this.nerveStrengths[i] = strength;
      line.visible = strength > 0.06;
      aura.visible = strength > 0.06;
      dotMesh.visible = dots.length > 0;
      line.material.opacity = 0.16 + Math.min(1, strength * 1.25) * 0.5;
      aura.material.opacity = 0.04 + Math.min(1, strength * 1.25) * 0.11;
    }
  }

  updateLiveRing(liveE, kind = 'quiet') {
    if (!this.live) return;
    this.liveE = liveE.slice();
    this._liveKind = kind;
    const posAttr = this.geometry.getAttribute('position');
    const colAttr = this.geometry.getAttribute('color');
    const enAttr = this.geometry.getAttribute('aEnergy');
    if (!posAttr || !colAttr || !enAttr || this._liveRingOffset < 0) return;

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
    this._ringVertices(liveRE, ROCK_HEIGHT, this._liveRingOffset, kind, scratch);
    const offset = this._liveRingOffset * SEG;
    posAttr.array.set(scratch.pos, offset * 3);
    colAttr.array.set(scratch.col, offset * 3);
    enAttr.array.set(scratch.energy, offset);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    enAttr.needsUpdate = true;
  }

  update(timeSec) {
    this._pulse *= 0.9;
    this._impulse = Math.max(0, this._impulse - 0.055);
    this.auraMaterial.opacity = 0.08 + this._pulse * 0.055;
    this.mesh.scale.setScalar(1 + this._pulse * 0.012);
    this.aura.scale.setScalar(1.035 + this._pulse * 0.025);
    this.sparkleMaterial.opacity = 0.32 + this._pulse * 0.14;
    this.sparkles.scale.y = Math.max(0.2, this.height / 1.2);
    this.sparkles.rotation.y = timeSec * 0.08;
    this.nerveGroup.rotation.y = Math.sin(timeSec * 0.52) * 0.06;
    this.nerveGroup.rotation.z = Math.sin(timeSec * 0.34) * 0.018;
    this.nerveLines.forEach((line, i) => {
      const strength = this.nerveStrengths[i] || 0;
      const shimmer = 0.62 + 0.22 * Math.sin(timeSec * (1.4 + i * 0.2) + i);
      line.visible = strength > 0.06;
      this.nerveAuras[i].visible = strength > 0.06;
      line.material.opacity = (0.14 + strength * 0.55) * shimmer + this._pulse * 0.08;
      this.nerveAuras[i].material.opacity = 0.03 + strength * 0.11 + this._pulse * 0.04;
      this.nerveDots[i].material.opacity = 0.68 + this._pulse * 0.18;
    });

    const pulseVisible = this._impulse > 0.01;
    this.impulseRing.visible = pulseVisible;
    this.impulseGlow.visible = pulseVisible;
    if (pulseVisible) {
      const wave = 0.82 + (1.35 - this._impulse) * 1.45;
      this.impulseRing.position.y = this.height + 0.055;
      this.impulseGlow.position.y = this.height + 0.055;
      this.impulseRing.scale.set(wave, wave, wave);
      this.impulseGlow.scale.set(wave * 1.08, wave * 1.08, wave * 1.08);
      this.impulseRing.material.opacity = this._impulse * 0.88;
      this.impulseGlow.material.opacity = this._impulse * 0.22;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.auraMaterial.dispose();
    this.sparkles.geometry.dispose();
    this.sparkleMaterial.dispose();
    this.nerveLines.forEach((line) => { line.geometry.dispose(); line.material.dispose(); });
    this.nerveAuras.forEach((line) => { line.geometry.dispose(); line.material.dispose(); });
    this.nerveDots.forEach((dots) => { dots.geometry.dispose(); dots.material.dispose(); });
    this.impulseRing.geometry.dispose();
    this.impulseRing.material.dispose();
    this.impulseGlow.material.dispose();
  }
}

export { LAYER_HEIGHT, BASE_RADIUS };
