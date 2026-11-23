# DeadDrop Route

> **Night Shift Courier Dispatch** — A daily spatial routing puzzle built for Reddit via Devvit Web.

DeadDrop Route is a tactile, retro-industrial courier dispatch game running inside Reddit feeds. Every day at 00:00:00 UTC, a new city sector grid is unlocked. Players navigate a 7x7 district grid to deliver three clandestine packages to designated drop lockboxes before sunrise without exhausting their transit move budget.

---

## How to Play

1. **Start Shift**: From the splash or start screen, tap **Initialize Run** to load today's district map.
2. **Move Across the Grid**: 
   - Tap any adjacent passable tile on the board, or use **Arrow Keys / WASD** on desktop.
   - **Depot (`HQ`)**: The starting dispatch depot where your courier van begins.
   - **Roadways (`·`)**: Standard pavement costing **1 move** per step.
   - **Blocked Buildings (`■`)**: Impassable structural walls and obstacles.
   - **Congested Sectors (`+2`)**: Gridlocked intersections that cost **2 moves** to navigate.
   - **Emergency Relays (`⚡`)**: Power booster stations granting **+2 moves** upon first entry (once per relay; turns into `○` exhausted state thereafter).
   - **Dead Drops (`D1`, `D2`, `D3`)**: Three package delivery destinations. Drops can be visited in **any order**.
3. **Win Condition**: Visit all 3 drop locations before your move budget reaches 0.
4. **Loss Condition**: Your moves drop to 0 before completing all deliveries.
5. **Star Ratings**:
   - **3 Stars (`★★★`)**: Solved in $\le$ par moves.
   - **2 Stars (`★★☆`)**: Solved in $\le \text{par} + 2$ moves.
   - **1 Star (`★☆☆`)**: Solved in $> \text{par} + 2$ moves.
   - **0 Stars (`☆☆☆`)**: Run failed (out of moves).

---

## Daily UTC Map Selection

- Every puzzle is synchronized globally using whole UTC days elapsed since launch:
  $$\text{map} = \text{seeds}[\text{dayIndex} \pmod{15}]$$
- Each of the 15 pre-authored maps is validated at build time by a deterministic BFS minimum-move solver (`scripts/verify-seeds.ts`).
- Builds fail automatically if any map has disconnected drops, illegal dimensions, or a par rating deviating outside $[\text{minMoves}, \text{minMoves} + 4]$.

---

## Streaks & Real Traffic Architecture

- **Streaks**:
  - Tracked in Redis per authenticated player (`user:{id}:streak` and `user:{id}:lastDay`).
  - Completing today's run increments your active daily streak.
  - Skipping a UTC calendar day gracefully resets the streak to 1 on the next completed run.
  - Same-day plays are strictly idempotent and cannot double-increment streaks or counters.
- **Zero Fake / Simulated Activity Policy**:
  - All metrics displayed on the EndCard reflect **real Redis telemetry only**.
  - If today's verified completions are below the threshold (`TRAFFIC_THRESHOLD = 5`), the EndCard displays:
    ```
    Be the first to route
    ```
  - Zero simulated numbers, mock bots, or fabricated counts are ever injected into the user interface.
  - Once 5 or more players have completed today's route, real completion counts (`X COURIERS DISPATCHED`) and aggregated tile traffic heatmaps are displayed.

---

## Share Dispatch to Reddit Comments

- Upon finishing a run, players can share their shift report directly to the Reddit post comments.
- **Strictly User-Triggered**: Share is only executed when the player taps the **Log Route to Dispatch** button on the EndCard (never automated on completion).
- **Authenticated Submission**: Handled via `POST /api/share` calling `reddit.submitComment({ id: postId, text, runAs: 'USER' })` with `runAs: 'USER'`.
- Summarizes the shift number, delivery outcome, stars, moves used, and streak without disclosing PII or server secrets.

---

## Third-Party Disclosures & Tech Stack

- **Client**: React 19, Tailwind CSS 4, Vite 8.
- **Server**: Node.js 22 runtime, Hono 4, Devvit Web Server (`@devvit/web/server`).
- **Storage & Infrastructure**: Devvit Redis plugin (`@devvit/redis`) and Reddit API plugin (`@devvit/reddit`).
- **Typography & Icons**: System monospace font and standard UTF-8 glyphs for ultra-fast loading without heavy third-party iconography bundles.

---

## Playtest & Development Instructions

> [!WARNING]
> **DO NOT SUBMIT FOR PUBLISHING**: For hackathon evaluation and development, use `devvit playtest` on a dedicated test subreddit. Do **not** submit the app for App Review / publishing.

### Prerequisites
- Node.js `v22.x` (enforced via `.nvmrc` and `package.json` engines).
- Reddit Developer account with access to the Devvit CLI.

### Setup & Playtest
```bash
# 1. Install dependencies
npm install

# 2. Login to Reddit Devvit CLI
npm run login

# 3. Start local playtest in your test subreddit (<200 members)
npm run dev
```

### Verification Pipeline
```bash
# Run 61 automated unit tests across 14 suites
npm run test:unit

# Type check all client and server code
npm run test:types

# Run ESLint across all TypeScript sources
npm run lint

# Build seeds validation + production bundle
npm run build
```
