// 감정 입력 (§4.2, §6) — 세 제스처가 서로 겹치지 않는다.
//   좋아! = 연타(tap)   : 탭마다 +TAP_GAIN 누적
//   안돼! = 한 번 탭     : 누르면 항상 강한 임펄스(SINGLE_IMPULSE)
//   제발! = 홀드        : 누르는 동안 tick당 +HOLD_GAIN 상승, 떼면 감쇠
//
// 라이브 강도 배열을 관리하고, tick마다 감쇠+홀드적용 후 스냅샷을 돌려준다.

import {
  decayIntensities,
  BASELINE,
  TAP_GAIN,
  SINGLE_IMPULSE,
  HOLD_GAIN,
  MAX_INTENSITY,
  clamp01,
} from './emotions.js';

// 키보드 매핑 (§6): J=좋아 연타, F=안돼, Space=제발 홀드
const KEY_MAP = { j: 0, f: 1, ' ': 2 };

export class InputController {
  constructor({ onVisualPulse } = {}) {
    this.intensities = [BASELINE, BASELINE, BASELINE];
    this.holding = false; // 제발! 홀드 상태
    this.liveKind = 'quiet';
    // 이 tick 동안 발생한 이벤트 누적(질감 kind 판정용)
    this._tapCount = 0;
    this._singleFired = false;
    this._holdVisualTimer = null;
    this._holdPulseCount = 0;
    this.onVisualPulse = onVisualPulse || (() => {});
    this.enabled = false;
    this._bound = false;
  }

  enable() {
    this.enabled = true;
    if (!this._bound) this._bind();
  }
  disable() {
    this.enabled = false;
    this.holding = false;
    this._stopHoldVisuals();
  }

  // ── 개별 감정 입력 ──
  tapYes() {
    if (!this.enabled) return;
    this.intensities[0] = clamp01(this.intensities[0] + TAP_GAIN);
    this._tapCount++;
    this.liveKind = 'tap';
    this.onVisualPulse(0);
  }
  tapNo() {
    if (!this.enabled) return;
    this.intensities[1] = SINGLE_IMPULSE; // 항상 강한 단일 스파이크
    this._singleFired = true;
    this.liveKind = 'single';
    this.onVisualPulse(1);
  }
  holdPleaseStart() {
    if (!this.enabled || this.holding) return;
    this.holding = true;
    this.liveKind = 'hold';
    this._holdPulseCount = 0;
    this.onVisualPulse(2, { holdStep: this._holdPulseCount });
    // 홀드는 결과를 기다리는 입력이 아니라, 누르는 동안 계속 재료를 밀어 올리는 입력이다.
    if (typeof window !== 'undefined') {
      this._holdVisualTimer = window.setInterval(() => {
        if (this.enabled && this.holding) {
          this._holdPulseCount++;
          this.onVisualPulse(2, { holdStep: this._holdPulseCount });
        }
      }, 320);
    }
  }
  holdPleaseEnd() {
    this.holding = false;
    this._stopHoldVisuals();
  }

  _stopHoldVisuals() {
    if (this._holdVisualTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this._holdVisualTimer);
    }
    this._holdVisualTimer = null;
  }

  // ── tick: 감쇠 → 홀드 적용 → 스냅샷 + kind ──
  tick() {
    this.intensities = decayIntensities(this.intensities);
    if (this.holding) {
      this.intensities[2] = Math.min(MAX_INTENSITY, this.intensities[2] + HOLD_GAIN);
    }

    // 지배 입력 방식 판정 (질감용). 우선순위: 연타 > 단발 > 홀드 > 고요
    let kind = 'quiet';
    if (this._tapCount > 0) kind = 'tap';
    else if (this._singleFired) kind = 'single';
    else if (this.holding) kind = 'hold';

    const snapshot = this.intensities.slice();

    // tick 이벤트 카운터 리셋
    this._tapCount = 0;
    this._singleFired = false;

    return { e: snapshot, kind };
  }

  _bind() {
    this._bound = true;
    if (typeof window === 'undefined') return; // 비브라우저(테스트) 환경 가드
    // 키보드
    window.addEventListener('keydown', (ev) => {
      const k = ev.key.toLowerCase();
      if (!(k in KEY_MAP)) return;
      if (ev.repeat && k !== 'j') return; // 홀드/단발은 repeat 무시, 연타 J도 repeat 대신 실제 키다운만
      if (ev.repeat) return;
      ev.preventDefault();
      const idx = KEY_MAP[k];
      if (idx === 0) this.tapYes();
      else if (idx === 1) this.tapNo();
      else if (idx === 2) this.holdPleaseStart();
    });
    window.addEventListener('keyup', (ev) => {
      const k = ev.key.toLowerCase();
      if (KEY_MAP[k] === 2) this.holdPleaseEnd();
    });
  }
}
