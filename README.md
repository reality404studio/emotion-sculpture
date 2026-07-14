# 감정 조각 · Emotion Sculpture

> Fans pour devotion — but the scoreboard only records goals.
> **The real passion lives *between* the goals.** This project gives that
> passion its first place to be recorded: on-chain, unforgeable, forever.

While you watch a 3-minute highlight, molten golden glass rises from a pedestal
and **casts a trophy in real time**. Your emotions can only touch the molten
casting front at the top — then they solidify, permanently, into the layers
below. Bottom = kickoff, rim = final whistle. When the clip ends the finished
trophy is committed to **Solana devnet** as a deterministic hash — proof that
*this* feeling was recorded at *this* moment.

Goals go on the scoreboard; passion never got a trophy. Now every fan casts
their own — and because everyone's emotional flow differs, **no two trophies
are ever the same.**

---

## Development timeline

- **Hackathon submission baseline:** commit `731cdda` and every revision before
  it are the build created for the DEV Weekend Challenge hackathon.
- **Post-hackathon polish:** revisions after `731cdda`, beginning with the
  input-to-trophy visual feedback pass, are follow-up refinements made after the
  hackathon. These changes focus on clearer visual causality, interaction feel,
  and presentation quality without redefining the original submission.

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

The vertical axis is match time. All trophies share one fixed archetype profile
`P(u)` (pedestal → stem → bowl → rim) — emotions modulate it only within
±25%, so **any input distribution still reads as a beautiful trophy**. Each
emotion is a different physical phenomenon, not a recolored button: joy blooms
*outward* as gold droplets, anger bites *inward* as one deep red crease, tension
swells as a long translucent blue band whose height is literally how long you
held your breath. **Silence is not a bug — it's rhythm:** quiet stretches stay
as clear, thin champagne glass, making the eruption that follows land harder.

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
Molten gold rises from an empty pedestal → a blue **제발!** band swells around
the stem → a red **안돼!** crease bites the bowl → gold **좋아!** droplets bloom
as you hammer the tap → the rim fills, whistle, camera pulls back: the trophy is
cast → the rival fan's trophy appears beside it — same archetype, opposite
scars → **Mint** → devnet explorer link.

---

## How I Built It

**Stack:** Vite + vanilla JS + three.js (`BufferGeometry`, `OrbitControls`,
`UnrealBloom`), `@solana/web3.js` on devnet.

**The trophy (`src/trophy.js`)** — The trophy is an accumulation of up to 150k
GPU particles over a fixed archetype profile `P(u)`. Every input *births*
particles differently: a tap splats from a single point into a gold droplet
cluster; an angry tap snaps scattered points inward into one red vertical seam;
a hold condenses a cloud into a tight blue thread — one thread per tick you
endured. Each event draws an origin→adjacent color pair from a gradient ramp,
so nothing is flat-colored. Settling, shimmer, the finish shockwave and the
mouse-stir (swirl the finished trophy and watch it scatter and re-gather) are
all computed in the vertex shader — the CPU only writes new particle
attributes at input time, so a full-spam match stays at 60 fps.

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
src/main.js           # orchestrator: scene, camera choreography, tick loop, phases, mint flow
src/emotions.js       # 3-emotion model + intensity dynamics
src/trophy.js         # trophy casting: profile loft, solidify smoothing, molten front
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
