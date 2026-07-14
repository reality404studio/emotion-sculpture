import assert from 'node:assert/strict';
import { CastSound } from '../src/sound.js';

class FakeParam {
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
}

class FakeNode {
  connect(target) { return target; }
}

class FakeGain extends FakeNode {
  constructor() {
    super();
    this.gain = new FakeParam(1);
  }
}

class FakeCompressor extends FakeNode {
  constructor() {
    super();
    this.threshold = new FakeParam();
    this.knee = new FakeParam();
    this.ratio = new FakeParam();
    this.attack = new FakeParam();
    this.release = new FakeParam();
  }
}

class FakeBuffer {
  constructor(length) {
    this.data = new Float32Array(length);
  }
  getChannelData() { return this.data; }
}

class FakeSource extends FakeNode {
  start() {}
  stop() {}
}

class FakeAudioContext {
  static initialState = 'suspended';
  static instances = [];

  constructor() {
    this.state = FakeAudioContext.initialState;
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = new FakeNode();
    this.resumeCalls = 0;
    this.listeners = [];
    FakeAudioContext.instances.push(this);
  }

  createGain() { return new FakeGain(); }
  createDynamicsCompressor() { return new FakeCompressor(); }
  createBuffer(_channels, length) { return new FakeBuffer(length); }
  createBufferSource() { return new FakeSource(); }
  addEventListener(type, listener) {
    if (type === 'statechange') this.listeners.push(listener);
  }
  async resume() {
    this.resumeCalls++;
    this.state = 'running';
    this.listeners.forEach((listener) => listener());
  }
}

class TestCastSound extends CastSound {
  constructor() {
    super();
    this.played = [];
  }
  _pop(emotion) { this.played.push(`pop:${emotion}`); }
  _whoosh(emotion) { this.played.push(`whoosh:${emotion}`); }
  _glass(_frequency, emotion) { this.played.push(`glass:${emotion}`); }
  _thump(emotion) { this.played.push(`thump:${emotion}`); }
  _tone() { this.played.push('tone'); }
  _stirShimmer(speed, height, pan) { this.played.push(`shimmer:${speed}:${height}:${pan}`); }
  _stirClinks(speed, height, pan, turn) { this.played.push(`clinks:${speed}:${height}:${pan}:${turn}`); }
  _scheduleStirSettle(pan, height) { this.played.push(`settle:${pan}:${height}`); }
}

globalThis.window = { AudioContext: FakeAudioContext };
globalThis.document = { documentElement: { dataset: {} } };

const sound = new TestCastSound();
const settlePlayback = () => new Promise((resolve) => setTimeout(resolve, 0));

// 새로고침 직후: 첫 버튼 입력이 unlock보다 빨라도 사라지지 않는다.
const firstVoice = sound.launch(0);
assert.equal(firstVoice.noteStep, 0);
assert.equal(firstVoice.id, 0);
assert.ok(sound._unlockPromise);
await sound._unlockPromise;
await settlePlayback();
assert.deepEqual(sound.played, ['pop:0', 'whoosh:0']);
assert.equal(sound.ctx.state, 'running');
assert.equal(document.documentElement.dataset.sound, 'running');

// WebKit interrupted 상태도 버튼 제스처에서 resume한다.
sound.ctx.state = 'interrupted';
const interruptedContext = sound.ctx;
sound.launch(1);
await sound._unlockPromise;
await settlePlayback();
assert.equal(interruptedContext.resumeCalls, 2);
assert.deepEqual(sound.played.slice(-2), ['pop:1', 'whoosh:1']);

// 닫힌 컨텍스트는 재사용하지 않고 새 인스턴스로 교체한다.
sound.ctx.state = 'closed';
assert.equal(await sound.unlock(), true);
assert.equal(FakeAudioContext.instances.length, 2);
assert.notEqual(sound.ctx, interruptedContext);

// 다시하기 후 음계와 보이스 순번이 0부터 시작하고 첫 소리도 재생된다.
sound.reset();
sound.ctx.state = 'suspended';
const replayVoice = sound.launch(0);
await sound._unlockPromise;
await settlePlayback();
assert.equal(replayVoice.noteStep, 0);
assert.equal(replayVoice.id, 0);
assert.deepEqual(sound.played.slice(-2), ['pop:0', 'whoosh:0']);

// 시작 제스처는 잠금 해제 직후 짧은 점화음 두 음을 들려준다.
sound.played = [];
sound.ctx.state = 'suspended';
sound.wake();
await sound._unlockPromise;
await settlePlayback();
assert.deepEqual(sound.played, ['tone', 'tone']);

sound.ctx.state = 'suspended';
sound.impact(0, replayVoice);
await sound._unlockPromise;
await settlePlayback();
assert.deepEqual(sound.played.slice(-2), ['glass:0', 'thump:0']);

// 결과 트로피 사운드는 느린 커서 노이즈를 무시하고, 높이·패닝·급회전을 보존한다.
sound.played = [];
sound.ctx.state = 'running';
sound.ctx.currentTime = 1;
sound.stir({ speed: 0.05, pan: -1, height: 0.2 });
assert.deepEqual(sound.played, []);
sound.stir({ speed: 0.72, pan: 0.6, height: 0.85, turn: true });
assert.deepEqual(sound.played, [
  'settle:0.6:0.85',
  'shimmer:0.72:0.85:0.6',
  'clinks:0.72:0.85:0.6:true',
]);
sound.stir({ speed: 0.72, pan: -0.4, height: 0.25, turn: false });
assert.deepEqual(sound.played.slice(-1), ['settle:-0.4:0.25']);
sound.ctx.currentTime = 1.2;
sound.stir({ speed: 0.2, pan: -0.4, height: 0.25, turn: false });
assert.deepEqual(sound.played.slice(-2), ['settle:-0.4:0.25', 'shimmer:0.2:0.25:-0.4']);

console.log('PASS  sound unlock and result-trophy stir mapping stay deterministic');
