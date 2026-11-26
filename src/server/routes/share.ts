import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type { ShareResponse, ShareSubmission, StarRating } from '../../shared/types';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getCanonicalUserId } from '../auth.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { isValidAttemptRecord, type RedisClientLike } from '../services/stats.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getUtcDayIndex } from '../../shared/dates.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatDispatchSummary } from '../../shared/format.ts';

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
  return formatDispatchSummary({
    dayIndex: params.dayIndex ?? 0,
    won: params.won ?? false,
    movesUsed: params.movesUsed ?? 0,
    stars: params.stars ?? 0,
    streak: params.streak ?? 0,
  });
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

/**
 * Safely releases an in-flight lock only if the key still holds the caller's ownerToken.
 *
 * Atomicity Note & Platform Limitation:
 * Devvit Web Redis does not support Lua scripting (EVAL / EVALSHA), so Redlock's single-command
 * release script cannot be executed directly.
 * Instead, we use Redis WATCH -> GET -> MULTI -> DEL -> EXEC:
 * 1. WATCH the lock key.
 * 2. GET the current lock value.
 * 3. If value === ownerToken, queue DEL inside MULTI and call EXEC.
 *    If the key expired and was modified/reacquired by another owner concurrently,
 *    WATCH triggers an abort, preventing deletion of the new owner's lock.
 * 4. If value !== ownerToken, DISCARD without deleting.
 *
 * If client.watch is unsupported or unavailable, we do NOT perform a non-atomic
 * GET -> DEL check, as that could delete another owner's lock. Instead, we leave
 * the lock to expire safely via its TTL.
 */
export const releaseLockSafely = async (
  redisClient: RedisClientLike,
  lockKey: string,
  ownerToken: string
): Promise<boolean> => {
  try {
    if (typeof redisClient.watch === 'function') {
      const txn = await redisClient.watch(lockKey);
      const currentVal = await redisClient.get(lockKey);
      if (currentVal === ownerToken) {
        await txn.multi();
        if (typeof txn.del === 'function') {
          await txn.del(lockKey);
        }
        const execRes = await txn.exec();
        return Array.isArray(execRes) && execRes.length > 0;
      }
      if (typeof txn.discard === 'function') {
        await txn.discard();
      }
      return false;
    }

    // When watch is unsupported or unavailable, do NOT delete the lock non-atomically.
    // Allow its TTL to expire naturally to prevent removing another owner's lock.
    return false;
  } catch (err) {
    console.warn('[Share] Lock release error:', err);
    return false;
  }
};

export type ShareDependencies = {
  redisClient?: RedisClientLike;
  redditClient?: RedditClientForShare;
};

export type ShareEnv = {
  Bindings: {
    redisClient?: RedisClientLike;
    redditClient?: RedditClientForShare;
  };
};

const isObject = (val: unknown): val is Record<string, unknown> => {
  return typeof val === 'object' && val !== null;
};

