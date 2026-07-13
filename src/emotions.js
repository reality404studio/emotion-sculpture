// 세 감정 축 (§4.1). 분류가 아니라 반사로 터지는 세 갈래.
// 원 둘레에 120°씩 배치한다. 각 감정은 서로 겹치지 않는 입력 제스처를 가진다.
//
//   index 0 · 좋아! (yes / 환희)  — 연타(rapid tap)   — 금빛  — 0°
//   index 1 · 안돼! (no / 분노)   — 한 번 탭(single)  — 빨강  — 120°
//   index 2 · 제발! (please / 긴장) — 홀드(hold)       — 파랑  — 240°

export const EMOTIONS = [
  // 팔레트는 emotion-trophy-spec.md §3의 딥 램프 기준값.
  {
    key: 'yes',
    label: 'YES!',
    hint: 'rapid tap',
    input: 'tap',
    hex: 0xf5a524, // 골드 — 바깥으로 피어나는 방울
    rgb: [0.961, 0.647, 0.141],
  },
  {
    key: 'no',
    label: 'NO!',
    hint: 'tap',
    input: 'single',
    hex: 0xe4573d, // 레드 — 안으로 물리는 접힘
    rgb: [0.894, 0.341, 0.239],
  },
  {
    key: 'please',
    label: 'PLEASE!',
    hint: 'hold',
    input: 'hold',
    hex: 0x3b82f6, // 블루 — 견디는 팽창 띠
    rgb: [0.231, 0.51, 0.965],
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
