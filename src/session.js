// 데이터 모델 (§7) + 결정론적 sculpture hash + localStorage 저장/불러오기.
import { hashStr } from './noise.js';

// EmotionBeat (§7.1)
//   t: tick index
//   e: [좋아, 안돼, 제발] 강도 스냅샷 (0..1)
//   kind: 이 tick의 지배 입력 방식 (질감용) — 'tap'|'single'|'hold'|'quiet'
//
// MatchSession (§7.2)
//   id, matchLabel, side, fan, startedAt, endedAt, beats[], signatureHash?

const STORAGE_KEY = 'emotion-sculpture:last-session';

export function createSession({ matchLabel, side, fan } = {}) {
  return {
    id: cryptoId(),
    matchLabel: matchLabel || 'France vs Spain (SF)',
    side: side || 'FRA',
    fan: fan || 'anon',
    startedAt: Date.now(),
    endedAt: null,
    beats: [],
    signatureHash: null,
  };
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'sess-' + Math.floor(hashStr(String(Date.now())) ).toString(16);
}

// 세션 id → 결정론적 숫자 시드 (노이즈용)
export function sessionSeed(session) {
  return hashStr(session.id);
}

// beats를 canonical 문자열로 직렬화 (강도는 3자리 반올림 → 부동소수 안정)
function canonicalBeats(session) {
  const rows = session.beats.map((b) => {
    const e = b.e.map((v) => Math.round(v * 1000) / 1000);
    return `${b.t}|${e[0]},${e[1]},${e[2]}|${b.kind}`;
  });
  return `${session.id}\n${session.matchLabel}\n${rows.join('\n')}`;
}

// 결정론적 sculpture hash (SHA-256) — 온체인 커밋/진위 증명용 (§5.7, §8)
export async function computeSculptureHash(session) {
  const payload = canonicalBeats(session);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // 폴백: FNV 해시 (부수적 환경)
  return hashStr(payload).toString(16).padStart(8, '0');
}

export function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch (e) {
    console.warn('세션 저장 실패:', e);
    return false;
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
