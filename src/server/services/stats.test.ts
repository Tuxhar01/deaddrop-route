/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getUserDailyStats, recordRunStats, type RedisClientLike, type TxClientLike } from './stats.ts';
import type { Coordinate } from '../../shared/types';

type MockOptions = {
  abortExecOnce?: boolean;
  abortExecAlways?: boolean;
  throwOnAbort?: boolean;
  concurrentModifier?: (store: Map<string, string>) => void;
};

const createInMemoryRedisMock = (options?: MockOptions): RedisClientLike => {
  const store = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const versions = new Map<string, number>();
  let execCount = 0;

  const getVer = (k: string) => versions.get(k) ?? 0;
  const bumpVer = (k: string) => versions.set(k, getVer(k) + 1);

  return {
    async get(key: string): Promise<string | undefined> {
      return store.get(key);
    },
    async set(
      key: string,
      value: string,
      opts?: { nx?: boolean; xx?: boolean; expiration?: Date }
    ): Promise<string> {
      if (opts?.nx && store.has(key)) {
        return '';
      }
      if (opts?.xx && !store.has(key)) {
        return '';
      }
      store.set(key, value);
      bumpVer(key);
      return 'OK';
    },
    async incrBy(key: string, value: number): Promise<number> {
      const current = parseInt(store.get(key) ?? '0', 10) || 0;
      const next = current + value;
      store.set(key, String(next));
      bumpVer(key);
      return next;
    },
    async hIncrBy(key: string, field: string, value: number): Promise<number> {
      if (!hashes.has(key)) {
        hashes.set(key, new Map());
      }
      const hash = hashes.get(key)!;
      const current = parseInt(hash.get(field) ?? '0', 10) || 0;
      const next = current + value;
      hash.set(field, String(next));
      bumpVer(key);
      return next;
    },
    async hSet(key: string, fieldOrValues: string | Record<string, string>, value?: string): Promise<number> {
      if (!hashes.has(key)) {
        hashes.set(key, new Map());
      }
      const hash = hashes.get(key)!;
      let count = 0;
      if (typeof fieldOrValues === 'object' && fieldOrValues !== null) {
        for (const [k, v] of Object.entries(fieldOrValues)) {
          hash.set(k, v);
          count++;
        }
      } else if (typeof fieldOrValues === 'string' && value !== undefined) {
        hash.set(fieldOrValues, value);
        count = 1;
      }
      bumpVer(key);
      return count;
    },
    async hGetAll(key: string): Promise<Record<string, string>> {
      const hash = hashes.get(key);
      if (!hash) return {};
      const result: Record<string, string> = {};
      for (const [k, v] of hash.entries()) {
        result[k] = v;
      }
      return result;
    },
    async watch(...keys: string[]): Promise<TxClientLike> {
      const watched = new Map<string, number>();
      for (const k of keys) {
        watched.set(k, getVer(k));
      }
      const queuedOps: Array<() => Promise<unknown>> = [];
      let multiActive = false;

      return {
        async multi() {
          multiActive = true;
        },
        async discard() {
          queuedOps.length = 0;
          watched.clear();
        },
        async set(key, value, opt) {
          queuedOps.push(async () => {
            if (opt?.nx && store.has(key)) return '';
            if (opt?.xx && !store.has(key)) return '';
            store.set(key, value);
            bumpVer(key);
            return 'OK';
          });
        },
        async incrBy(key, value) {
          queuedOps.push(async () => {
            const current = parseInt(store.get(key) ?? '0', 10) || 0;
            const next = current + value;
            store.set(key, String(next));
            bumpVer(key);
            return next;
          });
        },
        async hIncrBy(key, field, value) {
          queuedOps.push(async () => {
            if (!hashes.has(key)) {
              hashes.set(key, new Map());
            }
            const hash = hashes.get(key)!;
            const current = parseInt(hash.get(field) ?? '0', 10) || 0;
            const next = current + value;
            hash.set(field, String(next));
            bumpVer(key);
            return next;
          });
        },
        async exec() {
          if (!multiActive) throw new Error('Transaction not started');
          execCount++;

          if (options?.concurrentModifier) {
            options.concurrentModifier(store);
          }

          if (
            options?.abortExecAlways ||
            (options?.abortExecOnce && execCount === 1)
          ) {
            if (options?.throwOnAbort) {
              throw new Error('transaction aborted due to concurrent modification');
            }
            return [];
          }

          for (const [k, v] of watched) {
            if (getVer(k) !== v) {
              if (options?.throwOnAbort) {
                throw new Error('transaction aborted due to concurrent modification');
              }
              return [];
            }
          }

          const results = [];
          for (const op of queuedOps) {
            results.push(await op());
          }
          return results;
        },
      };
    },
  };
};

