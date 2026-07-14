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
    this._unlockPromise = null;
    this._mediaBridge = null;
    this._mediaBridgeUrl = null;
    this._nextStirAt = 0;
    this._stirSeed = 0;
    this._stirSettleTimer = null;
  }

  async unlock() {
    if (typeof window === 'undefined') return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      document.documentElement.dataset.sound = 'unsupported';
      return false;
    }

    // iOS에서는 Web Audio가 running이어도 미디어 출력 세션이 잠겨 무음이 될 수 있다.
    // 실제 터치 제스처 안에서 짧은 무음 media element도 함께 재생해 출력 경로를 연다.
    this._startMediaBridge();

    // 모바일 Safari 등에서 닫힌 컨텍스트가 남으면 resume할 수 없으므로 새로 만든다.
    if (this.ctx?.state === 'closed') {
      this.ctx = null;
      this.master = null;
      this.noise = null;
    }
    if (!this.ctx) {
      try {
        this._createContext(AudioContextClass);
      } catch {
        document.documentElement.dataset.sound = 'blocked';
        return false;
      }
    }

    if (this.ctx.state === 'running') {
      try {
        this._primeContext();
      } catch {
        // 이미 running이면 무음 버퍼 준비 실패가 실제 효과음 재생을 막을 이유는 없다.
      }
      this._reportState();
      return true;
    }
    if (this._unlockPromise) return this._unlockPromise;

    // suspended뿐 아니라 WebKit의 interrupted 상태도 같은 사용자 제스처에서 복구한다.
    this._unlockPromise = (async () => {
      try {
        this._primeContext();
        if (this.ctx.state !== 'running') {
          const resumePromise = this.ctx.resume();
          // WebKit은 resume Promise가 끝나기 전에 시작된 source를 사용자 제스처로 인정한다.
          this._primeContext();
          // 일부 모바일 브라우저는 statechange 뒤에도 resume Promise를 오래 보류한다.
          // 실제 상태가 running이면 Promise 응답을 기다리지 않고 대기 중인 효과음을 재생한다.
          await Promise.race([
            Promise.resolve(resumePromise),
            this._waitForRunning(640),
          ]);
        }
        if (this.ctx.state !== 'running') await this._waitForRunning();
        this._primeContext();
        this._reportState();
        return this.ctx.state === 'running';
      } catch {
        document.documentElement.dataset.sound = 'blocked';
        return false;
      } finally {
        this._unlockPromise = null;
      }
    })();
    return this._unlockPromise;
  }

  reset() {
    this.yesStep = 0;
    this.voiceCount = 0;
    this._nextStirAt = 0;
    this._stirSeed = 0;
    this.stopStir();
  }

  // 주조실에 들어가는 첫 제스처에서 오디오가 실제로 열렸음을 알려준다.
  // 단순 무음 prime만으로는 사용자가 음소거/차단 상태를 구분할 수 없기 때문이다.
  wake() {
    this._playWhenReady(() => {
      const now = this.ctx.currentTime;
      this._tone(220, now, 0.14, 0.022, 'sine');
      this._tone(440, now + 0.055, 0.24, 0.015, 'sine');
    });
  }

  launch(emotion, detail = {}, { duration = 0.6, pan = 0 } = {}) {
    const noteStep = emotion === 0 ? this.yesStep++ : detail.holdStep || 0;
    const voice = { emotion, noteStep, id: this.voiceCount++ };
    // 첫 입력이 오디오 준비보다 빠르더라도 버리지 않고, unlock 직후 재생한다.
    this._playWhenReady(() => {
      const now = this.ctx.currentTime;
      this._pop(emotion, now, pan);
      this._whoosh(emotion, now + 0.018, duration, pan, voice.id);
    });
    return voice;
  }

  impact(emotion, voice) {
    const noteStep = voice?.noteStep || 0;
    this._playWhenReady(() => {
      const now = this.ctx.currentTime;
      this._glass(impactFrequency(emotion, noteStep), emotion, now);
      this._thump(emotion, now);
    });
  }

  releaseHold(noteStep = 0) {
    this._playWhenReady(() => {
      const now = this.ctx.currentTime;
      const base = impactFrequency(2, noteStep);
      // 손을 떼면 작은 상행 두 음으로 에너지가 잠기는 느낌을 준다.
      this._tone(base, now, 0.16, 0.018, 'sine');
      this._tone(base * 1.5, now + 0.055, 0.28, 0.014, 'sine');
    });
  }

  // 완성된 트로피를 저을 때만 나는 저강도 촉각음.
  // 속도는 밀도, 높이는 음높이, 좌우 위치는 스테레오 방향에 대응한다.
  stir({ speed = 0, pan = 0, height = 0.5, turn = false } = {}) {
    const amount = clamp(speed, 0, 1);
    if (amount < 0.1) return;
    const stereo = clamp(pan, -0.82, 0.82);
    const vertical = clamp(height, 0, 1);
    this._scheduleStirSettle(stereo, vertical);

    this._playWhenReady(() => {
      const now = this.ctx.currentTime;
      if (now < this._nextStirAt) return;
      this._nextStirAt = now + (amount > 0.62 ? 0.085 : 0.12);
      this._stirShimmer(amount, vertical, stereo, now);
      if (amount > 0.38 || turn) this._stirClinks(amount, vertical, stereo, turn, now);
    });
  }

  stopStir() {
    if (this._stirSettleTimer !== null) clearTimeout(this._stirSettleTimer);
    this._stirSettleTimer = null;
  }

  _createContext(AudioContextClass) {
    this.ctx = new AudioContextClass();
    this.master = this.ctx.createGain();
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    this.master.gain.value = coarsePointer ? 1.04 : 0.86;

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    this.master.connect(compressor).connect(this.ctx.destination);
    this.noise = this._makeNoiseBuffer();
    if (typeof this.ctx.addEventListener === 'function') {
      this.ctx.addEventListener('statechange', () => this._reportState());
    }
  }

  _playWhenReady(play) {
    if (this._ready()) {
      play();
      return;
    }
    this.unlock()
      .then((ready) => {
        if (ready) play();
      })
      .catch(() => {});
  }

  _primeContext() {
    if (!this.ctx || !this.master || typeof this.ctx.createBufferSource !== 'function') return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    source.connect(this.master);
    source.start(0);
  }

  _startMediaBridge() {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof window.Audio !== 'function') return;
    if (!this._mediaBridge) {
      try {
        const sampleRate = 8000;
        const sampleCount = 80;
        const buffer = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(buffer);
        const write = (offset, value) => {
          for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
        };
        write(0, 'RIFF');
        view.setUint32(4, 36 + sampleCount * 2, true);
        write(8, 'WAVE');
        write(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        write(36, 'data');
        view.setUint32(40, sampleCount * 2, true);
        // 완전한 0 샘플은 일부 WebKit 버전이 무음 자원으로 최적화한다.
        // ±1 PCM은 들리지 않지만 실제 미디어 스트림으로 유지된다.
        for (let i = 0; i < sampleCount; i++) view.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);

        const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
        const audio = new window.Audio(url);
        audio.loop = true;
        audio.preload = 'auto';
        audio.playsInline = true;
        audio.setAttribute('playsinline', '');
        audio.setAttribute('aria-hidden', 'true');
        audio.style.display = 'none';
        document.body?.appendChild(audio);
        this._mediaBridge = audio;
        this._mediaBridgeUrl = url;
      } catch {
        return;
      }
    }

    try {
      const playPromise = this._mediaBridge.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    } catch {
      // 브리지가 막혀도 Web Audio 자체의 resume 시도는 계속한다.
    }
  }

  _waitForRunning(timeoutMs = 320) {
    if (!this.ctx || this.ctx.state === 'running') return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.ctx?.removeEventListener?.('statechange', onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (this.ctx?.state === 'running') finish();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      this.ctx.addEventListener?.('statechange', onStateChange);
    });
  }

  _reportState() {
    if (typeof document !== 'undefined' && this.ctx) {
      document.documentElement.dataset.sound = this.ctx.state;
    }
  }

  _scheduleStirSettle(pan, height) {
    this.stopStir();
    this._stirSettleTimer = setTimeout(() => {
      this._stirSettleTimer = null;
      this._playWhenReady(() => this._stirSettle(pan, height, this.ctx.currentTime));
    }, 180);
  }

  _stirShimmer(speed, height, pan, now) {
    const duration = 0.05 + speed * 0.055;
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    source.buffer = this.noise;
    filter.type = 'bandpass';
    filter.Q.value = 3.6;
    filter.frequency.value = 1050 + height * 2600;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.0018 + speed * 0.0048, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain);
    this._route(gain, pan);
    const offset = (this._stirSeed++ * 0.137) % 1.75;
    source.start(now, offset, duration + 0.01);
  }

  _stirClinks(speed, height, pan, turn, now) {
    const base = 245 * Math.pow(2, height * 1.45);
    const count = speed > 0.82 ? 3 : speed > 0.56 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const frequency = base * (1 + i * 0.34);
      const level = (0.0028 + speed * 0.0042) / (1 + i * 0.45);
      this._tone(frequency, now + i * 0.026, 0.12 + i * 0.035, level, 'sine', pan);
    }
    if (turn) this._tone(base * 2.65, now + 0.008, 0.18, 0.0082, 'sine', pan);
  }

  _stirSettle(pan, height, now) {
    const base = 210 * Math.pow(2, height * 1.05);
    this._tone(base * 1.5, now, 0.18, 0.0034, 'sine', pan);
    this._tone(base * 2.02, now + 0.045, 0.25, 0.0023, 'sine', pan * 0.7);
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

  _tone(frequency, now, decay, level, type, pan = 0) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(gain);
    this._route(gain, pan);
    osc.start(now);
    osc.stop(now + decay + 0.02);
  }
}
