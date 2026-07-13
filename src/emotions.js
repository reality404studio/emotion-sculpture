// 세 감정 축 (§4.1). 분류가 아니라 반사로 터지는 세 갈래.
// 원 둘레에 120°씩 배치한다. 각 감정은 서로 겹치지 않는 입력 제스처를 가진다.
//
//   index 0 · 좋아! (yes / 환희)  — 연타(rapid tap)   — 금빛  — 0°
//   index 1 · 안돼! (no / 분노)   — 한 번 탭(single)  — 빨강  — 120°
//   index 2 · 제발! (please / 긴장) — 홀드(hold)       — 파랑  — 240°

export const EMOTIONS = [
  {
    key: 'yes',
    label: '좋아!',
    hint: '연타',
    input: 'tap',
    hex: 0xf59e0b, // 금빛
    rgb: [0.96, 0.62, 0.04],
    // 넓고 둥근 융기 — 환희는 크게 부푼다
    lobeWidth: 1.05,
    lobeAmp: 1.35,
    sharpen: 1.0,
    rough: 1.0, // 연타 링은 오돌토돌
  },
  {
    key: 'no',
    label: '안돼!',
    hint: '탭',
    input: 'single',
    hex: 0xef4444, // 빨강
    rgb: [0.94, 0.27, 0.27],
    // 좁고 날카로운 융기 — 단발 스파이크
    lobeWidth: 0.42,
    lobeAmp: 1.7,
    sharpen: 1.6,
    rough: 0.15,
  },
  {
    key: 'please',
    label: '제발!',
    hint: '길게 누르기',
    input: 'hold',
    hex: 0x3b82f6, // 차가운 파랑
    rgb: [0.23, 0.51, 0.96],
    // 아주 넓고 매끄러운 팽창 — 지속되는 긴장
    lobeWidth: 1.55,
    lobeAmp: 1.15,
    sharpen: 1.0,
    rough: 0.0, // 홀드는 매끄럽게
  },
];

export const N_EMOTIONS = EMOTIONS.length; // 3

// 감정 i의 원 둘레 각도(라디안). 0번이 0°, 이후 120°씩.
export function emotionAngle(i) {
  return (i / N_EMOTIONS) * Math.PI * 2;
}

// ── 강도 다이내믹스 파라미터 (§4.2) ─────────────────────────────
// 이 수치들은 Phase 0 UX 실측으로 조정하는 대상이다.
export const DECAY = 0.94; // 매 tick 지수 감쇠 (가만히 있으면 가늘어진다)
export const BASELINE = 0.04; // 강도 바닥
export const MAX_INTENSITY = 1.0;

export const TAP_GAIN = 0.18; // 좋아! 연타: 탭마다 누적
export const SINGLE_IMPULSE = 0.9; // 안돼! 단발: 항상 강한 임펄스
export const HOLD_GAIN = 0.05; // 제발! 홀드: 누르는 동안 tick당 상승

// "빈 입력" 판정 임계 (§5.6): 세 강도가 모두 이 근처면 고요한 구간
export const QUIET_THRESHOLD = 0.12;

const clamp01 = (v) => (v < 0 ? 0 : v > MAX_INTENSITY ? MAX_INTENSITY : v);

// 매 tick 감쇠를 적용한 새 강도 배열 (순수 함수)
export function decayIntensities(intensities) {
  return intensities.map((v) => Math.max(BASELINE, v * DECAY));
}

// 세 강도의 총합(정규화) — 밝기/발광/고요 판정에 쓴다.
export function totalIntensity(e) {
  const sum = e[0] + e[1] + e[2] - 3 * BASELINE;
  return clamp01(sum / (3 * (MAX_INTENSITY - BASELINE)) * 1.6);
}

export { clamp01 };
