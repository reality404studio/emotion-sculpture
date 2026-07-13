// three.js 감정 조각 지오메트리 (§5) — 데모의 심장.
//
// 세로축(Y) = 경기 시간. 매 tick의 단면(ring) = 그 순간의 세 감정 강도.
// 링들이 아래에서 위로 한 켜씩 쌓여 하나의 유기적 기둥/토템이 된다.
//
// 핵심 원칙: beats만 있으면 화소까지 동일한 조각이 재생성된다(§5.7).
//   → 모든 노이즈는 결정론적(session seed + tick + vertex).

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

const SEG = 96; // 원 둘레 샘플 수 (§5.2)
const BASE_RADIUS = 1.0;
const LAYER_HEIGHT = 0.085;
const TEX_AMP = 0.09; // 연타 질감 지터 진폭
const MICRO_PULSE = 0.05; // 빈 구간 미세 맥동 (§5.6)

// 고요한 구간 색조: 차분한 청록/청색 (§5.6)
const CALM = new THREE.Color(0x1e3a5f);

// 각도 차이를 −π~π로 wrap
function wrapAngle(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 감정 i의 방사형 융기(lobe) 값 — 각도차 0에서 최대, 멀어지면 부드럽게 0 (§5.2)
function lobe(emotion, d) {
  const g = Math.exp(-(d * d) / (2 * emotion.lobeWidth * emotion.lobeWidth));
  return emotion.sharpen === 1 ? g : Math.pow(g, emotion.sharpen);
}

// 조각 빌더: rings 배열을 유지하고 tick마다 BufferGeometry를 다시 빌드한다.
// 정점 수가 작아(수천) 매 tick 리빌드해도 무방(§5.3).
export class Sculpture {
  constructor(sessionSeed) {
    this.seed = sessionSeed >>> 0;
    this.beats = []; // { t, e:[3], kind }
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.25,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.0, // 정점색에 밝기를 굽고, bloom이 발광을 담당
      side: THREE.DoubleSide,
      flatShading: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
  }

  get height() {
    return this.beats.length * LAYER_HEIGHT;
  }

  reset() {
    this.beats = [];
  }

  // 한 tick의 감정 스냅샷을 링으로 추가
  addBeat(beat) {
    this.beats.push(beat);
    this.rebuild();
  }

  // beats 전체로부터 조각을 완전히 재생성 (결정론적 재현 / 로드용)
  setBeats(beats) {
    this.beats = beats.slice();
    this.rebuild();
  }

  // 하나의 링(정점 위치 + 색) 계산
  _ringVertices(beat, y, ringIndex) {
    const e = beat.e;
    const total = totalIntensity(e);
    const quiet = e[0] < QUIET_THRESHOLD && e[1] < QUIET_THRESHOLD && e[2] < QUIET_THRESHOLD;

    // 빈 구간: baseRadius를 아주 약하게 흔드는 결정론적 미세 맥동 (§5.6)
    const micro = quiet ? MICRO_PULSE * Math.sin(ringIndex * 0.35) : 0;

    // 이 링이 얼마나 "연타(tap)"에 의한 것인가 → 질감 노이즈 강도
    const roughFactor =
      (beat.kind === 'tap' ? 1 : beat.kind === 'single' ? EMOTIONS[1].rough : 0) *
      Math.min(1, e[0] + e[1]);

    const pos = new Float32Array(SEG * 3);
    const col = new Float32Array(SEG * 3);

    for (let s = 0; s < SEG; s++) {
      const theta = (s / SEG) * Math.PI * 2;

      // ── 반지름: 방사형 lobe 합 (§5.2) ──
      let r = BASE_RADIUS + micro;
      let wSum = 0;
      let cr = 0,
        cg = 0,
        cb = 0;
      for (let i = 0; i < N_EMOTIONS; i++) {
        const d = wrapAngle(theta - emotionAngle(i));
        const l = lobe(EMOTIONS[i], d);
        r += e[i] * EMOTIONS[i].lobeAmp * l;
        // ── 색: 그 방향을 지배하는 감정의 고유색으로 공간 보간 (§5.4) ──
        // 강도가 아닌 방향(lobe)으로 가중 → 회전해서 볼 때 방향별 색이 산다.
        const w = l + 1e-3;
        wSum += w;
        cr += w * EMOTIONS[i].rgb[0];
        cg += w * EMOTIONS[i].rgb[1];
        cb += w * EMOTIONS[i].rgb[2];
      }

      // 결정론적 질감 지터 (§5.7) — 연타 링만 오돌토돌
      if (roughFactor > 0) {
        r += TEX_AMP * roughFactor * textureNoise(this.seed, ringIndex, s);
      }

      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      pos[s * 3] = x;
      pos[s * 3 + 1] = y;
      pos[s * 3 + 2] = z;

      // 방향색 정규화
      cr /= wSum;
      cg /= wSum;
      cb /= wSum;

      // 고요할수록 차분한 청색조로 물들이고, 격렬할수록 방향색 + 밝기 (§5.4/§5.6)
      const calmMix = 1 - total;
      cr = cr * (1 - calmMix) + CALM.r * calmMix;
      cg = cg * (1 - calmMix) + CALM.g * calmMix;
      cb = cb * (1 - calmMix) + CALM.b * calmMix;

      // 전체 강도를 밝기(발광)로 — bloom이 이걸 피워올린다
      const bright = 0.28 + 1.55 * total;
      col[s * 3] = Math.min(1.6, cr * bright);
      col[s * 3 + 1] = Math.min(1.6, cg * bright);
      col[s * 3 + 2] = Math.min(1.6, cb * bright);
    }

    return { pos, col };
  }

  // rings[] → BufferGeometry (로프트 §5.3)
  rebuild() {
    const nRings = this.beats.length;
    if (nRings === 0) {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      return;
    }

    const positions = new Float32Array(nRings * SEG * 3);
    const colors = new Float32Array(nRings * SEG * 3);

    for (let ri = 0; ri < nRings; ri++) {
      const y = ri * LAYER_HEIGHT;
      const { pos, col } = this._ringVertices(this.beats[ri], y, ri);
      positions.set(pos, ri * SEG * 3);
      colors.set(col, ri * SEG * 3);
    }

    // 옆면 인덱스: 연속한 두 ring의 대응 정점을 삼각형 2개씩으로 잇는다.
    const indices = [];
    for (let ri = 0; ri < nRings - 1; ri++) {
      const a = ri * SEG;
      const b = (ri + 1) * SEG;
      for (let s = 0; s < SEG; s++) {
        const s1 = (s + 1) % SEG;
        indices.push(a + s, b + s, a + s1);
        indices.push(a + s1, b + s, b + s1);
      }
    }

    this.geometry.setIndex(indices);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this.geometry.computeBoundingBox();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export { LAYER_HEIGHT, BASE_RADIUS };
