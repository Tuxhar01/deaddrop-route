/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Context, runWithContext } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { createCompleteRoute } from './complete.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { daily, getDailyPayload } from './daily.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { validateRunSubmission } from '../services/validate.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap, getUtcDayIndex } from '../../shared/dates.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { solveMapDetailed } from '../../shared/solver.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getNextCoordinate, isWithinBounds } from '../../shared/rules.ts';
import type { CompleteResponse, DailyResponse, Direction, GameMap } from '../../shared/types';

const createTestContext = (options: { userId?: string; username?: string }) => {
  return Context({
    'devvit-subreddit': 't5_test_sub',
    'devvit-subreddit-name': 'deaddrop_route',
    'devvit-app': 'deaddrop-route',
    'devvit-version': '0.0.0',
    ...(options.userId ? { 'devvit-user': options.userId } : {}),
    ...(options.username ? { 'devvit-user-name': options.username } : {}),
  });
};

const createMockRedis = () => {
  const store = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();

  return {
    store,
    hashes,
    client: {
      async get(k: string): Promise<string | undefined> {
        return store.get(k);
      },
      async set(k: string, v: string, opt?: { nx?: boolean }): Promise<string> {
        if (opt?.nx && store.has(k)) {
          return '';
        }
        store.set(k, v);
        return 'OK';
      },
      async incrBy(k: string, v: number): Promise<number> {
        const cur = parseInt(store.get(k) || '0', 10);
        const next = cur + v;
        store.set(k, String(next));
        return next;
      },
      async hIncrBy(k: string, f: string, v: number): Promise<number> {
        if (!hashes.has(k)) hashes.set(k, new Map());
        const h = hashes.get(k)!;
        const cur = parseInt(h.get(f) || '0', 10);
        const next = cur + v;
        h.set(f, String(next));
        return next;
      },
      async hGetAll(k: string): Promise<Record<string, string>> {
        const h = hashes.get(k);
        if (!h) return {};
        const r: Record<string, string> = {};
        for (const [f, v] of h.entries()) r[f] = v;
        return r;
      },
    },
  };
};

