// Emotion Trophy — 파일 없이 Web Audio로 만드는 유리구슬 + 핀볼 사운드.
// 시각 문법과 같은 순서로 재생한다: 버튼(pop) → 이동(whoosh) → 충돌(glass + thump).

const YES_NOTES = [523.25, 659.25, 783.99, 1046.5]; // C5 · E5 · G5 · C6
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function impactFrequency(emotion, noteStep = 0) {
  if (emotion === 0) return YES_NOTES[noteStep % YES_NOTES.length];
  if (emotion === 1) return 196;
  return 392 * Math.pow(2, Math.min(8, noteStep) / 12);
}

export class CastSound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.yesStep = 0;
    this.voiceCount = 0;
  }

  async unlock() {
    if (typeof window === 'undefined') return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      document.documentElement.dataset.sound = 'unsupported';
      return false;
    }

    if (!this.ctx) {
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.68;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      this.master.connect(compressor).connect(this.ctx.destination);
      this.noise = this._makeNoiseBuffer();
    }

    if (this.ctx.state === 'suspended') await this.ctx.resume();
    document.documentElement.dataset.sound = this.ctx.state;
    return this.ctx.state === 'running';
  }

  reset() {
    this.yesStep = 0;
    this.voiceCount = 0;
  }

  launch(emotion, detail = {}, { duration = 0.6, pan = 0 } = {}) {
    if (!this._ready()) return null;
    const noteStep = emotion === 0 ? this.yesStep++ : detail.holdStep || 0;
    const voice = { emotion, noteStep, id: this.voiceCount++ };
    const now = this.ctx.currentTime;
    this._pop(emotion, now, pan);
    this._whoosh(emotion, now + 0.018, duration, pan, voice.id);
    return voice;
  }

  impact(emotion, voice) {
    if (!this._ready()) return;
    const noteStep = voice?.noteStep || 0;
    const now = this.ctx.currentTime;
    this._glass(impactFrequency(emotion, noteStep), emotion, now);
    this._thump(emotion, now);
  }

  releaseHold(noteStep = 0) {
    if (!this._ready()) return;
    const now = this.ctx.currentTime;
    const base = impactFrequency(2, noteStep);
    // 손을 떼면 작은 상행 두 음으로 에너지가 잠기는 느낌을 준다.
    this._tone(base, now, 0.16, 0.018, 'sine');
    this._tone(base * 1.5, now + 0.055, 0.28, 0.014, 'sine');
  }

  _ready() {
    return Boolean(this.ctx && this.master && this.ctx.state === 'running');
  }

  _makeNoiseBuffer() {
    const seconds = 2;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x6d2b79f5;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  _route(node, pan = 0) {
    if (typeof this.ctx.createStereoPanner !== 'function') {
      node.connect(this.master);
      return null;
    }
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    node.connect(panner).connect(this.master);
    return panner;
  }

  _pop(emotion, now, pan) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const startHz = emotion === 2 ? 260 : emotion === 1 ? 170 : 230;
    osc.type = emotion === 1 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(startHz * 0.56, now + 0.075);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(emotion === 2 ? 0.026 : 0.052, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    this._route(gain, pan);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  _whoosh(emotion, now, duration, startPan, voiceId) {
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    source.buffer = this.noise;
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(emotion === 2 ? 760 : 980, now);
    filter.frequency.exponentialRampToValueAtTime(emotion === 1 ? 1250 : 2100, now + duration * 0.72);
    filter.frequency.exponentialRampToValueAtTime(1100, now + duration);

    const peak = emotion === 2 ? 0.012 : 0.021;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + duration * 0.28);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain);
    const panner = this._route(gain, startPan);
    if (panner) panner.pan.linearRampToValueAtTime(0, now + duration);

    const offset = (voiceId * 0.173) % 1.25;
    source.start(now, offset, duration + 0.025);
  }

  _glass(base, emotion, now) {
    const partials = emotion === 1 ? [1, 2.17, 3.41] : [1, 2.76, 5.41];
    const levels = emotion === 2 ? [0.021, 0.009, 0.004] : emotion === 1 ? [0.033, 0.013, 0.006] : [0.042, 0.018, 0.008];
    const decays = [0.5, 0.29, 0.17];
    for (let i = 0; i < partials.length; i++) {
      this._tone(base * partials[i], now + i * 0.002, decays[i], levels[i], emotion === 1 ? 'triangle' : 'sine');
    }
  }

  _thump(emotion, now) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const startHz = emotion === 1 ? 108 : 132;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.12);
    gain.gain.setValueAtTime(emotion === 2 ? 0.024 : 0.052, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  _tone(frequency, now, decay, level, type) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + decay + 0.02);
  }
}
