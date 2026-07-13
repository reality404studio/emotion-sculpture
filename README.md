# 감정 조각 · Emotion Sculpture

> Fans pour devotion — but the scoreboard only records goals.
> **The real passion lives *between* the goals.** This project gives that
> passion its first place to be recorded: on-chain, unforgeable, forever.

A live 3D sculpture grows from the emotions a viewer pours out while watching a
3-minute sports highlight. Every tick of the match becomes a stacked ring; the
three emotions push and pull the ring's radius, color, and texture. When the
clip ends, the finished sculpture is committed to **Solana devnet** as a
deterministic hash — proof that *this* feeling was recorded at *this* moment.

Because everyone's emotional flow differs, **no two sculptures are ever the same.**

---

## Built for: DEV Weekend Challenge — Passion Edition (`#devchallenge` `#weekendchallenge`)
Targeting the **Best use of Solana** category.

### What I Built
An interactive web experience where a spectator's real-time emotions become a
one-of-a-kind 3D object, then get minted as a memory on Solana. Three emotions,
each with a *distinct, non-overlapping gesture* so you never have to learn how to
"operate" the sculpture — you just react:

| Emotion | Gesture | Meaning | Color |
|---|---|---|---|
| **좋아! (Yes)** | rapid tap (`J`) | joy / a goal | gold |
| **안돼! (No)** | single tap (`F`) | anger / a blown call | red |
| **제발! (Please)** | hold (`Space`) | tension / holding your breath | blue |

The vertical axis is match time. Each 0.7s tick stacks a new ring whose shape is
the sum of three smooth radial *lobes* (wide/round for joy, narrow/sharp for
anger, wide/smooth for tension). **Silence is not a bug — it's rhythm:** quiet
stretches render as near-perfect calm circles with a slow deterministic pulse,
making the explosion that follows land harder.

### Demo
- `npm install && npm run dev` → open `http://localhost:5173`
- Press **▶ 경기 시작**, play any 3-min highlight in the embedded panel, and
  react with `J` / `F` / `Space` (or the on-screen buttons).
- Press **끝내기** (or let 3 min elapse) → the sculpture reveals, rotate it with
  the mouse.
- **Mint your memory** → check "실제 devnet에 커밋" for a real on-chain Memo
  transaction with a live Solana Explorer link.
- **같은 경기, 다른 형상** → see a rival fan's inverted sculpture from the same match.

### The 15-second money shot (sound off, concept still reads)
Blue **제발!** swells quietly → a red **안돼!** spike snaps out → gold **좋아!**
erupts as you hammer the tap → the camera pulls back to reveal the whole totem →
the rival fan's opposite sculpture appears beside it → **Mint** → devnet
explorer link.

---

## How I Built It

**Stack:** Vite + vanilla JS + three.js (`BufferGeometry`, `OrbitControls`,
`UnrealBloom`), `@solana/web3.js` on devnet.

**The sculpture (`src/sculpture.js`)** — Each ring samples 96 points around a
circle; the radius at angle θ is `baseRadius + Σ intensity[i] · lobe_i(θ − angle_i)`
where each lobe is a wrapped Gaussian. Per-emotion lobe widths give each feeling
its own spatial grammar. **Vertex colors are assigned by *direction*, not by
averaging** — so one ring shows a gold bulge, a red blade, and a blue swell at
once, and rotating the object actually reveals new information. Overall intensity
drives brightness, and an `UnrealBloomPass` makes the fierce moments physically
glow.

**Deterministic reproduction (`src/noise.js`, `src/session.js`)** — The whole
"commit a hash on-chain to prove authenticity" claim only holds if the sculpture
is 100% reproducible from its beats. So there is **zero `Math.random()`** — all
texture jitter is a deterministic hash of `sessionSeed + tickIndex + vertexIndex`.
Verified in a headless test: same beats + same seed → byte-identical vertex
buffers (8,640 vertices), and the SHA-256 sculpture hash is stable.

**Solana, layered (`src/onchain.js`)** — A single `OnChainAdapter` interface with
two implementations. `MockAdapter` runs the entire demo with no wallet.
`DevnetMemoAdapter` generates an ephemeral keypair, airdrops devnet SOL, and
writes the sculpture hash + match reference to the **Memo program** in one real
confirmed transaction — surfacing an Explorer link. The visualization never
depends on the chain; on-chain is an optional layer on top.

### Why Solana
Each fan writes to **independent state** rather than competing for one shared
writable account. Solana can schedule transactions touching different writable
accounts in parallel, which fits a crowd-scale stream of independent fan records.
Low per-transaction fees make periodic emotional checkpoints practical, and
compressed NFTs (cNFTs) offer a path to issue large numbers of individual match
artifacts cheaply. This MVP commits a deterministic sculpture hash on devnet;
higher-frequency checkpoints and compressed minting are the production-scale
extension.

---

## Project layout
```
index.html            # video panel + emotion palette + result/compare UI
src/main.js           # orchestrator: scene, bloom, tick loop, phases, mint flow
src/emotions.js       # 3-emotion model + intensity dynamics
src/sculpture.js      # ring lofting → BufferGeometry, direction-based colors
src/input.js          # tap / single / hold gestures + keyboard
src/noise.js          # deterministic texture noise (no Math.random)
src/session.js        # data model + SHA-256 sculpture hash + localStorage
src/onchain.js        # OnChainAdapter: Mock + Devnet Memo
src/seed-data.js      # seeded rival sculpture for the compare view
```

## Notes
- Devnet airdrops are rate-limited; if a commit fails, wait and retry — the app
  surfaces the error and the Mock path always works for the core demo.
- The embedded highlight is a placeholder YouTube URL; swap it for any 3-min clip.
- Extension vision (in the pitch, not this weekend build): the same engine fits
  **concerts** even better — K-pop lightsticks already put an input device in
  every hand, and overlaying the *artist's own* emotion track makes the keepsake
  a co-authored emotional fingerprint.
