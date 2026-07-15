# 감정 트로피 · Emotion Trophy

> Fans pour devotion — but the scoreboard only records goals.
> **The real passion lives *between* the goals.** This project gives that
> passion its first place to be recorded: on-chain, unforgeable, forever.

While you watch a 3-minute highlight, every reaction becomes a coloured glass
bead and drops into an open trophy mould. The beads never disappear or turn
into decorative particles. Cast at any moment (or let the full mould trigger it):
the bead geometry disappears while its colour, quantity, order, and placement
are advected into internal glass ribbons. Those ribbons cool inside one calm,
fixed cast-glass trophy. The result can be committed to
**Solana devnet** as a deterministic hash — proof that *this* feeling was
recorded at *this* moment.

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

All trophies share one fixed, restrained archetype profile `P(u)` (pedestal →
stem → bowl → rim). Emotion changes the internal colour history, never the calm
outer silhouette: gold, red, and blue beads retain their insertion order from
bottom to top, while dominance remains visible through how much of each colour
was added. Beauty comes from glass transmission, thickness, refraction, and the
preserved material record—not bloom, particles, or generated complexity.

### Demo
- `npm install && npm run dev` → open `http://localhost:5173`
- Press **ENTER THE FOUNDRY**, play any 3-min highlight in the embedded panel, and
  react with `J` / `F` / `Space` (or the on-screen buttons).
- Press **CAST THE GLASS** (or fill the mould / let 3 min elapse) → the glass
  melts and cools, then rotate the finished trophy with
  the mouse.
- **Mint your memory** → check "실제 devnet에 커밋" for a real on-chain Memo
  transaction with a live Solana Explorer link.
- **같은 경기, 다른 형상** → see a rival fan's inverted sculpture from the same match.

### The 15-second money shot (sound off, concept still reads)
Gold **좋아!**, red **안돼!**, and blue **제발!** glass beads visibly drop into
the mould and accumulate → **Cast the glass** → heat removes every spherical
boundary → only their colours stretch into internal ribbons and clear gaps →
one fixed glass surface sharpens and cools → the camera pulls back on the trophy →
**Mint** → devnet explorer link.

---

## How I Built It

**Stack:** Vite + vanilla JS + three.js (`MeshPhysicalMaterial`,
`LatheGeometry`, `OrbitControls`), `@solana/web3.js` on devnet.

**The trophy (`src/trophy.js`)** — The trophy accumulates up to 48 temporary
glass-bead meshes inside an open, physically shaded mould. Each bead is exactly
one quarter of the former radius. At cast time the beads become colour seeds,
then a deterministic CPU pass stretches and curls them into a 3D ribbon field
stored in a texture atlas. A fixed `LatheGeometry` trophy shader ray-marches that
field beneath one continuous `MeshPhysicalMaterial` surface. The collection
meshes fade to zero and are hidden completely; no sphere-derived geometry exists
in the finished object. Clear gaps, bottom-to-top chronology, and relative colour
quantity remain readable without averaging the material into one flat colour.

**Deterministic reproduction (`src/noise.js`, `src/session.js`)** — The whole
"commit a hash on-chain to prove authenticity" claim only holds if the sculpture
is 100% reproducible from its beats. So there is **zero `Math.random()`** — all
placement and flow jitter are deterministic hashes of `sessionSeed + inputIndex`.
Verified in a headless test: same history + same seed → identical bead placement,
flow, and colour order; over-input stops exactly at the physical mould capacity;
and the SHA-256 sculpture hash includes the inserted-material history.

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
