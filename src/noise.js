// 결정론적 노이즈 (§5.7) — 재현성 필수.
// beats만 있으면 화소 단위까지 동일한 조각이 재생성되어야 하므로,
// 링 생성의 어떤 무작위 요소도 Math.random()을 쓰면 안 된다.
//
// seed = hash(session.id + tickIndex + vertexIndex) 기반의 value noise.

// 문자열 → 32bit 정수 (FNV-1a)
export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 정수 → [0,1) 결정론적 난수 (integer hash, mulberry-ish 마무리)
export function hashInt(n) {
  let h = n >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 세션 시드 + tick + vertex → [-1, 1] 결정론적 값
// 표면 질감(오돌토돌한 지터)에 쓴다.
export function textureNoise(sessionSeed, tickIndex, vertexIndex) {
  const n = (sessionSeed ^ Math.imul(tickIndex + 1, 0x9e3779b1) ^ Math.imul(vertexIndex + 1, 0x85ebca6b)) >>> 0;
  return hashInt(n) * 2 - 1;
}
