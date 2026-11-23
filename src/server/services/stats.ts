import { redis } from '@devvit/web/server';
import type { Coordinate, StarRating, UserDailyAttempt } from '../../shared/types';

export type TxClientLike = {
  multi(): Promise<void>;
  exec(): Promise<unknown[]>;
  discard(): Promise<void>;
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; xx?: boolean; expiration?: Date }
  ): Promise<unknown>;
  incrBy(key: string, value: number): Promise<unknown>;
  hIncrBy(key: string, field: string, value: number): Promise<unknown>;
  get?(key: string): Promise<unknown>;
};

export type RedisClientLike = {
  get(key: string): Promise<string | undefined>;
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; xx?: boolean; expiration?: Date }
  ): Promise<string>;
  incrBy(key: string, value: number): Promise<number>;
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet?(key: string, fieldValues: Record<string, string>): Promise<number>;
  watch?(...keys: string[]): Promise<TxClientLike>;
  del?(...keys: string[]): Promise<unknown>;
};

export type RecordRunStatsParams = {
  userId?: string | undefined;
  dayIndex: number;
  movesUsed: number;
  won: boolean;
  visitedCoordinates: Coordinate[];
  stars?: StarRating | undefined;
  deliveredCount?: number | undefined;
};

export type RecordRunStatsResult = {
  streak: number;
  bestMoves: number | null;
  completions: number;
  isFirstCompletionToday: boolean;
  traffic: Record<string, number>;
  attempt: UserDailyAttempt | null;
  status?: 'success' | 'already_completed' | 'retry_later';
};

export const isValidAttemptRecord = (data: unknown): data is UserDailyAttempt => {
  if (typeof data !== 'object' || data === null) return false;
  const rec = data as Record<string, unknown>;
  if (rec.outcome !== 'won' && rec.outcome !== 'lost') return false;
  if (typeof rec.movesUsed !== 'number' || !Number.isFinite(rec.movesUsed) || rec.movesUsed < 0) return false;
  if (rec.stars !== 0 && rec.stars !== 1 && rec.stars !== 2 && rec.stars !== 3) return false;
  if (typeof rec.deliveredCount !== 'number' || !Number.isFinite(rec.deliveredCount) || rec.deliveredCount < 0) return false;
  if (rec.outcome === 'lost' && rec.stars !== 0) return false;
  return true;
};

export const getUserDailyStats = async (
  userId: string | undefined,
  dayIndex: number,
  client: RedisClientLike = redis
): Promise<{
  streak: number;
  bestMoves: number | null;
  completions: number;
  attempt: UserDailyAttempt | null;
  alreadyCompleted: boolean;
}> => {
  let streak = 0;
  let bestMoves: number | null = null;
  let completions = 0;
  let attempt: UserDailyAttempt | null = null;
  let alreadyCompleted = false;

  try {
    const rawCompletions = await client.get(`day:${dayIndex}:completions`);
    if (rawCompletions !== undefined) {
      const parsed = parseInt(rawCompletions, 10);
      if (!Number.isNaN(parsed)) completions = Math.max(0, parsed);
    }

    if (userId) {
      const [rawStreak, rawBest, rawCompleted, rawAttempt] = await Promise.all([
        client.get(`user:${userId}:streak`),
        client.get(`user:${userId}:best:${dayIndex}`),
        client.get(`user:${userId}:completed:${dayIndex}`),
        client.get(`user:${userId}:attempt:${dayIndex}`),
      ]);

      if (rawStreak !== undefined) {
        const parsed = parseInt(rawStreak, 10);
        if (!Number.isNaN(parsed)) streak = Math.max(0, parsed);
      }

      if (rawBest !== undefined) {
        const parsed = parseInt(rawBest, 10);
        if (!Number.isNaN(parsed)) bestMoves = parsed;
      }

      if (rawCompleted === '1' || rawCompleted === 'OK' || rawCompleted === 'true') {
        alreadyCompleted = true;
      }

      if (rawAttempt) {
        try {
          const parsed = JSON.parse(rawAttempt);
          if (isValidAttemptRecord(parsed)) {
            attempt = {
              outcome: parsed.outcome,
              movesUsed: parsed.movesUsed,
              stars: parsed.stars,
              deliveredCount: parsed.deliveredCount,
              ...(typeof parsed.recordedAt === 'string' ? { recordedAt: parsed.recordedAt } : {}),
            };
          }
        } catch {
          attempt = null;
        }
      }
    }
  } catch (err) {
    console.error(`[Stats] Error getting stats for user ${userId ?? 'anonymous'}:`, err);
  }

  return { streak, bestMoves, completions, attempt, alreadyCompleted };
};

