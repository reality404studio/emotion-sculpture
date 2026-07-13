// 비교 뷰용 시드 데이터 (§9) — "같은 경기, 다른 형상".
// 손으로 짠 beats 배열이면 충분. 실시간 다중접속 불필요.
//
// 같은 3분(같은 tick 수)을 서로 다르게 산다:
//   - 우리팀 팬: 골 순간 "좋아!"로 부풀고, 위기엔 "제발!"로 숨을 멈춘다.
//   - 상대팀 팬: 내가 부푼 지점이 "안돼!"로 쪼그라든다 → 뒤집힌 형상.

import { BASELINE } from './emotions.js';

const N_TICKS = 90; // 시드 조각은 짧게(빠른 렌더). 라이브는 더 길다.

// 시간축을 따라 감정 곡선을 만드는 작은 서사 엔진.
// events: { at(0..1), emo(0..2), intensity, spread } 가우시안 봉우리들.
function synth(events, kind = 'auto') {
  const beats = [];
  for (let t = 0; t < N_TICKS; t++) {
    const x = t / N_TICKS;
    const e = [BASELINE, BASELINE, BASELINE];
    for (const ev of events) {
      const d = x - ev.at;
      const g = Math.exp(-(d * d) / (2 * ev.spread * ev.spread));
      e[ev.emo] = Math.min(1, e[ev.emo] + ev.intensity * g);
    }
    // 지배 감정 → kind (질감)
    const maxi = e.indexOf(Math.max(...e));
    let k = 'quiet';
    if (Math.max(...e) > 0.15) k = maxi === 0 ? 'tap' : maxi === 1 ? 'single' : 'hold';
    beats.push({ t, e, kind: k });
  }
  return beats;
}

// 우리팀 팬: 초반 긴장(제발) → 중반 위기(제발 급상승) → 후반 골 폭발(좋아 연타)
const HOME_EVENTS = [
  { at: 0.12, emo: 2, intensity: 0.55, spread: 0.08 }, // 제발 (긴장)
  { at: 0.34, emo: 1, intensity: 0.85, spread: 0.02 }, // 안돼 (상대 위협, 날카롭게)
  { at: 0.52, emo: 2, intensity: 0.75, spread: 0.07 }, // 제발 (숨 멈춤)
  { at: 0.72, emo: 0, intensity: 0.95, spread: 0.05 }, // 좋아 (골! 폭발)
  { at: 0.88, emo: 0, intensity: 0.7, spread: 0.06 }, // 좋아 (여운)
];

// 상대팀 팬: 같은 순간을 반대로 산다. 우리가 "좋아!"인 골 순간이 저쪽엔 "안돼!".
const RIVAL_EVENTS = [
  { at: 0.12, emo: 2, intensity: 0.5, spread: 0.08 }, // 같이 긴장
  { at: 0.34, emo: 0, intensity: 0.8, spread: 0.04 }, // 저쪽 찬스 → 좋아
  { at: 0.52, emo: 2, intensity: 0.7, spread: 0.07 }, // 같이 숨 멈춤(비슷한 데는 비슷하게)
  { at: 0.72, emo: 1, intensity: 0.95, spread: 0.02 }, // 우리 골 = 저쪽 안돼 (칼날)
  { at: 0.88, emo: 1, intensity: 0.55, spread: 0.05 }, // 절망의 여운
];

export function seedSessions() {
  return [
    { id: 'seed-home', matchLabel: 'France vs Spain (SF)', side: 'FRA', label: 'Your sculpture', beats: synth(HOME_EVENTS) },
    { id: 'seed-rival', matchLabel: 'France vs Spain (SF)', side: 'ESP', label: 'Rival fan', beats: synth(RIVAL_EVENTS) },
  ];
}
