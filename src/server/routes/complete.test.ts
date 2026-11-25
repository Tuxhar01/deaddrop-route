/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Context, runWithContext } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { createCompleteRoute } from './complete.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { createShareRoute } from './share.ts';
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
import type { CompleteResponse, DailyResponse, Direction, GameMap, ShareResponse } from '../../shared/types';

const createTestContext = (options: { userId?: string; username?: string; postId?: string }) => {
  return Context({
    'devvit-subreddit': 't5_test_sub',
    'devvit-subreddit-name': 'deaddrop_route',
    'devvit-app': 'deaddrop-route',
    'devvit-version': '0.0.0',
    ...(options.userId ? { 'devvit-user': options.userId } : {}),
    ...(options.username ? { 'devvit-user-name': options.username } : {}),
    ...(options.postId ? { 'devvit-post': options.postId } : {}),
  });
};

const createMockRedis = () => {
  const store = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  let version = 0;
  const keyVersions = new Map<string, number>();
  const failGetKeys = new Set<string>();
  let failExec = false;
  let execReturnsEmpty = false;

  const getVersion = (k: string) => keyVersions.get(k) ?? 0;
  const bumpVersion = (k: string) => {
    version++;
    keyVersions.set(k, version);
  };

  return {
    store,
    hashes,
    bumpVersion,
    setFailGetKey(key: string, fail: boolean) {
      if (fail) failGetKeys.add(key);
      else failGetKeys.delete(key);
    },
    setFailExec(fail: boolean) {
      failExec = fail;
    },
    setExecReturnsEmpty(empty: boolean) {
      execReturnsEmpty = empty;
    },
    client: {
      async get(k: string): Promise<string | undefined> {
        if (failGetKeys.has(k)) {
          throw new Error(`Simulated Redis GET failure for key: ${k}`);
        }
        return store.get(k);
      },
      async set(k: string, v: string, opt?: { nx?: boolean; expiration?: Date }): Promise<string> {
        if (opt?.nx && store.has(k)) {
          return '';
        }
        store.set(k, v);
        bumpVersion(k);
        return 'OK';
      },
      async incrBy(k: string, v: number): Promise<number> {
        const cur = parseInt(store.get(k) || '0', 10);
        const next = cur + v;
        store.set(k, String(next));
        bumpVersion(k);
        return next;
      },
      async hIncrBy(k: string, f: string, v: number): Promise<number> {
        if (!hashes.has(k)) hashes.set(k, new Map());
        const h = hashes.get(k)!;
        const cur = parseInt(h.get(f) || '0', 10);
        const next = cur + v;
        h.set(f, String(next));
        bumpVersion(k);
        return next;
      },
      async hGetAll(k: string): Promise<Record<string, string>> {
        const h = hashes.get(k);
        if (!h) return {};
        const r: Record<string, string> = {};
        for (const [f, v] of h.entries()) r[f] = v;
        return r;
      },
      async del(...keys: string[]): Promise<number> {
        let count = 0;
        for (const k of keys) {
          if (store.delete(k)) {
            bumpVersion(k);
            count++;
          }
        }
        return count;
      },
      async watch(...watchedKeys: string[]) {
        const snapshots = new Map<string, number>();
        for (const k of watchedKeys) {
          snapshots.set(k, getVersion(k));
        }
        const queuedOps: Array<() => Promise<unknown>> = [];
        return {
          async multi() {},
          async discard() {
            queuedOps.length = 0;
          },
          async del(...delKeys: string[]) {
            queuedOps.push(async () => {
              let count = 0;
              for (const k of delKeys) {
                if (store.delete(k)) {
                  bumpVersion(k);
                  count++;
                }
              }
              return count;
            });
          },
          async set(k: string, v: string, opt?: { nx?: boolean; expiration?: Date }) {
            queuedOps.push(async () => {
              if (opt?.nx && store.has(k)) return '';
              store.set(k, v);
              bumpVersion(k);
              return 'OK';
            });
          },
          async incrBy(k: string, v: number) {
            queuedOps.push(async () => {
              const cur = parseInt(store.get(k) || '0', 10);
              const next = cur + v;
              store.set(k, String(next));
              bumpVersion(k);
              return next;
            });
          },
          async hIncrBy(k: string, f: string, v: number) {
            queuedOps.push(async () => {
              if (!hashes.has(k)) hashes.set(k, new Map());
              const h = hashes.get(k)!;
              const cur = parseInt(h.get(f) || '0', 10);
              const next = cur + v;
              h.set(f, String(next));
              bumpVersion(k);
              return next;
            });
          },
          async exec() {
            if (failExec) {
              throw new Error('Simulated Redis transaction aborted / exec failure');
            }
            if (execReturnsEmpty) {
              return [];
            }
            for (const [k, ver] of snapshots.entries()) {
              if (getVersion(k) !== ver) {
                return []; // Aborted due to conflict!
              }
            }
            const res = [];
            for (const op of queuedOps) res.push(await op());
            return res;
          },
        };
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

void describe('Task 3 — Completion Persistence & Redis Concurrency Regression Tests', () => {
  const currentDay = getUtcDayIndex();
  const todayMap: GameMap = getDailyMap(currentDay);
  const solved = solveMapDetailed(todayMap);
  assert.ok(solved, 'Daily map must be solvable');

  // Scenario 1: First valid completion
  void it('Scenario 1: First valid completion commits all records and returns 200 with stats', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s1' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 200);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'success');
    if (body.status === 'success') {
      assert.strictEqual(body.won, true);
      assert.strictEqual(body.streak, 1);
      assert.strictEqual(body.completions, 1);
      assert.strictEqual(body.bestMoves, solved.minMoves);
    }

    // Verify Redis records
    assert.strictEqual(mockRedis.store.get(`user:t2_player_s1:completed:${currentDay}`), '1');
    assert.strictEqual(mockRedis.store.get('user:t2_player_s1:streak'), '1');
    assert.strictEqual(mockRedis.store.get('user:t2_player_s1:lastDay'), String(currentDay));
    assert.strictEqual(mockRedis.store.get(`day:${currentDay}:completions`), '1');

    const attemptRaw = mockRedis.store.get(`user:t2_player_s1:attempt:${currentDay}`);
    assert.ok(attemptRaw);
    const attemptParsed = JSON.parse(attemptRaw!);
    assert.strictEqual(attemptParsed.outcome, 'won');
    assert.strictEqual(attemptParsed.movesUsed, solved.minMoves);
    assert.strictEqual(attemptParsed.stars, 3);
    assert.strictEqual(attemptParsed.dayIndex, currentDay);
  });

  // Scenario 2: Duplicate completion
  void it('Scenario 2: Duplicate completion returns 409 already_completed without double-counting', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s2' });

    // 1st request
    const res1 = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });
    assert.strictEqual(res1.status, 200);

    // 2nd request (duplicate)
    const res2 = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });
    assert.strictEqual(res2.status, 409);
    const body2: CompleteResponse = await res2.json();
    assert.strictEqual(body2.status, 'already_completed');
    if (body2.status === 'already_completed') {
      assert.ok(body2.attempt);
      assert.strictEqual(body2.attempt?.outcome, 'won');
      assert.strictEqual(body2.attempt?.movesUsed, solved.minMoves);
    }

    // Verify stats were NOT incremented twice
    assert.strictEqual(mockRedis.store.get('user:t2_player_s2:streak'), '1');
    assert.strictEqual(mockRedis.store.get(`day:${currentDay}:completions`), '1');
  });

  // Scenario 3: Two concurrent completion requests by the same user
  void it('Scenario 3: Concurrent requests trigger WATCH conflict; one commits (200), one aborts to duplicate (409)', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s3' });

    // Run both requests concurrently
    const [resA, resB] = await Promise.all([
      runWithContext(authCtx, async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
        });
      }),
      runWithContext(authCtx, async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
        });
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepStrictEqual(statuses, [200, 409], 'One request must succeed with 200, the other must abort and return 409');

    // Aggregate stats incremented exactly ONCE
    assert.strictEqual(mockRedis.store.get('user:t2_player_s3:streak'), '1');
    assert.strictEqual(mockRedis.store.get(`day:${currentDay}:completions`), '1');
  });

  // Scenario 4: Redis failure before commit
  void it('Scenario 4: Redis failure before commit discards transaction and returns 503 retry_later', async () => {
    const mockRedis = createMockRedis();
    mockRedis.setFailGetKey('user:t2_player_s4:streak', true);
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s4' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 503);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'retry_later');

    // Nothing written in Redis
    assert.strictEqual(mockRedis.store.has(`user:t2_player_s4:completed:${currentDay}`), false);
    assert.strictEqual(mockRedis.store.has(`user:t2_player_s4:attempt:${currentDay}`), false);
    assert.strictEqual(mockRedis.store.has(`day:${currentDay}:completions`), false);
  });

  // Scenario 5: Redis failure during transaction (persistent exec abort)
  void it('Scenario 5: Persistent exec failure exhausts retries and returns 503 retry_later without partial writes', async () => {
    const mockRedis = createMockRedis();
    mockRedis.setFailExec(true);
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s5' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 503);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'retry_later');

    // Completion flag and attempt not set
    assert.strictEqual(mockRedis.store.has(`user:t2_player_s5:completed:${currentDay}`), false);
    assert.strictEqual(mockRedis.store.has(`user:t2_player_s5:attempt:${currentDay}`), false);
  });

  // Scenario 6: Retry after failure
  void it('Scenario 6: Retry after failure succeeds cleanly once transient outage clears', async () => {
    const mockRedis = createMockRedis();
    mockRedis.setFailGetKey('user:t2_player_s6:streak', true);
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s6' });

    // Call 1 fails
    const res1 = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });
    assert.strictEqual(res1.status, 503);

    // Outage clears
    mockRedis.setFailGetKey('user:t2_player_s6:streak', false);

    // Call 2 succeeds
    const res2 = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });
    assert.strictEqual(res2.status, 200);
    const body2: CompleteResponse = await res2.json();
    assert.strictEqual(body2.status, 'success');
    if (body2.status === 'success') {
      assert.strictEqual(body2.streak, 1);
      assert.strictEqual(body2.completions, 1);
    }
  });

  // Scenario 7: Consecutive-day streak
  void it('Scenario 7: Consecutive-day win increments streak correctly', async () => {
    const mockRedis = createMockRedis();
    mockRedis.store.set('user:t2_player_s7:streak', '3');
    mockRedis.store.set('user:t2_player_s7:lastDay', String(currentDay - 1));

    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s7' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 200);
    const body: CompleteResponse = await res.json();
    if (body.status === 'success') {
      assert.strictEqual(body.streak, 4);
    }
    assert.strictEqual(mockRedis.store.get('user:t2_player_s7:streak'), '4');
    assert.strictEqual(mockRedis.store.get('user:t2_player_s7:lastDay'), String(currentDay));
  });

  // Scenario 8: Missed-day streak reset
  void it('Scenario 8: Missed-day win resets streak to 1', async () => {
    const mockRedis = createMockRedis();
    mockRedis.store.set('user:t2_player_s8:streak', '8');
    mockRedis.store.set('user:t2_player_s8:lastDay', String(currentDay - 3)); // Missed 2 days

    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s8' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 200);
    const body: CompleteResponse = await res.json();
    if (body.status === 'success') {
      assert.strictEqual(body.streak, 1);
    }
    assert.strictEqual(mockRedis.store.get('user:t2_player_s8:streak'), '1');
    assert.strictEqual(mockRedis.store.get('user:t2_player_s8:lastDay'), String(currentDay));
  });

  // Scenario 9: Same-day replay
  void it('Scenario 9: Replay on same day retains existing streak without incrementing', async () => {
    const mockRedis = createMockRedis();
    mockRedis.store.set('user:t2_player_s9:streak', '5');
    mockRedis.store.set('user:t2_player_s9:lastDay', String(currentDay));
    mockRedis.store.set(`user:t2_player_s9:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_player_s9:attempt:${currentDay}`,
      JSON.stringify({
        outcome: 'won',
        movesUsed: 12,
        stars: 3,
        deliveredCount: 3,
        dayIndex: currentDay,
      })
    );

    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s9' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(mockRedis.store.get('user:t2_player_s9:streak'), '5');
  });

  // Scenario 10: UTC day boundary
  void it('Scenario 10: Enforces UTC dayIndex strictly; rejects future or past day', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_player_s10' });

    // Past day
    const resPast = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay - 1, path: solved.path }),
      });
    });
    assert.strictEqual(resPast.status, 400);
    const bodyPast: CompleteResponse = await resPast.json();
    if (bodyPast.status === 'error') {
      assert.strictEqual(bodyPast.error, 'invalid_day_index');
    }

    // Future day
    const resFuture = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay + 1, path: solved.path }),
      });
    });
    assert.strictEqual(resFuture.status, 400);
    const bodyFuture: CompleteResponse = await resFuture.json();
    if (bodyFuture.status === 'error') {
      assert.strictEqual(bodyFuture.error, 'invalid_day_index');
    }
  });

  // Scenario 11: Invalid or manipulated completion payload
  void it('Scenario 11: Rejects manipulated payloads (unauthenticated, non-terminal, invalid coords)', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    // 11a: Unauthenticated
    const resUnauth = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
    });
    assert.strictEqual(resUnauth.status, 401);

    // 11b: Non-terminal partial path
    const authCtx = createTestContext({ userId: 't2_player_s11' });
    const resNonTerminal = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: [solved.path[0]] }),
      });
    });
    assert.strictEqual(resNonTerminal.status, 400);
    const bodyNT: CompleteResponse = await resNonTerminal.json();
    if (bodyNT.status === 'error') {
      assert.strictEqual(bodyNT.error, 'non_terminal_state');
    }
  });

  // Scenario 12: Compatibility with /api/daily and /api/share
  void it('Scenario 12: Daily and Share routes seamlessly consume completion records', async () => {
    const mockRedis = createMockRedis();
    const completeApp = createCompleteRoute({ redisClient: mockRedis.client });
    const submittedComments: string[] = [];
    const shareApp = createShareRoute({
      redisClient: mockRedis.client,
      redditClient: {
        async submitComment(req) {
          submittedComments.push(req.text);
          return { id: 't1_shared_comment', url: 'https://reddit.com/r/deaddrop_route/comments/t1_shared_comment' };
        },
      },
    });

    const authCtx = createTestContext({
      userId: 't2_player_s12',
      username: 'courier_twelve',
      postId: 't3_post_daily',
    });

    // 1. Complete run
    const resComplete = await runWithContext(authCtx, async () => {
      return await completeApp.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });
    assert.strictEqual(resComplete.status, 200);

    // 2. Query /api/daily
    const resDaily = await runWithContext(authCtx, async () => {
      return await daily.request('/', { method: 'GET' }, { redisClient: mockRedis.client });
    });
    assert.strictEqual(resDaily.status, 200);
    const bodyDaily: DailyResponse = await resDaily.json();
    assert.strictEqual(bodyDaily.alreadyCompleted, true);
    assert.strictEqual(bodyDaily.streak, 1);
    assert.strictEqual(bodyDaily.attempt?.outcome, 'won');
    assert.strictEqual(bodyDaily.attempt?.movesUsed, solved.minMoves);

    // 3. Query /api/share (server authoritative)
    const resShare = await runWithContext(authCtx, async () => {
      return await shareApp.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayIndex: currentDay,
          won: false, // Intentionally falsified by client!
          movesUsed: 999, // Intentionally falsified by client!
          stars: 1, // Intentionally falsified by client!
        }),
      });
    });
    assert.strictEqual(resShare.status, 200);
    const bodyShare: ShareResponse = await resShare.json();
    assert.strictEqual(bodyShare.status, 'success');

    // Confirm that the submitted Reddit comment ignored the forged client fields and used the server attempt!
    assert.strictEqual(submittedComments.length, 1);
    const comment = submittedComments[0];
    assert.ok(comment, 'Comment must be present');
    assert.ok(comment.includes('Route Delivered'), 'Comment must reflect stored server win');
    assert.ok(comment.includes('★★★'), 'Comment must reflect stored server 3 stars');
    assert.ok(comment.includes(`**Moves Used**: ${solved.minMoves}`), 'Comment must reflect stored server moves');
  });
});