export const createShareRoute = (defaultDeps: ShareDependencies = {}) => {
  const shareApp = new Hono<ShareEnv>();

  shareApp.post('/', async (c) => {
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

    if (!isObject(body)) {
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'invalid_payload',
          message: 'Request body must be a valid JSON object',
        },
        400
      );
    }

    // 1. Resolve player exclusively through trusted canonical Reddit user ID
    const userId = getCanonicalUserId();
    if (!userId) {
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'unauthenticated',
          message: 'Authenticated Reddit user ID required to share route',
        },
        401
      );
    }

    // 2. Derive destination post ID from trusted Devvit context, not arbitrary client input
    let targetPostId: `t3_${string}` | undefined;
    try {
      if (context.postId) {
        targetPostId = toT3Id(context.postId);
      }
    } catch {
      // Outside server request or unauthenticated
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

    // 3. Validate dayIndex if provided by client (must match current UTC day)
    const currentDay = getUtcDayIndex();
    if ('dayIndex' in body && typeof body.dayIndex === 'number' && Number.isFinite(body.dayIndex)) {
      if (body.dayIndex !== currentDay) {
        return c.json<ShareResponse>(
          {
            status: 'error',
            error: 'invalid_day_index',
            message: "Sharing is only permitted for today's dispatch.",
          },
          400
        );
      }
    }

    const redisClient = c.env?.redisClient ?? defaultDeps.redisClient ?? redis;
    const redditClient = c.env?.redditClient ?? defaultDeps.redditClient ?? reddit;

    const sharedKey = `user:${userId}:shared:${currentDay}`;
    const lockKey = `user:${userId}:share_lock:${currentDay}`;

    // 4. Retrieve verified attempt and completion status from Redis
    let rawCompleted: string | undefined;
    let rawAttempt: string | undefined;
    let rawStreak: string | undefined;
    let alreadySharedCommentId: string | undefined;

    try {
      const results = await Promise.all([
        redisClient.get(`user:${userId}:completed:${currentDay}`),
        redisClient.get(`user:${userId}:attempt:${currentDay}`),
        redisClient.get(`user:${userId}:streak`),
        redisClient.get(sharedKey),
      ]);
      rawCompleted = results[0];
      rawAttempt = results[1];
      rawStreak = results[2];
      alreadySharedCommentId = results[3];
    } catch (err) {
      console.error('[Share] Storage error retrieving attempt records:', err);
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'storage_error',
          message: 'Failed to retrieve verified attempt records. Please try again.',
        },
        500
      );
    }

    // 5. Pre-check if already shared
    if (alreadySharedCommentId) {
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'already_shared',
          message: 'Route summary has already been logged to dispatch.',
        },
        409
      );
    }

    // 6. Validate stored attempt
    if (!rawCompleted || !rawAttempt) {
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'no_attempt_found',
          message: 'No verified run attempt found to share for today.',
        },
        400
      );
    }

    let attemptData: unknown;
    try {
      attemptData = JSON.parse(rawAttempt);
    } catch {
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'invalid_attempt_record',
          message: 'Stored attempt record is invalid or malformed.',
        },
        400
      );
    }

    if (!isValidAttemptRecord(attemptData, currentDay)) {
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'invalid_attempt_record',
          message: 'Stored attempt record is invalid or malformed.',
        },
        400
      );
    }

    // 7. Acquire short-lived in-flight lock using atomic NX with unique owner token
    const ownerToken = `owner_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    let acquiredLock = false;
    try {
      const lockRes = await redisClient.set(lockKey, ownerToken, {
        nx: true,
        expiration: new Date(Date.now() + 30000), // 30-second safety TTL
      });
      if (lockRes === 'OK') {
        acquiredLock = true;
      }
    } catch (err) {
      console.warn('[Share] Lock acquisition error:', err);
    }

    if (!acquiredLock) {
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'share_in_progress',
          message: 'Share request is already in progress. Please wait a moment.',
        },
        409
      );
    }

    // 8. Recheck permanent shared record immediately after lock acquisition (double-checked lock pattern)
    try {
      const postLockShared = await redisClient.get(sharedKey);
      if (postLockShared) {
        await releaseLockSafely(redisClient, lockKey, ownerToken);
        return c.json<ShareResponse>(
          {
            status: 'error',
            error: 'already_shared',
            message: 'Route summary has already been logged to dispatch.',
          },
          409
        );
      }
    } catch (err) {
      console.error('[Share] Storage error re-checking shared record under lock:', err);
      await releaseLockSafely(redisClient, lockKey, ownerToken);
      return c.json<ShareResponse>(
        {
          status: 'error',
          error: 'storage_error',
          message: 'Failed to verify dispatch status. Please try again.',
        },
        500
      );
    }

    // 9. Server-authoritative submission strictly constructed from validated Redis data
    let streak = 0;
    if (rawStreak !== undefined) {
      const parsed = parseInt(rawStreak, 10);
      if (!Number.isNaN(parsed)) {
        streak = Math.max(0, parsed);
      }
    }

    const verifiedSubmission: ShareSubmission = {
      dayIndex: currentDay,
      won: attemptData.outcome === 'won',
      movesUsed: attemptData.movesUsed,
      stars: attemptData.stars,
      streak,
    };

    const commentText = formatShareComment(verifiedSubmission);

    try {
      let comment: { id: string; url?: string | undefined };
      try {
        comment = await executeShareComment(verifiedSubmission, targetPostId, redditClient);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        const isTimeout = /timeout|etimedout|econnreset|esockettimedout|network|aborterror/i.test(
          errMessage
        );

        if (isTimeout) {
          // Ambiguous: network timed out, comment might exist on Reddit
          return c.json<ShareResponse>(
            {
              status: 'uncertain',
              error: 'submission_timeout',
              message:
                'Request to Reddit timed out. The comment may have been posted; please check the thread before trying again.',
            },
            504
          );
        }

        // Check for definite rejections from Reddit API/SDK
        const isDefiniteRejection =
          /(?:400|401|403|404|422|429)\b/i.test(errMessage) ||
          /user authentication rejected|unauthorized|forbidden|not found|rate limit|too many requests|thread is locked|post has been deleted/i.test(
            errMessage
          );

        if (isDefiniteRejection) {
          console.error('[Share] Confirmed Reddit API rejection:', err);
          return c.json<ShareResponse>(
            {
              status: 'error',
              error: 'submit_failed',
              message: /429|rate limit|too many requests|ratelimit/i.test(errMessage)
                ? 'Reddit rate limit reached. Please wait before sharing again.'
                : 'Reddit rejected the comment submission. Please check permissions and try again.',
            },
            500
          );
        }

        // Unexpected/unknown exception: outcome is uncertain. Do not encourage blind retries.
        console.error('[Share] Unexpected Reddit submission error:', err);
        return c.json<ShareResponse>(
          {
            status: 'uncertain',
            error: 'submission_uncertain',
            message:
              'Reddit dispatch submission encountered an unexpected error. The comment may have been posted; please check the thread before trying again.',
          },
          500
        );
      }

      // Comment succeeded. Persist comment ID in Redis to prevent future duplicates.
      try {
        await redisClient.set(sharedKey, comment.id);
      } catch (err) {
        // Reddit comment succeeded, but Redis persistence failed: treat as uncertain outcome
        console.error('[Share] Storage error recording sharedCommentId:', err);
        return c.json<ShareResponse>(
          {
            status: 'uncertain',
            error: 'persistence_failed',
            message:
              'Comment posted to Reddit, but the dispatch record could not be saved. Check the Reddit post before attempting to share again.',
            commentId: comment.id,
            ...(comment.url !== undefined ? { commentUrl: comment.url } : {}),
            shareText: commentText,
          },
          500
        );
      }

      return c.json<ShareResponse>({
        status: 'success',
        commentId: comment.id,
        ...(comment.url !== undefined ? { commentUrl: comment.url } : {}),
        shareText: commentText,
      });
    } finally {
      // Safely release the in-flight lock only if still owned by this request
      await releaseLockSafely(redisClient, lockKey, ownerToken);
    }
  });

  return shareApp;
};

export const share = createShareRoute();
