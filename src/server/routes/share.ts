import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { ShareResponse, ShareSubmission, StarRating } from '../../shared/types';

export const share = new Hono();

export const isT3Id = (val: string): val is `t3_${string}` => {
  return val.startsWith('t3_');
};

export const toT3Id = (val: unknown): `t3_${string}` | undefined => {
  if (typeof val !== 'string' || val.trim().length === 0) return undefined;
  const trimmed = val.trim();
  if (trimmed.startsWith('t3_')) {
    return `t3_${trimmed.slice(3)}`;
  }
  return `t3_${trimmed}`;
};

export const toStarRating = (val: number): StarRating => {
  switch (val) {
    case 3:
      return 3;
    case 2:
      return 2;
    case 1:
      return 1;
    default:
      return 0;
  }
};

export const formatShareComment = (params: ShareSubmission): string => {
  const { dayIndex, won, movesUsed, stars, streak } = params;
  const starGlyphs = won
    ? stars === 3
      ? '★★★'
      : stars === 2
        ? '★★☆'
        : stars === 1
          ? '★☆☆'
          : '☆☆☆'
    : '☆☆☆';
  const statusText = won ? 'Route Delivered' : 'Out of Moves';
  const streakText = `${streak} ${streak === 1 ? 'day' : 'days'}`;

  return [
    `📦 **DeadDrop Route — Night Shift Dispatch #${dayIndex + 1}**`,
    '',
    `- **Status**: ${statusText}`,
    `- **Rating**: ${starGlyphs}`,
    `- **Moves Used**: ${movesUsed}`,
    `- **Courier Streak**: ${streakText}`,
    '',
    `*Dispatched via DeadDrop Route*`,
  ].join('\n');
};

export type RedditClientForShare = {
  submitComment(options: {
    id: `t3_${string}` | `t1_${string}`;
    text: string;
    runAs?: 'USER' | 'APP';
  }): Promise<{ id: string; url?: string | undefined }>;
};

export const executeShareComment = async (
  submission: ShareSubmission,
  targetPostId: `t3_${string}`,
  client: RedditClientForShare = reddit
): Promise<{ id: string; url?: string | undefined }> => {
  const commentText = formatShareComment(submission);

  // Strictly post on behalf of the user (runAs: 'USER'). Never fallback to the app/bot account.
  return await client.submitComment({
    id: targetPostId,
    text: commentText,
    runAs: 'USER',
  });
};

share.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_json',
        message: 'Request body must be valid JSON',
      },
      400
    );
  }

  if (typeof body !== 'object' || body === null) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_payload',
        message: 'Request body must be a valid JSON object',
      },
      400
    );
  }

  const rec = body as Record<string, unknown>;

  // Validate outcome (won boolean or outcome 'won'|'lost')
  const hasWonBool = 'won' in rec && typeof rec.won === 'boolean';
  const hasOutcome = 'outcome' in rec && (rec.outcome === 'won' || rec.outcome === 'lost');
  if (!hasWonBool && !hasOutcome) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_payload',
        message: 'Missing or invalid outcome in share submission',
      },
      400
    );
  }
  const won = hasWonBool ? (rec.won as boolean) : rec.outcome === 'won';

  // Validate movesUsed (must be positive finite number)
  if (
    !('movesUsed' in rec) ||
    typeof rec.movesUsed !== 'number' ||
    !Number.isFinite(rec.movesUsed) ||
    rec.movesUsed <= 0
  ) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_payload',
        message: 'Missing or invalid movesUsed in share submission',
      },
      400
    );
  }
  const movesUsed = rec.movesUsed;

  // Validate stars
  if (!('stars' in rec) || typeof rec.stars !== 'number' || !Number.isFinite(rec.stars)) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_payload',
        message: 'Missing or invalid stars in share submission',
      },
      400
    );
  }
  const validStars = toStarRating(rec.stars);
  if (won && validStars === 0) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_payload',
        message: 'Winning share submission must have at least 1 star',
      },
      400
    );
  }
  if (!won && validStars !== 0) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_payload',
        message: 'Losing share submission must have 0 stars',
      },
      400
    );
  }

  // Validate dayIndex and streak
  if (
    !('dayIndex' in rec) ||
    typeof rec.dayIndex !== 'number' ||
    !Number.isFinite(rec.dayIndex) ||
    !('streak' in rec) ||
    typeof rec.streak !== 'number' ||
    !Number.isFinite(rec.streak)
  ) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'invalid_payload',
        message: 'Missing or invalid fields in share submission',
      },
      400
    );
  }
  const dayIndex = rec.dayIndex;
  const streak = rec.streak;

  let targetPostId: `t3_${string}` | undefined;
  try {
    if (context.postId) {
      targetPostId = toT3Id(context.postId);
    }
  } catch {
    // Headless test or outside server request
  }

  if (
    !targetPostId &&
    'postId' in body &&
    typeof body.postId === 'string'
  ) {
    targetPostId = toT3Id(body.postId);
  }

  if (!targetPostId) {
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'missing_post_id',
        message: 'Unable to identify target Reddit post for comment submission',
      },
      400
    );
  }

  try {
    const submission: ShareSubmission = {
      dayIndex,
      won,
      movesUsed,
      stars: validStars,
      streak,
    };

    const comment = await executeShareComment(submission, targetPostId, reddit);

    return c.json<ShareResponse>({
      status: 'success',
      commentId: comment.id,
      ...(comment.url !== undefined ? { commentUrl: comment.url } : {}),
    });
  } catch (err) {
    console.error('[Share] Failed to submit comment:', err);
    return c.json<ShareResponse>(
      {
        status: 'error',
        error: 'submit_failed',
        message: "Couldn't post to Reddit. Please try again.",
      },
      500
    );
  }
});