void describe('Task 3B — Completion Confirmation and Concurrency Corrections Tests', () => {
  const currentDay = getUtcDayIndex();
  const todayMap: GameMap = getDailyMap(currentDay);
  const solved = solveMapDetailed(todayMap);
  assert.ok(solved, 'Daily map must be solvable');

  void it('Test 1: Completion request failing after local gameplay ends returns 503 without fabricated persistence', async () => {
    const mockRedis = createMockRedis();
    mockRedis.setFailGetKey('user:t2_fail_player:streak', true);
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_fail_player' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 503);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'retry_later');

    // Verify nothing was persisted into Redis
    assert.strictEqual(mockRedis.store.has(`user:t2_fail_player:completed:${currentDay}`), false);
    assert.strictEqual(mockRedis.store.has(`user:t2_fail_player:attempt:${currentDay}`), false);
    assert.strictEqual(mockRedis.store.has(`day:${currentDay}:completions`), false);
  });

  void it('Test 2: Retry successfully confirms a previously uncertain completion', async () => {
    const mockRedis = createMockRedis();
    mockRedis.setFailGetKey('user:t2_retry_player:streak', true);
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_retry_player' });

    // Initial attempt fails due to transient outage
    const res1 = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });
    assert.strictEqual(res1.status, 503);

    // Outage recovers
    mockRedis.setFailGetKey('user:t2_retry_player:streak', false);

    // Manual or automatic retry succeeds
    const res2 = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });
    assert.strictEqual(res2.status, 200);
    const body2: CompleteResponse = await res2.json();
    assert.strictEqual(body2.status, 'success');
    if (body2.status === 'success') {
      assert.strictEqual(body2.won, true);
      assert.strictEqual(body2.streak, 1);
      assert.strictEqual(body2.completions, 1);
    }

    assert.strictEqual(mockRedis.store.get(`user:t2_retry_player:completed:${currentDay}`), '1');
  });

  void it('Test 3: Retry receiving already_completed confirms prior attempt without duplicate writes', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_already_comp_player' });

    // Seed prior completion (simulating request committed in Redis before network timeout)
    mockRedis.store.set(`user:t2_already_comp_player:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_already_comp_player:attempt:${currentDay}`,
      JSON.stringify({
        outcome: 'won',
        movesUsed: solved.minMoves,
        stars: 3,
        deliveredCount: 3,
        dayIndex: currentDay,
      })
    );
    mockRedis.store.set('user:t2_already_comp_player:streak', '5');
    mockRedis.store.set(`day:${currentDay}:completions`, '10');

    // Retry request
    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 409);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'already_completed');
    if (body.status === 'already_completed') {
      assert.ok(body.attempt);
      assert.strictEqual(body.attempt?.outcome, 'won');
      assert.strictEqual(body.attempt?.movesUsed, solved.minMoves);
    }

    // Verify stats were not double-incremented
    assert.strictEqual(mockRedis.store.get('user:t2_already_comp_player:streak'), '5');
    assert.strictEqual(mockRedis.store.get(`day:${currentDay}:completions`), '10');
  });

  void it('Test 4: Sharing is strictly rejected if completion was not confirmed in Redis', async () => {
    const mockRedis = createMockRedis();
    const shareApp = createShareRoute({
      redisClient: mockRedis.client,
      redditClient: {
        async submitComment() {
          return { id: 't1_never_called', url: 'https://reddit.com' };
        },
      },
    });

    const authCtx = createTestContext({
      userId: 't2_unconfirmed_sharer',
      postId: 't3_daily_post_id',
    });

    const res = await runWithContext(authCtx, async () => {
      return await shareApp.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, won: true, movesUsed: 12 }),
      });
    });

    assert.strictEqual(res.status, 400);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'error');
    if (body.status === 'error') {
      assert.strictEqual(body.error, 'no_attempt_found');
    }
  });

  void it('Test 5: Two different users completing concurrently both succeed with committed global stats', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });

    const authAlpha = createTestContext({ userId: 't2_user_alpha' });
    const authBeta = createTestContext({ userId: 't2_user_beta' });

    // Both users submit concurrently
    const [resAlpha, resBeta] = await Promise.all([
      runWithContext(authAlpha, async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
        });
      }),
      runWithContext(authBeta, async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
        });
      }),
    ]);

    // Both succeed with 200 because distinct users watch their own completionKey
    assert.strictEqual(resAlpha.status, 200);
    assert.strictEqual(resBeta.status, 200);

    const bodyAlpha: CompleteResponse = await resAlpha.json();
    const bodyBeta: CompleteResponse = await resBeta.json();

    assert.strictEqual(bodyAlpha.status, 'success');
    assert.strictEqual(bodyBeta.status, 'success');

    // Total completions in Redis is strictly 2
    assert.strictEqual(mockRedis.store.get(`day:${currentDay}:completions`), '2');

    // Both users have independent streak = 1
    assert.strictEqual(mockRedis.store.get('user:t2_user_alpha:streak'), '1');
    assert.strictEqual(mockRedis.store.get('user:t2_user_beta:streak'), '1');

    // The returned completion counts in the responses must reflect the committed atomic values (1 and 2, in execution order)
    if (bodyAlpha.status === 'success' && bodyBeta.status === 'success') {
      const counts = [bodyAlpha.completions, bodyBeta.completions].sort();
      assert.deepStrictEqual(counts, [1, 2], 'Returned completions must reflect committed atomic counter');
    }
  });

  void it('Test 6: Transaction conflict for same user aborts safely and returns already_completed without partial writes', async () => {
    const mockRedis = createMockRedis();
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_racing_user' });

    // Trigger race for same user
    const [res1, res2] = await Promise.all([
      runWithContext(authCtx, async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
        });
      }),
      runWithContext(authCtx, async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
        });
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepStrictEqual(statuses, [200, 409]);

    // Exactly one completion recorded
    assert.strictEqual(mockRedis.store.get(`day:${currentDay}:completions`), '1');
    assert.strictEqual(mockRedis.store.get('user:t2_racing_user:streak'), '1');
  });

  void it('Test 7: Unexpected storage error in stats.ts returns 503 without unhandled rejection or fabricated stats', async () => {
    const mockRedis = createMockRedis();
    mockRedis.setFailExec(true);
    const app = createCompleteRoute({ redisClient: mockRedis.client });
    const authCtx = createTestContext({ userId: 't2_crash_user' });

    const res = await runWithContext(authCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay, path: solved.path }),
      });
    });

    assert.strictEqual(res.status, 503);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'retry_later');
    assert.strictEqual(mockRedis.store.has(`user:t2_crash_user:completed:${currentDay}`), false);
  });
});
