# Devpost Submission — DeadDrop Route

## Project Title
**DeadDrop Route** — Night Shift Courier Dispatch

## Tagline
A tactical daily spatial delivery puzzle on Reddit where players route clandestine courier packages through retro-industrial district grids before sunrise.

---

## Inspiration & Pitch

Daily spatial puzzles like *Wordle* and *Mini Motorways* proved that players love quick, satisfying daily mental rituals that they can solve in two minutes and discuss with their peers. Reddit communities are the ideal home for this: people love checking into their favorite subreddits every morning, sharing results, and comparing strategies.

We designed **DeadDrop Route** to bring a tactile, atmospheric courier dispatch puzzle directly into Reddit's feed. Wrapped in a moody 1980s retro-industrial night-shift aesthetic, players act as an anonymous urban courier navigating a 7x7 city grid to drop off three sensitive packages before running out of transit fuel.

---

## Key Features & Functionality

1. **Daily Synchronized Dispatch**:
   - Every day at 00:00:00 UTC, a fresh city sector grid unlocks globally based on elapsed UTC days: `seeds[dayIndex % 15]`.
   - Every map is mathematically pre-solved and par-calibrated at build time with an automated BFS solver.

2. **Tactical Spatial Grid Mechanics**:
   - **Depot (`HQ`)**: The dispatch hub where the courier van starts.
   - **Roadways (`·`)**: Standard transit routes costing 1 move.
   - **Buildings (`■`)**: Impassable concrete structures that block passage.
   - **Congested Choke Points (`+2`)**: Gridlocked intersections that cost 2 moves to enter.
   - **Emergency Power Relays (`⚡`)**: Generators that grant a +2 move budget bonus on first entry.
   - **Dead Drop Targets (`D1`, `D2`, `D3`)**: Three lockbox targets that can be delivered in any sequence.

3. **Par-Based 3-Star Rating**:
   - 3 Stars (`★★★`): Completed within optimal par moves.
   - 2 Stars (`★★☆`): Completed within par + 2 moves.
   - 1 Star (`★☆☆`): Completed beyond par + 2 moves.
   - 0 Stars (`☆☆☆`): Out of moves (failed run).

4. **Redis-Backed Streaks & Idempotency**:
   - Tracks consecutive daily wins in Redis. Missing a day resets the streak to 1 on the next win.
   - Protected by Redis atomic guards (`set NX`) ensuring same-day replays cannot corrupt or inflate stats.

5. **Zero-Fake-Activity Real Community Telemetry**:
   - Strictly honest community data: If today's verified completions are under 5 (`TRAFFIC_THRESHOLD`), the card displays *"Be the first to route"*.
   - Zero simulated bots or fabricated numbers are ever shown. When 5 or more couriers complete the route, real dispatch counts and heatmaps are surfaced.

6. **Native Reddit Comment Sharing (`runAs: 'USER'`)**:
   - Players can post their route summary directly to the Reddit post's comment thread with a single click.
   - Strictly user-triggered and submitted on behalf of the user (`runAs: 'USER'`).

7. **Viewport Fit & Accessibility**:
   - Engineered for zero horizontal/vertical scrolling on desktop and narrow 375px mobile screens.
   - Full keyboard controls (Arrow keys + WASD) and $\ge 44\text{px}$ touch targets for mobile accessibility.

---

## Devvit Features Used

- **Devvit Web Platform**:
  - `splash.html`: Lightweight inline view rendered directly inside the Reddit feed.
  - `game.html`: Full-screen expanded interactive view loaded via `requestExpandedMode`.
- **Serverless Hono Backend (Node.js 22)**:
  - Clean, secure REST endpoints (`GET /api/daily`, `POST /api/complete`, `POST /api/share`) running within Reddit's serverless environment.
- **Devvit Redis**:
  - Atomic streak tracking (`user:{id}:streak`, `user:{id}:lastDay`).
  - Guard keys (`user:{id}:completed:{dayIndex}`).
  - Daily counters and tile traffic hashes (`day:{dayIndex}:completions`, `day:{dayIndex}:traffic`).
- **Devvit Reddit API**:
  - Authenticated user identity detection (`context.userId`, `context.username`).
  - Comment submission on behalf of authenticated players (`reddit.submitComment({ id: postId, text, runAs: 'USER' })`).
- **Devvit Configuration (`devvit.json`)**:
  - Scoped user permissions (`permissions.reddit` with `scope: "user"` and `asUser: ["SUBMIT_COMMENT"]`).

---

## Value Proposition

- **Frictionless Engagement**: No third-party sign-ups or downloads. Runs instantly within Reddit on iOS, Android, and desktop web.
- **Authentic Social Loop**: By sharing formatted dispatch comments, players trigger natural discussions, route comparisons, and community banter directly under the post.
- **Integrity by Design**: Client actions are fully verified server-side via path replay before any stats or Redis updates are recorded.

---

## What Was Built During the Submission Period

Everything in this project was created from scratch for this hackathon:
- **Game Engine & Rules**: Pure, deterministic TypeScript game rules engine with 0 external dependencies.
- **BFS Solver & Seed Validator**: Automated breadth-first search solver verifying shortest paths and build-time solvability across 15 custom sectors.
- **Serverless Architecture**: Hono-based server with server-side run validation, Redis persistence, and comment sharing.
- **Client UI**: Complete React 19 + Tailwind CSS 4 frontend styled with a retro-industrial night-shift courier terminal theme.
- **Automated Test Suite**: 61 unit tests covering rules, solver, dates, API routes, Redis streak mechanics, and comment formatting.
- **Zero-Warning Code Quality**: Strict TypeScript compiler checks, full ESLint compliance, and zero type casting.