const readDuplicateState = async (
  userId: string,
  dayIndex: number,
  client: RedisClientLike
): Promise<RecordRunStatsResult> => {
  const attemptKey = `user:${userId}:attempt:${dayIndex}`;
  let storedAttempt: UserDailyAttempt | null = null;
  try {
    const rawAttempt = await client.get(attemptKey);
    if (rawAttempt) {
      const parsed = JSON.parse(rawAttempt);
      if (isValidAttemptRecord(parsed)) {
        storedAttempt = {
          outcome: parsed.outcome,
          movesUsed: parsed.movesUsed,
          stars: parsed.stars,
          deliveredCount: parsed.deliveredCount,
          ...(typeof parsed.recordedAt === 'string' ? { recordedAt: parsed.recordedAt } : {}),
        };
      }
    }
  } catch (err) {
    console.warn(`[Stats] Failed to read/parse attempt for user ${userId}:`, err);
  }

  let streak = 0;
  let bestMoves: number | null = null;
  let completions = 0;
  const traffic: Record<string, number> = {};

  try {
    const [rawStreak, rawBest, rawCompletions, rawTraffic] = await Promise.all([
      client.get(`user:${userId}:streak`),
      client.get(`user:${userId}:best:${dayIndex}`),
      client.get(`day:${dayIndex}:completions`),
      client.hGetAll(`day:${dayIndex}:traffic`),
    ]);
    if (rawStreak !== undefined) {
      const parsed = parseInt(rawStreak, 10);
      if (!Number.isNaN(parsed)) streak = Math.max(0, parsed);
    }
    if (rawBest !== undefined) {
      const parsed = parseInt(rawBest, 10);
      if (!Number.isNaN(parsed)) bestMoves = parsed;
    }
    if (rawCompletions !== undefined) {
      const parsed = parseInt(rawCompletions, 10);
      if (!Number.isNaN(parsed)) completions = Math.max(0, parsed);
    }
    for (const [tileId, countStr] of Object.entries(rawTraffic)) {
      const parsed = parseInt(countStr, 10);
      if (!Number.isNaN(parsed)) traffic[tileId] = parsed;
    }
  } catch (err) {
    console.warn(`[Stats] Error reading stats on duplicate completion for user ${userId}:`, err);
  }

  return {
    streak,
    bestMoves,
    completions,
    isFirstCompletionToday: false,
    traffic,
    attempt: storedAttempt,
    status: 'already_completed',
  };
};

