import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { validateRunSubmission } from '../services/validate.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { recordRunStats, type RedisClientLike } from '../services/stats.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getCanonicalUserId } from '../auth.ts';
import type { CompleteResponse } from '../../shared/types';

export type CompleteEnv = {
  Bindings: {
    redisClient?: RedisClientLike;
  };
};

export const createCompleteRoute = (defaultDeps: { redisClient?: RedisClientLike } = {}) => {
  const complete = new Hono<CompleteEnv>();

  complete.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json<CompleteResponse>(
        {
          status: 'error',
          valid: false,
          error: 'invalid_json',
          message: 'Request body must be valid JSON',
        },
        400
      );
    }

    const userId = getCanonicalUserId();

    if (!userId) {
      return c.json<CompleteResponse>(
        {
          status: 'error',
          valid: false,
          error: 'unauthenticated',
          message: 'Authenticated Reddit user ID required to record completion',
        },
        401
      );
    }

    const result = validateRunSubmission(body);

    if (!result.valid) {
      return c.json<CompleteResponse>(
        {
          status: 'error',
          valid: false,
          error: result.error,
          message: result.message,
          ...(result.step !== undefined ? { step: result.step } : {}),
        },
        400
      );
    }

    const dayIndex =
      typeof body === 'object' &&
      body !== null &&
      'dayIndex' in body &&
      typeof body.dayIndex === 'number'
        ? body.dayIndex
        : 0;

    const redisClient = c.env?.redisClient ?? defaultDeps.redisClient ?? redis;

    let stats;
    try {
      stats = await recordRunStats(
        {
          userId,
          dayIndex,
          movesUsed: result.movesUsed,
          won: result.won,
          visitedCoordinates: result.visitedCoordinates,
          stars: result.stars,
          deliveredCount: result.deliveredCount,
        },
        redisClient
      );
    } catch (storageErr) {
      console.error('[Complete] Unexpected error recording run stats:', storageErr);
      return c.json<CompleteResponse>(
        {
          status: 'retry_later',
        },
        503
      );
    }

    if (stats.status === 'retry_later') {
      return c.json<CompleteResponse>(
        {
          status: 'retry_later',
        },
        503
      );
    }

    if (!stats.isFirstCompletionToday) {
      return c.json<CompleteResponse>(
        {
          status: 'already_completed',
          attempt: stats.attempt,
        },
        409
      );
    }

    return c.json<CompleteResponse>({
      status: 'success',
      valid: true,
      won: result.won,
      lost: result.lost,
      movesUsed: result.movesUsed,
      stars: result.stars,
      deliveredCount: result.deliveredCount,
      movesLeft: result.movesLeft,
      streak: stats.streak,
      bestMoves: stats.bestMoves,
      completions: stats.completions,
      traffic: stats.traffic,
    });
  });

  return complete;
};

export const complete = createCompleteRoute();