const dummyCoords: Coordinate[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
];

void describe('Redis Stats Persistence (src/server/services/stats.ts)', () => {
  void it('increments streak on consecutive UTC days (dayIndex - 1)', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_alpha';

    // Day 1: First win
    const day1Result = await recordRunStats(
      {
        userId,
        dayIndex: 10,
        movesUsed: 16,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(day1Result.streak, 1);
    assert.strictEqual(day1Result.bestMoves, 16);
    assert.strictEqual(day1Result.completions, 1);
    assert.strictEqual(await redisMock.get(`user:${userId}:lastDay`), '10');

    // Day 2 (Consecutive dayIndex = 11): Second win
    const day2Result = await recordRunStats(
      {
        userId,
        dayIndex: 11,
        movesUsed: 14,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(day2Result.streak, 2);
    assert.strictEqual(day2Result.bestMoves, 14);
    assert.strictEqual(day2Result.completions, 1);
    assert.strictEqual(await redisMock.get(`user:${userId}:lastDay`), '11');

    // Day 3 (Consecutive dayIndex = 12): Third win
    const day3Result = await recordRunStats(
      {
        userId,
        dayIndex: 12,
        movesUsed: 15,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(day3Result.streak, 3);
    assert.strictEqual(await redisMock.get(`user:${userId}:streak`), '3');
    assert.strictEqual(await redisMock.get(`user:${userId}:lastDay`), '12');
  });

  void it('resets streak to 1 after a missed day (< dayIndex - 1)', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_beta';

    // Pre-seed an existing 5-day streak ending at dayIndex = 20
    await redisMock.set(`user:${userId}:streak`, '5');
    await redisMock.set(`user:${userId}:lastDay`, '20');

    // Player skips dayIndex = 21 and wins on dayIndex = 22 (missed day)
    const result = await recordRunStats(
      {
        userId,
        dayIndex: 22,
        movesUsed: 18,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(result.streak, 1);
    assert.strictEqual(await redisMock.get(`user:${userId}:streak`), '1');
    assert.strictEqual(await redisMock.get(`user:${userId}:lastDay`), '22');
  });

  void it('enforces idempotency on duplicate same-day submissions (no double streak or completion increment)', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_gamma';
    const dayIndex = 5;

    // First completion today
    const firstRun = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 16,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(firstRun.streak, 1);
    assert.strictEqual(firstRun.bestMoves, 16);
    assert.strictEqual(firstRun.completions, 1);
    assert.strictEqual(firstRun.isFirstCompletionToday, true);

    // Second completion on the SAME day: improved score (14 moves)
    const secondRun = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 14,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    // Streak must NOT double-increment
    assert.strictEqual(secondRun.streak, 1);
    // Best moves must remain unchanged on duplicate submission
    assert.strictEqual(secondRun.bestMoves, 16);
    // Completions counter must NOT double-increment
    assert.strictEqual(secondRun.completions, 1);
    assert.strictEqual(secondRun.isFirstCompletionToday, false);

    // Third completion on the same day: worse score (20 moves)
    const thirdRun = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 20,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(thirdRun.streak, 1);
    assert.strictEqual(thirdRun.bestMoves, 16); // remains 16
    assert.strictEqual(thirdRun.completions, 1);
  });

  void it('records tile traffic in day:{dayIndex}:traffic hash', async () => {
    const redisMock = createInMemoryRedisMock();
    const dayIndex = 8;

    const visited: Coordinate[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 }, // re-visit
    ];

    await recordRunStats(
      {
        userId: 'courier_traffic',
        dayIndex,
        movesUsed: 12,
        won: true,
        visitedCoordinates: visited,
      },
      redisMock
    );

    const traffic = await redisMock.hGetAll(`day:${dayIndex}:traffic`);
    assert.strictEqual(traffic['0,0'], '1');
    assert.strictEqual(traffic['1,0'], '1');
    assert.strictEqual(traffic['1,1'], '1');
  });

  void it('handles unauthenticated guest runs cleanly without crashing', async () => {
    const redisMock = createInMemoryRedisMock();

    const guestResult = await recordRunStats(
      {
        userId: undefined,
        dayIndex: 3,
        movesUsed: 15,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(guestResult.streak, 0);
    assert.strictEqual(guestResult.bestMoves, null);
    assert.strictEqual(guestResult.isFirstCompletionToday, false);

    const dailyStats = await getUserDailyStats(undefined, 3, redisMock);
    assert.strictEqual(dailyStats.streak, 0);
    assert.strictEqual(dailyStats.bestMoves, null);
  });

  void it('First completion writes the attempt record and sets the completed flag', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_attempt_1';
    const dayIndex = 42;

    const res = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 15,
        won: true,
        visitedCoordinates: dummyCoords,
        stars: 3,
        deliveredCount: 3,
      },
      redisMock
    );

    assert.strictEqual(res.isFirstCompletionToday, true);
    assert.strictEqual(await redisMock.get(`user:${userId}:completed:${dayIndex}`), '1');

    const attemptRaw = await redisMock.get(`user:${userId}:attempt:${dayIndex}`);
    assert.ok(attemptRaw, 'Attempt record must be written to Redis');
    const parsed = JSON.parse(attemptRaw!);
    assert.strictEqual(parsed.outcome, 'won');
    assert.strictEqual(parsed.movesUsed, 15);
    assert.strictEqual(parsed.stars, 3);
    assert.strictEqual(parsed.deliveredCount, 3);
    assert.ok(typeof parsed.recordedAt === 'string');
  });

  void it('Second completion leaves streak, traffic, and bestMoves unchanged and returns stored attempt', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_attempt_dup';
    const dayIndex = 43;

    // Run 1: Win with 18 moves, 2 stars
    const firstRun = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 18,
        won: true,
        visitedCoordinates: [{ x: 0, y: 0 }],
        stars: 2,
        deliveredCount: 3,
      },
      redisMock
    );
    assert.strictEqual(firstRun.isFirstCompletionToday, true);
    assert.strictEqual(firstRun.streak, 1);
    assert.strictEqual(firstRun.bestMoves, 18);
    const traffic1 = await redisMock.hGetAll(`day:${dayIndex}:traffic`);
    assert.strictEqual(traffic1['0,0'], '1');

    // Run 2: Duplicate completion on same day with 12 moves, 3 stars, visiting new tile
    const secondRun = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 12,
        won: true,
        visitedCoordinates: [{ x: 5, y: 5 }],
        stars: 3,
        deliveredCount: 3,
      },
      redisMock
    );

    assert.strictEqual(secondRun.isFirstCompletionToday, false);
    assert.strictEqual(secondRun.streak, 1, 'Streak must remain unchanged');
    assert.strictEqual(secondRun.bestMoves, 18, 'Best moves must remain unchanged');
    assert.strictEqual(secondRun.completions, 1, 'Completions must remain unchanged');
    assert.ok(secondRun.attempt, 'Stored attempt must be returned');
    assert.strictEqual(secondRun.attempt?.movesUsed, 18);
    assert.strictEqual(secondRun.attempt?.stars, 2);

    const traffic2 = await redisMock.hGetAll(`day:${dayIndex}:traffic`);
    assert.strictEqual(traffic2['5,5'], undefined, 'Tile traffic must NOT be modified on duplicate run');
  });

  void it('A completed flag with no attempt record returns attempt: null and does not throw', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_legacy';
    const dayIndex = 44;

    // Pre-seed completed flag with no attempt record (older run)
    await redisMock.set(`user:${userId}:completed:${dayIndex}`, '1');
    await redisMock.set(`user:${userId}:streak`, '5');
    await redisMock.set(`user:${userId}:best:${dayIndex}`, '15');

    const result = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 10,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );

    assert.strictEqual(result.isFirstCompletionToday, false);
    assert.strictEqual(result.attempt, null);
    assert.strictEqual(result.streak, 5);
    assert.strictEqual(result.bestMoves, 15);

    // Also check getUserDailyStats
    const dailyStats = await getUserDailyStats(userId, dayIndex, redisMock);
    assert.strictEqual(dailyStats.alreadyCompleted, true);
    assert.strictEqual(dailyStats.attempt, null);
  });

  void it('GET /api/daily returns the stored attempt after a loss', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_loss_record';
    const dayIndex = 45;

    // Run loss
    const runResult = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 25,
        won: false,
        visitedCoordinates: dummyCoords,
        stars: 0,
        deliveredCount: 1,
      },
      redisMock
    );

    assert.strictEqual(runResult.isFirstCompletionToday, true);
    assert.strictEqual(runResult.attempt?.outcome, 'lost');
    assert.strictEqual(runResult.attempt?.stars, 0);
    assert.strictEqual(runResult.attempt?.movesUsed, 25);
    assert.strictEqual(runResult.attempt?.deliveredCount, 1);

    // Read back via getUserDailyStats (what GET /api/daily calls)
    const dailyStats = await getUserDailyStats(userId, dayIndex, redisMock);
    assert.strictEqual(dailyStats.alreadyCompleted, true);
    assert.ok(dailyStats.attempt !== null);
    assert.strictEqual(dailyStats.attempt?.outcome, 'lost');
    assert.strictEqual(dailyStats.attempt?.stars, 0);
    assert.strictEqual(dailyStats.attempt?.movesUsed, 25);
    assert.strictEqual(dailyStats.attempt?.deliveredCount, 1);
  });

  void it('A malformed attempt record returns attempt: null', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_malformed';
    const dayIndex = 46;

    await redisMock.set(`user:${userId}:completed:${dayIndex}`, '1');
    // Set invalid JSON
    await redisMock.set(`user:${userId}:attempt:${dayIndex}`, 'NOT_JSON{bad');

    const dailyStats1 = await getUserDailyStats(userId, dayIndex, redisMock);
    assert.strictEqual(dailyStats1.attempt, null);
    assert.strictEqual(dailyStats1.alreadyCompleted, true);

    // Set JSON missing required fields or having invalid values
    await redisMock.set(
      `user:${userId}:attempt:${dayIndex}`,
      JSON.stringify({ outcome: 'unknown', movesUsed: 'ten' })
    );

    const dailyStats2 = await getUserDailyStats(userId, dayIndex, redisMock);
    assert.strictEqual(dailyStats2.attempt, null);

    // Also verify recordRunStats duplicate check handles malformed record cleanly
    const runResult = await recordRunStats(
      {
        userId,
        dayIndex,
        movesUsed: 12,
        won: true,
        visitedCoordinates: dummyCoords,
      },
      redisMock
    );
    assert.strictEqual(runResult.isFirstCompletionToday, false);
    assert.strictEqual(runResult.attempt, null);
  });

  void it('A loss does not increase the streak', async () => {
    const redisMock = createInMemoryRedisMock();
    const userId = 'courier_streak_loss';

    // Pre-seed an active streak of 4 ending on dayIndex = 9
    await redisMock.set(`user:${userId}:streak`, '4');
    await redisMock.set(`user:${userId}:lastDay`, '9');

    // Courier loses on consecutive day 10
    const lossResult = await recordRunStats(
      {
        userId,
        dayIndex: 10,
        movesUsed: 30,
        won: false,
        visitedCoordinates: dummyCoords,
        stars: 0,
        deliveredCount: 2,
      },
      redisMock
    );

    assert.strictEqual(lossResult.isFirstCompletionToday, true);
    assert.strictEqual(lossResult.streak, 4, 'Streak must NOT increase on loss');
    assert.strictEqual(await redisMock.get(`user:${userId}:streak`), '4');
    assert.strictEqual(await redisMock.get(`user:${userId}:lastDay`), '9', 'lastDay must not advance on loss');
  });

  void describe('Atomic Daily Completion Write & Abort/Retry Scenarios', () => {
    void it('Success: every key written once, status success', async () => {
      const redisMock = createInMemoryRedisMock();
      const userId = 'courier_atomic_success';
      const dayIndex = 60;

      const res = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 13,
          won: true,
          visitedCoordinates: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
          stars: 3,
          deliveredCount: 3,
        },
        redisMock
      );

      assert.strictEqual(res.status, 'success');
      assert.strictEqual(res.isFirstCompletionToday, true);
      assert.strictEqual(res.streak, 1);
      assert.strictEqual(res.bestMoves, 13);
      assert.strictEqual(res.completions, 1);

      // Verify all keys written to Redis exactly once
      assert.strictEqual(await redisMock.get(`user:${userId}:completed:${dayIndex}`), '1');
      const rawAttempt = await redisMock.get(`user:${userId}:attempt:${dayIndex}`);
      assert.ok(rawAttempt);
      const attempt = JSON.parse(rawAttempt!);
      assert.strictEqual(attempt.outcome, 'won');
      assert.strictEqual(attempt.movesUsed, 13);
      assert.strictEqual(await redisMock.get(`user:${userId}:streak`), '1');
      assert.strictEqual(await redisMock.get(`user:${userId}:best:${dayIndex}`), '13');
      assert.strictEqual(await redisMock.get(`day:${dayIndex}:completions`), '1');
      const traffic = await redisMock.hGetAll(`day:${dayIndex}:traffic`);
      assert.strictEqual(traffic['0,0'], '1');
      assert.strictEqual(traffic['1,0'], '1');
    });

    void it('Duplicate after success: already_completed, no stat changes', async () => {
      const redisMock = createInMemoryRedisMock();
      const userId = 'courier_atomic_dup';
      const dayIndex = 61;

      // Initial success
      const run1 = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 14,
          won: true,
          visitedCoordinates: [{ x: 0, y: 0 }],
          stars: 3,
          deliveredCount: 3,
        },
        redisMock
      );
      assert.strictEqual(run1.status, 'success');
      assert.strictEqual(run1.isFirstCompletionToday, true);

      // Duplicate attempt
      const run2 = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 10,
          won: true,
          visitedCoordinates: [{ x: 2, y: 2 }],
          stars: 3,
          deliveredCount: 3,
        },
        redisMock
      );

      assert.strictEqual(run2.status, 'already_completed');
      assert.strictEqual(run2.isFirstCompletionToday, false);
      assert.strictEqual(run2.streak, 1);
      assert.strictEqual(run2.bestMoves, 14);
      assert.strictEqual(run2.completions, 1);
      assert.strictEqual(run2.attempt?.movesUsed, 14);

      // Verify Redis values unchanged
      assert.strictEqual(await redisMock.get(`user:${userId}:streak`), '1');
      assert.strictEqual(await redisMock.get(`user:${userId}:best:${dayIndex}`), '14');
      assert.strictEqual(await redisMock.get(`day:${dayIndex}:completions`), '1');
      const traffic = await redisMock.hGetAll(`day:${dayIndex}:traffic`);
      assert.strictEqual(traffic['2,2'], undefined);
    });

    void it('Abort via empty array: re-read path returns 409 when flag exists', async () => {
      const userId = 'courier_abort_empty';
      const dayIndex = 62;

      // Mock that aborts exec with empty array, but simulates that another worker set the flag
      const redisMock = createInMemoryRedisMock({
        abortExecOnce: true,
        throwOnAbort: false,
        concurrentModifier: (store) => {
          store.set(`user:${userId}:completed:${dayIndex}`, '1');
          store.set(
            `user:${userId}:attempt:${dayIndex}`,
            JSON.stringify({ outcome: 'won', movesUsed: 15, stars: 2, deliveredCount: 3 })
          );
        },
      });

      const res = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 12,
          won: true,
          visitedCoordinates: [{ x: 0, y: 0 }],
        },
        redisMock
      );

      assert.strictEqual(res.status, 'already_completed');
      assert.strictEqual(res.isFirstCompletionToday, false);
      assert.strictEqual(res.attempt?.movesUsed, 15);
      assert.strictEqual(res.attempt?.stars, 2);
    });

    void it('Abort via thrown error: same handling as empty array', async () => {
      const userId = 'courier_abort_throw';
      const dayIndex = 63;

      // Mock that throws on abort, but concurrent worker set the flag
      const redisMock = createInMemoryRedisMock({
        abortExecOnce: true,
        throwOnAbort: true,
        concurrentModifier: (store) => {
          store.set(`user:${userId}:completed:${dayIndex}`, '1');
          store.set(
            `user:${userId}:attempt:${dayIndex}`,
            JSON.stringify({ outcome: 'lost', movesUsed: 22, stars: 0, deliveredCount: 1 })
          );
        },
      });

      const res = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 11,
          won: true,
          visitedCoordinates: [{ x: 0, y: 0 }],
        },
        redisMock
      );

      assert.strictEqual(res.status, 'already_completed');
      assert.strictEqual(res.isFirstCompletionToday, false);
      assert.strictEqual(res.attempt?.outcome, 'lost');
      assert.strictEqual(res.attempt?.movesUsed, 22);
    });

    void it('Retry succeeds after one abort: each stat counted once', async () => {
      const userId = 'courier_retry_success';
      const dayIndex = 64;

      // Abort once without setting the flag in store, so retry attempt 2 proceeds and succeeds
      const redisMock = createInMemoryRedisMock({
        abortExecOnce: true,
        throwOnAbort: false,
      });

      const res = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 14,
          won: true,
          visitedCoordinates: [{ x: 0, y: 0 }],
          stars: 3,
          deliveredCount: 3,
        },
        redisMock
      );

      assert.strictEqual(res.status, 'success');
      assert.strictEqual(res.isFirstCompletionToday, true);
      assert.strictEqual(res.streak, 1);
      assert.strictEqual(res.completions, 1);
      assert.strictEqual(res.bestMoves, 14);

      // Verify stats incremented exactly once in Redis
      assert.strictEqual(await redisMock.get(`user:${userId}:streak`), '1');
      assert.strictEqual(await redisMock.get(`day:${dayIndex}:completions`), '1');
      assert.strictEqual(await redisMock.get(`user:${userId}:completed:${dayIndex}`), '1');
    });

    void it('Retry aborts twice: 503 retry_later, no stat changes', async () => {
      const userId = 'courier_retry_fail';
      const dayIndex = 65;

      // Abort always without flag being set
      const redisMock = createInMemoryRedisMock({
        abortExecAlways: true,
        throwOnAbort: true,
      });

      const res = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 13,
          won: true,
          visitedCoordinates: [{ x: 0, y: 0 }],
          stars: 3,
          deliveredCount: 3,
        },
        redisMock
      );

      assert.strictEqual(res.status, 'retry_later');
      assert.strictEqual(res.isFirstCompletionToday, false);

      // Verify no keys were written to Redis
      assert.strictEqual(await redisMock.get(`user:${userId}:completed:${dayIndex}`), undefined);
      assert.strictEqual(await redisMock.get(`user:${userId}:attempt:${dayIndex}`), undefined);
      assert.strictEqual(await redisMock.get(`user:${userId}:streak`), undefined);
      assert.strictEqual(await redisMock.get(`day:${dayIndex}:completions`), undefined);
    });

    void it('Legacy flag with no attempt record: attempt null, no throw, no double count', async () => {
      const redisMock = createInMemoryRedisMock();
      const userId = 'courier_legacy_test';
      const dayIndex = 66;

      // Pre-seed flag only
      await redisMock.set(`user:${userId}:completed:${dayIndex}`, '1');
      await redisMock.set(`user:${userId}:streak`, '3');

      const res = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 12,
          won: true,
          visitedCoordinates: dummyCoords,
        },
        redisMock
      );

      assert.strictEqual(res.status, 'already_completed');
      assert.strictEqual(res.isFirstCompletionToday, false);
      assert.strictEqual(res.attempt, null);
      assert.strictEqual(res.streak, 3);
      assert.strictEqual(await redisMock.get(`user:${userId}:streak`), '3');
    });

    void it('Malformed attempt record: attempt null, no throw', async () => {
      const redisMock = createInMemoryRedisMock();
      const userId = 'courier_malformed_test';
      const dayIndex = 67;

      await redisMock.set(`user:${userId}:completed:${dayIndex}`, '1');
      await redisMock.set(`user:${userId}:attempt:${dayIndex}`, '{broken json!');

      const res = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: 15,
          won: true,
          visitedCoordinates: dummyCoords,
        },
        redisMock
      );

      assert.strictEqual(res.status, 'already_completed');
      assert.strictEqual(res.isFirstCompletionToday, false);
      assert.strictEqual(res.attempt, null);
    });
  });
});