void describe('POST /api/complete & Server Path Validation', () => {
  const currentDay = getUtcDayIndex();
  const todayMap: GameMap = getDailyMap(currentDay);

  void it('accepts a valid winning path and returns validated scores (case 1: valid win)', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved, 'Daily map should be solvable');

    // 1. Test direct service validation
    const directResult = validateRunSubmission({
      dayIndex: currentDay,
      path: solved.path,
    });

    assert.strictEqual(directResult.valid, true);
    assert.strictEqual(directResult.won, true);
    assert.strictEqual(directResult.lost, false);
    assert.strictEqual(directResult.deliveredCount, 3);
    assert.strictEqual(directResult.movesUsed, solved.minMoves);
    assert.strictEqual(directResult.stars, 3);

    // 2. Test HTTP route via Hono request with authenticated context & injected redis
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const res = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: currentDay,
            path: solved.path,
          }),
        });
      }
    );

    assert.strictEqual(res.status, 200);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.valid, true);
    assert.strictEqual(body.won, true);
    assert.strictEqual(body.lost, false);
    assert.strictEqual(body.movesUsed, solved.minMoves);
    assert.strictEqual(body.stars, 3);
    assert.strictEqual(body.streak, 1);

    // Verify stats written under canonical context user id
    assert.strictEqual(mockRedis.store.get(`user:t2_courier1:completed:${currentDay}`), '1');
    assert.ok(mockRedis.store.has(`user:t2_courier1:attempt:${currentDay}`));
  });

  void it('rejects step into a block tile or out of bounds (case 2: invalid step)', async () => {
    // Find an illegal move from depot (either out of bounds or into block)
    const depot = todayMap.depot;
    const directions: Direction[] = ['up', 'down', 'left', 'right'];
    let illegalDir: Direction | null = null;

    for (const dir of directions) {
      const nextCoord = getNextCoordinate(depot, dir);
      if (!isWithinBounds(nextCoord.x, nextCoord.y)) {
        illegalDir = dir;
        break;
      }
      const tile = todayMap.grid[nextCoord.y]?.[nextCoord.x];
      if (tile === 'block') {
        illegalDir = dir;
        break;
      }
    }

    const testPath: Direction[] = illegalDir ? [illegalDir] : ['up', 'up', 'up', 'up', 'up', 'up', 'up'];
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const res = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: currentDay,
            path: testPath,
          }),
        });
      }
    );

    assert.strictEqual(res.status, 400);
    const body: CompleteResponse = await res.json();
    if (body.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(body.valid, false);
    assert.ok(
      body.error === 'blocked' || body.error === 'out_of_bounds',
      `Expected 'blocked' or 'out_of_bounds', got ${body.error}`
    );
  });

  void it('rejects paths that exceed move budget (case 3: over budget / unaffordable)', async () => {
    const depot = todayMap.depot;
    let forwardDir: Direction;
    let reverseDir: Direction;

    if (depot.x + 1 < 7 && todayMap.grid[depot.y]?.[depot.x + 1] !== 'block') {
      forwardDir = 'right';
      reverseDir = 'left';
    } else if (depot.x - 1 >= 0 && todayMap.grid[depot.y]?.[depot.x - 1] !== 'block') {
      forwardDir = 'left';
      reverseDir = 'right';
    } else if (depot.y + 1 < 7 && todayMap.grid[depot.y + 1]?.[depot.x] !== 'block') {
      forwardDir = 'down';
      reverseDir = 'up';
    } else {
      forwardDir = 'up';
      reverseDir = 'down';
    }

    const budget = todayMap.initialBudget ?? todayMap.par + 4;
    const exhaustingPath: Direction[] = [];
    for (let i = 0; i < budget + 6; i++) {
      exhaustingPath.push(i % 2 === 0 ? forwardDir : reverseDir);
    }

    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const res = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: currentDay,
            path: exhaustingPath,
          }),
        });
      }
    );

    assert.strictEqual(res.status, 400);
    const body: CompleteResponse = await res.json();
    if (body.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(body.valid, false);
    assert.ok(
      body.error === 'insufficient_moves' || body.error === 'game_already_over',
      `Expected 'insufficient_moves' or 'game_already_over', got ${body.error}`
    );
  });

  void it('rejects submission for wrong dayIndex (case 4: wrong dayIndex)', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved);

    const wrongDay = currentDay + 1;
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const res = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: wrongDay,
            path: solved.path,
          }),
        });
      }
    );

    assert.strictEqual(res.status, 400);
    const body: CompleteResponse = await res.json();
    if (body.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(body.valid, false);
    assert.strictEqual(body.error, 'invalid_day_index');
  });

  void it('rejects tampered or non-terminal paths (case 5: tampered path)', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    // 5a. Empty path
    const resEmpty = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: currentDay,
            path: [],
          }),
        });
      }
    );
    assert.strictEqual(resEmpty.status, 400);
    const bodyEmpty: CompleteResponse = await resEmpty.json();
    if (bodyEmpty.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(bodyEmpty.error, 'malformed_path');

    // 5b. Invalid direction in array
    const resInvalidDir = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: currentDay,
            path: ['up', 'warp_to_exit'],
          }),
        });
      }
    );
    assert.strictEqual(resInvalidDir.status, 400);
    const bodyInvalidDir: CompleteResponse = await resInvalidDir.json();
    if (bodyInvalidDir.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(bodyInvalidDir.error, 'malformed_path');

    // 5c. Path terminates early without reaching win or loss (non-terminal state)
    const depot = todayMap.depot;
    let singleValidDir: Direction = 'right';
    for (const d of ['right', 'left', 'down', 'up'] as Direction[]) {
      const target = getNextCoordinate(depot, d);
      if (isWithinBounds(target.x, target.y) && todayMap.grid[target.y]?.[target.x] !== 'block') {
        singleValidDir = d;
        break;
      }
    }

    const resNonTerminal = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: currentDay,
            path: [singleValidDir],
          }),
        });
      }
    );
    assert.strictEqual(resNonTerminal.status, 400);
    const bodyNonTerminal: CompleteResponse = await resNonTerminal.json();
    if (bodyNonTerminal.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(bodyNonTerminal.error, 'non_terminal_state');
  });
});

