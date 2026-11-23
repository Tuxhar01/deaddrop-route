import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { validateRunSubmission } from '../services/validate.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { recordRunStats } from '../services/stats.ts';
import type { CompleteResponse } from '../../shared/types';

export const complete = new Hono();

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

  let userId: string | undefined;
  try {
    userId = context.userId ?? context.username;
  } catch {
    // Headless test or outside server request
  }

  if (!userId) {
    try {
      const currentUsername = await reddit.getCurrentUsername();
      if (currentUsername) {
        userId = currentUsername;
      }
    } catch {
      // Unauthenticated / headless test environment
    }
  }

  if (!userId) {
    const headerUserId = c.req.header('x-user-id');
    if (headerUserId) {
      userId = headerUserId;
    }
  }

  const dayIndex =
    typeof body === 'object' &&
    body !== null &&
    'dayIndex' in body &&
    typeof body.dayIndex === 'number'
      ? body.dayIndex
      : 0;

  const stats = await recordRunStats({
    userId,
    dayIndex,
    movesUsed: result.movesUsed,
    won: result.won,
    visitedCoordinates: result.visitedCoordinates,
    stars: result.stars,
    deliveredCount: result.deliveredCount,
  });

  if (stats.status === 'retry_later') {
    return c.json<CompleteResponse>(
      {
        status: 'retry_later',
      },
      503
    );
  }

  if (userId && !stats.isFirstCompletionToday) {
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
