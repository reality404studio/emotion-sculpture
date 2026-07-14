import * as THREE from 'three';

const BASE_COUNTS = { ambient: 1400, beam: 750, residue: 500, haze: 260 };

function makeRandom(seed = 0x46554e44) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const VERTEX = /* glsl */ `
  attribute float aPhase, aSize, aLayer, aDrift;
  attribute vec3 aColor;
  uniform float uTime, uImpactAge, uImpactY, uReveal, uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    float layerSpeed = aLayer < 0.5 ? 0.12 : aLayer < 1.5 ? 0.08 : 0.055;

    // 공기가 흐른다는 사실만 느껴질 정도의 느린 부유.
    pos.x += sin(uTime * layerSpeed + aPhase) * aDrift;
    pos.y += sin(uTime * layerSpeed * 0.72 + aPhase * 1.71) * aDrift * 0.48;
    pos.z += cos(uTime * layerSpeed * 0.86 + aPhase * 0.63) * aDrift * 0.65;

    // 감정 조각이 몰드에 닿으면 같은 높이의 공기가 짧게 밀려난다.
    float impactT = clamp(uImpactAge / 1.05, 0.0, 1.0);
    float impactBand = exp(-abs(pos.y - uImpactY) * 1.7);
    float impact = sin(impactT * 3.14159265) * impactBand * step(uImpactAge, 1.05);
    vec2 radial = normalize(pos.xz + vec2(0.0001));
    pos.xz += radial * impact * (0.24 + 0.12 * aLayer);
    pos.y += impact * sin(aPhase * 2.3) * 0.08;

    // 봉인 순간, 받침대를 중심으로 공기가 한 번 비워졌다 천천히 가라앉는다.
    float revealBand = exp(-max(0.0, pos.y - 0.1) * 0.28);
    pos.xz += radial * uReveal * revealBand * (0.42 + 0.1 * sin(aPhase));
    pos.y += uReveal * revealBand * (0.08 + 0.05 * sin(aPhase * 1.9));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float maxPointSize = aLayer > 2.5 ? 32.0 : 9.0;
    gl_PointSize = clamp(aSize * uPixelRatio * (8.0 / -mv.z), 0.8, maxPointSize);

    float baseAlpha = aLayer < 0.5 ? 0.095 : aLayer < 1.5 ? 0.12 : aLayer < 2.5 ? 0.08 : 0.052;
    float breathing = 0.82 + 0.18 * sin(uTime * 0.38 + aPhase * 3.1);
    float distanceFade = smoothstep(0.25, 2.4, -mv.z) * (1.0 - smoothstep(13.0, 20.0, -mv.z));
    vAlpha = baseAlpha * breathing * distanceFade;
    vColor = aColor;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = exp(-d * d * 2.5) * smoothstep(1.0, 0.32, d);
    float alpha = soft * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class FoundryAtmosphere {
  constructor({ density = 1 } = {}) {
    const quality = Math.max(0.45, Math.min(1, density));
    const ambientCount = Math.round(BASE_COUNTS.ambient * quality);
    const beamCount = Math.round(BASE_COUNTS.beam * quality);
    const residueCount = Math.round(BASE_COUNTS.residue * quality);
    const hazeCount = Math.round(BASE_COUNTS.haze * quality);
    const total = ambientCount + beamCount + residueCount + hazeCount;
    const random = makeRandom();
    const positions = new Float32Array(total * 3);
    const phases = new Float32Array(total);
    const sizes = new Float32Array(total);
    const layers = new Float32Array(total);
    const drifts = new Float32Array(total);
    const colors = new Float32Array(total * 3);
    const ambientColor = new THREE.Color(0x77746d);
    const beamColor = new THREE.Color(0xc8c1af);
    const residueColor = new THREE.Color(0x65709a);
    const hazeIvory = new THREE.Color(0x9b9588);
    const hazeBlue = new THREE.Color(0x596487);

    const write = (i, x, y, z, layer, size, drift, color) => {
      positions.set([x, y, z], i * 3);
      colors.set([color.r, color.g, color.b], i * 3);
      phases[i] = random() * Math.PI * 2;
      sizes[i] = size;
      layers[i] = layer;
      drifts[i] = drift;
    };

    let cursor = 0;
    // 전역층: 카메라가 움직일 때 가까운 입자가 조금 더 빨리 지나가 깊이를 만든다.
    for (let i = 0; i < ambientCount; i++, cursor++) {
      const x = (random() * 2 - 1) * 8.2;
      const y = 0.05 + random() * 7.1;
      const z = -5.2 + random() * 11.6;
      write(cursor, x, y, z, 0, 4.5 + random() * 6.0, 0.025 + random() * 0.065, ambientColor);
    }

    // 광선층: 좌측 상단에서 트로피 뒤로 내려오는 사선 빛 속에서만 밝아지는 먼지.
    for (let i = 0; i < beamCount; i++, cursor++) {
      const t = random();
      const spread = 0.18 + (1 - t) * 0.72;
      const x = -3.25 + t * 3.45 + (random() * 2 - 1) * spread;
      const y = 6.5 - t * 5.9 + (random() * 2 - 1) * spread * 0.72;
      const z = -2.9 + t * 2.5 + (random() * 2 - 1) * spread * 0.55;
      write(cursor, x, y, z, 1, 5.0 + random() * 7.0, 0.018 + random() * 0.045, beamColor);
    }

    // 잔여층: 받침대 가까이에는 더 무겁고 푸른 재가 낮게 머문다.
    for (let i = 0; i < residueCount; i++, cursor++) {
      const angle = random() * Math.PI * 2;
      const radius = 0.55 + Math.sqrt(random()) * 2.65;
      const x = Math.cos(angle) * radius;
      const y = 0.04 + Math.pow(random(), 2.1) * 1.35;
      const z = Math.sin(angle) * radius;
      write(cursor, x, y, z, 2, 5.2 + random() * 7.0, 0.012 + random() * 0.035, residueColor);
    }

    // 전경 아지랑이: 큰 입자를 초점 밖에 두어 화면 전체가 고르게 숨 쉬게 한다.
    // 작은 별처럼 보이지 않도록 매우 낮은 알파와 넓은 소프트 폴오프만 사용한다.
    for (let i = 0; i < hazeCount; i++, cursor++) {
      const x = (random() * 2 - 1) * 8.8;
      const y = -0.2 + random() * 7.8;
      const z = -1.0 + random() * 7.2;
      const color = random() > 0.42 ? hazeIvory : hazeBlue;
      write(cursor, x, y, z, 3, 18 + random() * 30, 0.08 + random() * 0.16, color);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
    this.geometry.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 1));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.uniforms = {
      uTime: { value: 0 },
      uImpactAge: { value: 99 },
      uImpactY: { value: 0 },
      uReveal: { value: 0 },
      uPixelRatio: { value: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.points);
    this._lastTime = 0;
    this._reveal = 0;
  }

  reset() {
    this.uniforms.uImpactAge.value = 99;
    this._reveal = 0;
    this.uniforms.uReveal.value = 0;
  }

  setPixelRatio(value) {
    this.uniforms.uPixelRatio.value = value;
  }

  impact(worldY) {
    this.uniforms.uImpactY.value = worldY;
    this.uniforms.uImpactAge.value = 0;
  }

  reveal() {
    this._reveal = 1.15;
  }

  update(timeSec) {
    const dt = Math.min(0.1, Math.max(0, timeSec - this._lastTime));
    this._lastTime = timeSec;
    this.uniforms.uTime.value = timeSec;
    this.uniforms.uImpactAge.value += dt;
    this._reveal *= Math.exp(-dt / 1.25);
    this.uniforms.uReveal.value = this._reveal;
  }
}