export const recordRunStats = async (
  params: RecordRunStatsParams,
  client: RedisClientLike = redis
): Promise<RecordRunStatsResult> => {
  const {
    userId,
    dayIndex,
    movesUsed,
    won,
    visitedCoordinates,
    stars,
    deliveredCount,
  } = params;

  // If no user is identified, return clean non-mutated/default values without crashing
  if (!userId) {
    let completions = 0;
    const traffic: Record<string, number> = {};
    try {
      const [rawCompletions, rawTraffic] = await Promise.all([
        client.get(`day:${dayIndex}:completions`),
        client.hGetAll(`day:${dayIndex}:traffic`),
      ]);
      if (rawCompletions !== undefined) {
        const parsed = parseInt(rawCompletions, 10);
        if (!Number.isNaN(parsed)) completions = Math.max(0, parsed);
      }
      for (const [tileId, countStr] of Object.entries(rawTraffic)) {
        const parsed = parseInt(countStr, 10);
        if (!Number.isNaN(parsed)) {
          traffic[tileId] = parsed;
        }
      }
    } catch (err) {
      console.warn('[Stats] Failed to read completions for guest user:', err);
    }

    return {
      streak: 0,
      bestMoves: null,
      completions,
      isFirstCompletionToday: false,
      traffic,
      attempt: null,
      status: 'success',
    };
  }

  const completionKey = `user:${userId}:completed:${dayIndex}`;
  const attemptKey = `user:${userId}:attempt:${dayIndex}`;
  const streakKey = `user:${userId}:streak`;
  const lastDayKey = `user:${userId}:lastDay`;
  const bestKey = `user:${userId}:best:${dayIndex}`;
  const completionsKey = `day:${dayIndex}:completions`;
  const trafficKey = `day:${dayIndex}:traffic`;

  const attemptRecord: UserDailyAttempt = {
    outcome: won ? 'won' : 'lost',
    movesUsed,
    stars: typeof stars === 'number' ? stars : (won ? 1 : 0),
    deliveredCount: typeof deliveredCount === 'number' ? deliveredCount : (won ? 3 : 0),
    recordedAt: new Date().toISOString(),
  };

  const uniqueTiles = new Set<string>();
  for (const coord of visitedCoordinates) {
    uniqueTiles.add(`${coord.x},${coord.y}`);
  }

  const maxAttempts = 2; // initial attempt + 1 retry
  for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
    // 1. Create watch handle on completionKey
    let txn: TxClientLike;
    if (typeof client.watch === 'function') {
      txn = await client.watch(completionKey);
    } else {
      // In-memory fallback if mock doesn't implement watch
      const queuedOps: Array<() => Promise<unknown>> = [];
      txn = {
        async multi() {},
        async discard() {
          queuedOps.length = 0;
        },
        async set(k, v, opt) {
          queuedOps.push(() => client.set(k, v, opt));
        },
        async incrBy(k, v) {
          queuedOps.push(() => client.incrBy(k, v));
        },
        async hIncrBy(k, f, v) {
          queuedOps.push(() => client.hIncrBy(k, f, v));
        },
        async exec() {
          const res = [];
          for (const op of queuedOps) res.push(await op());
          return res;
        },
      };
    }

    // 2. Read the flag through the same client before multi
    const existing = await client.get(completionKey);
    if (existing !== undefined && existing !== null && existing !== '') {
      if (typeof txn.discard === 'function') {
        try {
          await txn.discard();
        } catch {
          // ignore discard errors
        }
      }
      return readDuplicateState(userId, dayIndex, client);
    }

    // Read previous values before multi to calculate post-transaction state
    let prevCompletions = 0;
    const baseTraffic: Record<string, number> = {};
    let prevStreak = 0;
    let rawLastDay: string | undefined;
    let prevBest: number | null = null;

    try {
      const [rawComp, rawTraf, rawStr, rawLDay, rawB] = await Promise.all([
        client.get(completionsKey),
        client.hGetAll(trafficKey),
        client.get(streakKey),
        client.get(lastDayKey),
        client.get(bestKey),
      ]);
      if (rawComp !== undefined) {
        const p = parseInt(rawComp, 10);
        if (!Number.isNaN(p)) prevCompletions = Math.max(0, p);
      }
      for (const [tId, cStr] of Object.entries(rawTraf)) {
        const p = parseInt(cStr, 10);
        if (!Number.isNaN(p)) baseTraffic[tId] = p;
      }
      if (rawStr !== undefined) {
        const p = parseInt(rawStr, 10);
        if (!Number.isNaN(p)) prevStreak = Math.max(0, p);
      }
      rawLastDay = rawLDay;
      if (rawB !== undefined) {
        const p = parseInt(rawB, 10);
        if (!Number.isNaN(p)) prevBest = p;
      }
    } catch {
      // Best-effort read of base stats
    }

    // 3. Otherwise: await txn.multi(), then queue every write on txn
    await txn.multi();
    let queuedCommandsCount = 0;

    // a. completion flag (set)
    await txn.set(completionKey, '1');
    queuedCommandsCount++;

    // b. attempt record (set)
    await txn.set(attemptKey, JSON.stringify(attemptRecord));
    queuedCommandsCount++;

    // c. streak (incrBy on win, or set if reset; unchanged on loss)
    let newStreak = prevStreak;
    if (won) {
      const lastDay = rawLastDay ? parseInt(rawLastDay, 10) : null;
      if (lastDay === dayIndex - 1 || (lastDay === null && prevStreak === 0)) {
        // Consecutive UTC win or first win
        await txn.incrBy(streakKey, 1);
        queuedCommandsCount++;
        newStreak = prevStreak + 1;
      } else if (lastDay === dayIndex) {
        // Already recorded today (keep streak)
        newStreak = Math.max(1, prevStreak);
      } else {
        // Missed one or more days: reset to 1
        await txn.set(streakKey, '1');
        queuedCommandsCount++;
        newStreak = 1;
      }
      await txn.set(lastDayKey, String(dayIndex));
      queuedCommandsCount++;
    }

    // d. completions (incrBy)
    await txn.incrBy(completionsKey, 1);
    queuedCommandsCount++;
    const newCompletions = prevCompletions + 1;

    // e. traffic (hIncrBy per visited tile)
    const newTraffic: Record<string, number> = { ...baseTraffic };
    for (const tileId of uniqueTiles) {
      await txn.hIncrBy(trafficKey, tileId, 1);
      queuedCommandsCount++;
      newTraffic[tileId] = (newTraffic[tileId] ?? 0) + 1;
    }

    // f. bestMoves (set, only when it's a new best)
    let newBestMoves = prevBest;
    if (won) {
      const isNewBest = prevBest === null || Number.isNaN(prevBest) || movesUsed < prevBest;
      if (isNewBest) {
        await txn.set(bestKey, String(movesUsed));
        queuedCommandsCount++;
        newBestMoves = movesUsed;
      }
    }

    // 4. If you queued zero commands, do not call exec. This should not happen for a valid win; treat it as an error.
    if (queuedCommandsCount === 0) {
      if (typeof txn.discard === 'function') {
        try {
          await txn.discard();
        } catch {
          // ignore
        }
      }
      throw new Error('[Stats] No commands queued for transaction');
    }

    // 5. const results = await txn.exec().
    let results: unknown[] | null = null;
    let isAbort = false;

    try {
      results = await txn.exec();
      if (!Array.isArray(results) || results.length !== queuedCommandsCount) {
        isAbort = true;
      }
    } catch {
      isAbort = true;
    }

    // 6. Only return 200 when exec returned an array with exactly one result per queued command
    if (!isAbort && Array.isArray(results) && results.length === queuedCommandsCount) {
      return {
        streak: newStreak,
        bestMoves: newBestMoves,
        completions: newCompletions,
        isFirstCompletionToday: true,
        traffic: newTraffic,
        attempt: attemptRecord,
        status: 'success',
      };
    }

    // An abort: re-read the completion flag. If it now exists, return 409 with the stored attempt.
    const flagAfterAbort = await client.get(completionKey);
    if (flagAfterAbort !== undefined && flagAfterAbort !== null && flagAfterAbort !== '') {
      return readDuplicateState(userId, dayIndex, client);
    }

    // If not, retry the whole block once.
  }

  // If the retry also aborts, return 503 with { status: 'retry_later' } and change no stat.
  return {
    streak: 0,
    bestMoves: null,
    completions: 0,
    isFirstCompletionToday: false,
    traffic: {},
    attempt: null,
    status: 'retry_later',
  };
};
