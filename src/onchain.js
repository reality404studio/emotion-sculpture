// 솔라나 연동 (§8) — 레이어드. 인터페이스 하나를 두고 구현체를 갈아끼운다.
//
//   interface OnChainAdapter {
//     commitSculpture(session): Promise<{ signature, explorerUrl, memo }>
//     mint?(session): Promise<{ mintRef }>
//   }
//
// Layer A — MockAdapter: 지갑 없이 전체 데모가 돈다(기본값).
// Layer B — DevnetMemoAdapter: 경기 종료 시 딱 한 번, sculpture hash + 참조를
//           실제 devnet Memo 프로그램에 커밋한다. explorer 링크 노출.

import { computeSculptureHash } from './session.js';

// 온체인에 남길 참조 문자열(§8 Layer B) — 위조불가한 "언제/무엇"의 증거.
async function buildMemo(session) {
  const hash = session.signatureHash || (await computeSculptureHash(session));
  session.signatureHash = hash;
  return JSON.stringify({
    app: 'emotion-sculpture',
    match: session.matchLabel,
    side: session.side,
    start: session.startedAt,
    end: session.endedAt,
    beats: session.beats.length,
    sculptureHash: hash,
  });
}

// ── Layer A: Mock ───────────────────────────────────────────────
export class MockAdapter {
  get label() {
    return 'Mock (offline)';
  }
  async commitSculpture(session) {
    const memo = await buildMemo(session);
    // 결정론적 가짜 서명(해시 기반) — 지갑 없이 흐름 확인
    const fakeSig = (session.signatureHash || '').slice(0, 88).padEnd(44, 'x');
    console.log('[MockAdapter] commit memo:', memo);
    await new Promise((r) => setTimeout(r, 500));
    return { signature: fakeSig, explorerUrl: null, memo, mock: true };
  }
  async mint(session) {
    await new Promise((r) => setTimeout(r, 400));
    return { mintRef: 'mock-cnft:' + (session.signatureHash || '').slice(0, 12) };
  }
}

// ── Layer B: Devnet Memo (실제 온체인 커밋 1회) ──────────────────
// @solana/web3.js 로 devnet에 Memo 트랜잭션을 실제로 보낸다.
// 데모용 임시 키페어를 만들고 airdrop으로 수수료를 충당한다(사용자 지갑 선택).
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export class DevnetMemoAdapter {
  constructor({ endpoint } = {}) {
    this.endpoint = endpoint || 'https://api.devnet.solana.com';
    this._web3 = null;
    this._keypair = null;
    this.onStatus = () => {};
  }
  get label() {
    return 'Solana devnet (real commit)';
  }

  async _load() {
    if (!this._web3) this._web3 = await import('@solana/web3.js');
    return this._web3;
  }

  async _ensureFunded(connection, keypair) {
    const web3 = await this._load();
    const bal = await connection.getBalance(keypair.publicKey);
    if (bal >= 1_000_000) return; // 충분(≈0.001 SOL)
    this.onStatus('Requesting devnet airdrop…');
    const sig = await connection.requestAirdrop(keypair.publicKey, web3.LAMPORTS_PER_SOL / 5);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature: sig, ...latest },
      'confirmed'
    );
  }

  async commitSculpture(session) {
    const web3 = await this._load();
    const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey } = web3;
    const connection = new Connection(this.endpoint, 'confirmed');

    // 데모용 임시 키페어 (세션당 1회 재사용)
    if (!this._keypair) this._keypair = Keypair.generate();
    const payer = this._keypair;

    this.onStatus('Connecting to devnet…');
    await this._ensureFunded(connection, payer);

    const memo = await buildMemo(session);
    this.onStatus('Signing & sending Memo transaction…');

    const ix = new TransactionInstruction({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      programId: new PublicKey(MEMO_PROGRAM_ID),
      data: new TextEncoder().encode(memo), // Buffer 없이 바이트로
    });

    const tx = new Transaction().add(ix);
    const latest = await connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = payer.publicKey;

    const signature = await web3.sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: 'confirmed',
    });

    const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
    this.onStatus('Commit complete');
    return { signature, explorerUrl, memo, mock: false, account: payer.publicKey.toBase58() };
  }
}

// 어댑터 팩토리
export function makeAdapter(kind, opts = {}) {
  return kind === 'devnet' ? new DevnetMemoAdapter(opts) : new MockAdapter();
}