void describe('Task 1B — Canonical Identity Hardening & Regression Verification', () => {
  const currentDay = getUtcDayIndex();
  const todayMap: GameMap = getDailyMap(currentDay);

  void it('Regression 1: User ID available — persists strictly under canonical user ID', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved);

    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const authCtx = createTestContext({
      userId: 't2_canonical_alpha',
      username: 'display_alpha',
    });

    // 1a. Daily retrieval uses canonical ID and returns display username
    const resDaily = await runWithContext(authCtx, async () => {
      return await daily.request('/', { method: 'GET' }, { redisClient: mockRedis.client });
    });
    assert.strictEqual(resDaily.status, 200);
    const bodyDaily: DailyResponse = await resDaily.json();
    assert.strictEqual(bodyDaily.username, 'display_alpha');
    assert.strictEqual(bodyDaily.streak, 0);
    assert.strictEqual(bodyDaily.alreadyCompleted, false);

    // 1b. Completion persists strictly under context.userId
    const resComplete = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayIndex: currentDay,
          path: solved.path,
        }),
      });
    });
    assert.strictEqual(resComplete.status, 200);

    // Verify Redis keys: stored under t2_canonical_alpha, NEVER display_alpha
    assert.strictEqual(mockRedis.store.get(`user:t2_canonical_alpha:completed:${currentDay}`), '1');
    assert.ok(mockRedis.store.has(`user:t2_canonical_alpha:attempt:${currentDay}`));
    assert.strictEqual(mockRedis.store.has(`user:display_alpha:completed:${currentDay}`), false);
    assert.strictEqual(mockRedis.store.has(`user:display_alpha:attempt:${currentDay}`), false);
  });

  void it('Regression 2: Username available but user ID missing — completion fails safely without writing stats', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved);

    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    // Seed stats under username to ensure they are NOT queried or altered
    mockRedis.store.set('user:display_only_user:streak', '7');
    mockRedis.store.set(`user:display_only_user:completed:${currentDay}`, '1');

    const usernameOnlyCtx = createTestContext({
      username: 'display_only_user',
    });

    // 2a. Daily retrieval returns public guest stats (streak 0, not completed), with display username
    const resDaily = await runWithContext(usernameOnlyCtx, async () => {
      return await daily.request('/', { method: 'GET' }, { redisClient: mockRedis.client });
    });
    assert.strictEqual(resDaily.status, 200);
    const bodyDaily: DailyResponse = await resDaily.json();
    assert.strictEqual(bodyDaily.username, 'display_only_user');
    assert.strictEqual(bodyDaily.streak, 0, 'Must NOT read stats using username fallback');
    assert.strictEqual(bodyDaily.alreadyCompleted, false, 'Must NOT read completion using username fallback');
    assert.strictEqual(bodyDaily.attempt, null);

    // 2b. Completion fails safely with HTTP 401 without writing statistics
    const resComplete = await runWithContext(usernameOnlyCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayIndex: currentDay,
          path: solved.path,
        }),
      });
    });
    assert.strictEqual(resComplete.status, 401);
    const bodyComplete: CompleteResponse = await resComplete.json();
    assert.strictEqual(bodyComplete.status, 'error');
    if (bodyComplete.status === 'error') {
      assert.strictEqual(bodyComplete.valid, false);
      assert.strictEqual(bodyComplete.error, 'unauthenticated');
      assert.ok(bodyComplete.message.includes('Authenticated Reddit user ID required'));
    }

    // Ensure no new attempts or stats were recorded under display_only_user
    assert.strictEqual(mockRedis.store.has(`user:display_only_user:attempt:${currentDay}`), false);
  });

  void it('Regression 3: Both unavailable — guest view for daily and HTTP 401 for completion', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved);

    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const anonymousCtx = createTestContext({});

    // 3a. Daily retrieval returns guest payload without username
    const resDaily = await runWithContext(anonymousCtx, async () => {
      return await daily.request('/', { method: 'GET' }, { redisClient: mockRedis.client });
    });
    assert.strictEqual(resDaily.status, 200);
    const bodyDaily: DailyResponse = await resDaily.json();
    assert.strictEqual(bodyDaily.username, undefined);
    assert.strictEqual(bodyDaily.streak, 0);
    assert.strictEqual(bodyDaily.alreadyCompleted, false);
    assert.strictEqual(bodyDaily.attempt, null);

    // 3b. Completion rejected with HTTP 401
    const resComplete = await runWithContext(anonymousCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayIndex: currentDay,
          path: solved.path,
        }),
      });
    });
    assert.strictEqual(resComplete.status, 401);
    const bodyComplete: CompleteResponse = await resComplete.json();
    assert.strictEqual(bodyComplete.status, 'error');
    if (bodyComplete.status === 'error') {
      assert.strictEqual(bodyComplete.error, 'unauthenticated');
    }
  });

  void it('Regression 4: Forged x-user-id header — ignored on both unauthenticated and authenticated requests', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved);

    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    // Seed victim records
    mockRedis.store.set('user:t2_forged_victim:streak', '15');
    mockRedis.store.set(`user:t2_forged_victim:completed:${currentDay}`, '1');

    // 4a. Unauthenticated with forged header
    const resDailyUnauth = await daily.request(
      '/',
      {
        method: 'GET',
        headers: { 'x-user-id': 't2_forged_victim' },
      },
      { redisClient: mockRedis.client }
    );
    assert.strictEqual(resDailyUnauth.status, 200);
    const bodyDailyUnauth: DailyResponse = await resDailyUnauth.json();
    assert.strictEqual(bodyDailyUnauth.streak, 0, 'Must ignore forged header on daily');
    assert.strictEqual(bodyDailyUnauth.alreadyCompleted, false);

    const resCompleteUnauth = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 't2_forged_victim',
      },
      body: JSON.stringify({
        dayIndex: currentDay,
        path: solved.path,
      }),
    });
    assert.strictEqual(resCompleteUnauth.status, 401, 'Must reject completion when unauthenticated despite header');

    // 4b. Authenticated player with forged header
    const attackerCtx = createTestContext({
      userId: 't2_attacker',
      username: 'attacker_user',
    });

    const resCompleteAuth = await runWithContext(attackerCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 't2_forged_victim',
        },
        body: JSON.stringify({
          dayIndex: currentDay,
          path: solved.path,
        }),
      });
    });
    assert.strictEqual(resCompleteAuth.status, 200);

    // Stored strictly under attacker, victim untouched
    assert.strictEqual(mockRedis.store.get(`user:t2_attacker:completed:${currentDay}`), '1');
    assert.strictEqual(mockRedis.store.get('user:t2_forged_victim:streak'), '15', 'Victim streak must remain unaltered');
  });

  void it('Regression 5: Consistent identity between daily retrieval and completion', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved);

    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const playerCtx = createTestContext({
      userId: 't2_consistent_player_99',
      username: 'consistent_player_99',
    });

    // 5a. Before completion: daily returns not completed
    const resBefore = await runWithContext(playerCtx, async () => {
      return await daily.request('/', { method: 'GET' }, { redisClient: mockRedis.client });
    });
    assert.strictEqual(resBefore.status, 200);
    const bodyBefore: DailyResponse = await resBefore.json();
    assert.strictEqual(bodyBefore.alreadyCompleted, false);
    assert.strictEqual(bodyBefore.attempt, null);
    assert.strictEqual(bodyBefore.streak, 0);

    // 5b. Submit winning completion
    const resComplete = await runWithContext(playerCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayIndex: currentDay,
          path: solved.path,
        }),
      });
    });
    assert.strictEqual(resComplete.status, 200);
    const bodyComplete: CompleteResponse = await resComplete.json();
    assert.strictEqual(bodyComplete.status, 'success');

    // 5c. After completion: daily reflects completed status and stored attempt
    const resAfter = await runWithContext(playerCtx, async () => {
      return await daily.request('/', { method: 'GET' }, { redisClient: mockRedis.client });
    });
    assert.strictEqual(resAfter.status, 200);
    const bodyAfter: DailyResponse = await resAfter.json();
    assert.strictEqual(bodyAfter.alreadyCompleted, true);
    assert.strictEqual(bodyAfter.streak, 1);
    assert.ok(bodyAfter.attempt !== null);
    assert.strictEqual(bodyAfter.attempt?.outcome, 'won');
    assert.strictEqual(bodyAfter.attempt?.movesUsed, solved.minMoves);
    assert.strictEqual(bodyAfter.username, 'consistent_player_99');

    // 5d. Calling getDailyPayload directly also confirms consistency and disallows arbitrary user override
    const payloadDirect = await runWithContext(playerCtx, async () => {
      return await getDailyPayload({ redisClient: mockRedis.client });
    });
    assert.strictEqual(payloadDirect.alreadyCompleted, true);
    assert.strictEqual(payloadDirect.streak, 1);
  });
});
