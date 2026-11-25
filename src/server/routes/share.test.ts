/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Context, runWithContext } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { createShareRoute, executeShareComment, formatShareComment, isT3Id, releaseLockSafely, share, toStarRating, toT3Id } from './share.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { createCompleteRoute } from './complete.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { daily } from './daily.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap, getUtcDayIndex } from '../../shared/dates.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { solveMapDetailed } from '../../shared/solver.ts';
import type { ShareResponse, ShareSubmission } from '../../shared/types';

const isShareResponse = (val: unknown): val is ShareResponse => {
  return typeof val === 'object' && val !== null && 'status' in val;
};

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
  let failSetKeyPrefix: string | null = null;

  const getVersion = (k: string) => keyVersions.get(k) ?? 0;
  const bumpVersion = (k: string) => {
    version++;
    keyVersions.set(k, version);
  };

  return {
    store,
    hashes,
    bumpVersion,
    setFailSetKeyPrefix(prefix: string | null) {
      failSetKeyPrefix = prefix;
    },
    client: {
      async get(k: string): Promise<string | undefined> {
        return store.get(k);
      },
      async set(k: string, v: string, opt?: { nx?: boolean; expiration?: Date }): Promise<string> {
        if (failSetKeyPrefix && k.startsWith(failSetKeyPrefix)) {
          throw new Error(`Redis SET failed for key: ${k}`);
        }
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
            // Check if any watched key changed
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

void describe('POST /api/share & Route Summary Formatting (Prompt 18 PRD Alignment)', () => {
  void it('formats winning route summary comment with correct stars, streak, and markdown', () => {
    const submission: ShareSubmission = {
      dayIndex: 0,
      won: true,
      movesUsed: 14,
      stars: 3,
      streak: 1,
    };

    const text = formatShareComment(submission);

    assert.ok(text.includes('Night Shift Dispatch #1'), 'Should show Day #1');
    assert.ok(text.includes('Route Delivered'), 'Should show Route Delivered');
    assert.ok(text.includes('★★★'), 'Should show 3 stars');
    assert.ok(text.includes('Moves Used**: 14'), 'Should show 14 moves');
    assert.ok(text.includes('Courier Streak**: 1 day'), 'Should format singular day streak');
    assert.ok(!text.includes('Time:'), 'Should not contain time line');
    assert.ok(!text.includes('undefined') && !text.includes('null'), 'Should not contain undefined/null');
  });

  void it('formats lost run with empty stars and Out of Moves status', () => {
    const submission: ShareSubmission = {
      dayIndex: 4,
      won: false,
      movesUsed: 22,
      stars: 0,
      streak: 0,
    };

    const text = formatShareComment(submission);

    assert.ok(text.includes('Night Shift Dispatch #5'), 'Should show Day #5');
    assert.ok(text.includes('Out of Moves'), 'Should show Out of Moves');
    assert.ok(text.includes('☆☆☆'), 'Should show empty stars for lost run');
    assert.ok(text.includes('Courier Streak**: 0 days'), 'Should format plural days streak');
  });

  void it('converts numbers to StarRating safely without casting', () => {
    assert.strictEqual(toStarRating(3), 3);
    assert.strictEqual(toStarRating(2), 2);
    assert.strictEqual(toStarRating(1), 1);
    assert.strictEqual(toStarRating(0), 0);
    assert.strictEqual(toStarRating(99), 0);
    assert.strictEqual(toStarRating(-1), 0);
  });

  void it('validates Reddit post IDs (t3_ prefix) correctly', () => {
    assert.strictEqual(isT3Id('t3_12345'), true);
    assert.strictEqual(isT3Id('t3_abcxyz'), true);
    assert.strictEqual(isT3Id('t1_comment'), false);
    assert.strictEqual(isT3Id('t2_user'), false);
    assert.strictEqual(isT3Id('invalid'), false);
  });

  void it('normalizes post IDs to t3_ format safely without type casting', () => {
    assert.strictEqual(toT3Id('12345'), 't3_12345');
    assert.strictEqual(toT3Id('t3_12345'), 't3_12345');
    assert.strictEqual(toT3Id(''), undefined);
    assert.strictEqual(toT3Id(null), undefined);
    assert.strictEqual(toT3Id(undefined), undefined);
  });

  void it('strictly invokes submitComment with runAs: "USER", and fails without bot fallback when user posting fails', async () => {
    let capturedOptions: {
      id: string;
      text: string;
      runAs?: 'USER' | 'APP';
    } | null = null;

    const mockReddit = {
      submitComment: async (options: {
        id: `t3_${string}` | `t1_${string}`;
        text: string;
        runAs?: 'USER' | 'APP';
      }) => {
        capturedOptions = options;
        return {
          id: 't1_comment_abc123',
          url: 'https://reddit.com/r/test/comments/123/comment/abc',
        };
      },
    };

    const submission: ShareSubmission = {
      dayIndex: 2,
      won: true,
      movesUsed: 16,
      stars: 2,
      streak: 5,
    };

    const result = await executeShareComment(submission, 't3_post999', mockReddit);

    assert.strictEqual(result.id, 't1_comment_abc123');
    assert.ok(capturedOptions !== null, 'Mock submitComment should be called');
    if (capturedOptions !== null) {
      const opts: { id: string; text: string; runAs?: 'USER' | 'APP' } = capturedOptions;
      assert.strictEqual(opts.runAs, 'USER', 'Must submit strictly with runAs: "USER"');
      assert.strictEqual(opts.id, 't3_post999', 'Target ID must match targetPostId');
    }

    // Verify rejection with NO bot fallback when user-delegated submitComment fails
    let fallbackAttempted = false;
    const failingUserMockReddit = {
      submitComment: async (options: {
        id: `t3_${string}` | `t1_${string}`;
        text: string;
        runAs?: 'USER' | 'APP';
      }) => {
        if (options.runAs !== 'USER') {
          fallbackAttempted = true;
        }
        throw new Error('User authentication rejected');
      },
    };

    await assert.rejects(
      async () => {
        await executeShareComment(submission, 't3_post999', failingUserMockReddit);
      },
      { message: 'User authentication rejected' },
      'Must rethrow error and NOT fallback to app account'
    );
    assert.strictEqual(fallbackAttempted, false, 'App/bot fallback must never be attempted');
  });

  void it('rejects POST /api/share with invalid JSON', async () => {
    const res = await share.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{',
    });

    assert.strictEqual(res.status, 400);

    const body: unknown = await res.json();
    assert.ok(isShareResponse(body));
    if (isShareResponse(body)) {
      assert.strictEqual(body.status, 'error');
      if (body.status === 'error') {
        assert.strictEqual(body.error, 'invalid_json');
      }
    }
  });

  void it('rejects POST /api/share when target post ID is unavailable in context', async () => {
    const currentDay = getUtcDayIndex();
    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_courier1:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_courier1:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    const app = createShareRoute({ redisClient: mockRedis.client });

    // Request with auth context but NO post ID
    const res = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay }),
        });
      }
    );

    assert.strictEqual(res.status, 400);
    const body: unknown = await res.json();
    assert.ok(isShareResponse(body));
    if (isShareResponse(body)) {
      assert.strictEqual(body.status, 'error');
      if (body.status === 'error') {
        assert.strictEqual(body.error, 'missing_post_id');
      }
    }
  });

  void it('rejects POST /api/share for a different dayIndex', async () => {
    const currentDay = getUtcDayIndex();
    const mockRedis = createMockRedis();
    const app = createShareRoute({ redisClient: mockRedis.client });

    const res = await runWithContext(
      createTestContext({ userId: 't2_courier1', username: 'courier1', postId: 't3_valid_post' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay + 1 }),
        });
      }
    );

    assert.strictEqual(res.status, 400);
    const body: unknown = await res.json();
    assert.ok(isShareResponse(body));
    if (isShareResponse(body)) {
      assert.strictEqual(body.status, 'error');
      if (body.status === 'error') {
        assert.strictEqual(body.error, 'invalid_day_index');
      }
    }
  });
});

void describe('Task 2B — Sharing Reliability, Lock Semantics, and Error Handling', () => {
  const currentDay = getUtcDayIndex();

  void it('1. Rejects unauthenticated share with HTTP 401 using canonical auth utility', async () => {
    let commentCalled = false;
    const mockReddit = {
      submitComment: async () => {
        commentCalled = true;
        return { id: 't1_should_not_happen' };
      },
    };
    const mockRedis = createMockRedis();
    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });

    // Calling share without any auth context
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayIndex: currentDay }),
    });

    assert.strictEqual(res.status, 401);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'error');
    if (body.status === 'error') {
      assert.strictEqual(body.error, 'unauthenticated');
    }
    assert.strictEqual(commentCalled, false, 'Reddit submitComment must NEVER be called for unauthenticated share');
  });

  void it('2. Rejects request when player has no stored attempt for today with HTTP 400', async () => {
    let commentCalled = false;
    const mockReddit = {
      submitComment: async () => {
        commentCalled = true;
        return { id: 't1_should_not_happen' };
      },
    };
    const mockRedis = createMockRedis();
    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });

    const res = await runWithContext(
      createTestContext({ userId: 't2_courier_no_attempt', username: 'courier_no_attempt', postId: 't3_post123' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: currentDay }),
        });
      }
    );

    assert.strictEqual(res.status, 400);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'error');
    if (body.status === 'error') {
      assert.strictEqual(body.error, 'no_attempt_found');
    }
    assert.strictEqual(commentCalled, false);
  });

  void it('3. Invalid stored dayIndex, moves, and stars are rejected with HTTP 400', async () => {
    const invalidAttempts = [
      { dayIndex: currentDay - 1, outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 }, // Mismatched day
      { outcome: 'won', movesUsed: -1, stars: 3, deliveredCount: 3 }, // Negative moves
      { outcome: 'won', movesUsed: 14.5, stars: 3, deliveredCount: 3 }, // Fractional moves
      { outcome: 'won', movesUsed: 14, stars: 4, deliveredCount: 3 }, // Invalid stars > 3
      { outcome: 'won', movesUsed: 14, stars: -1, deliveredCount: 3 }, // Invalid stars < 0
      { outcome: 'won', movesUsed: 14, stars: 2.5, deliveredCount: 3 }, // Fractional stars
      { outcome: 'lost', movesUsed: 20, stars: 2, deliveredCount: 2 }, // Lost run with non-zero stars
      { outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: -1 }, // Negative deliveredCount
      { outcome: 'invalid_outcome', movesUsed: 14, stars: 3, deliveredCount: 3 }, // Invalid outcome
    ];

    for (const invalidData of invalidAttempts) {
      const mockRedis = createMockRedis();
      mockRedis.store.set(`user:t2_tester:completed:${currentDay}`, '1');
      mockRedis.store.set(`user:t2_tester:attempt:${currentDay}`, JSON.stringify(invalidData));

      const app = createShareRoute({ redisClient: mockRedis.client });
      const res = await runWithContext(
        createTestContext({ userId: 't2_tester', username: 'tester', postId: 't3_thread' }),
        async () => {
          return await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dayIndex: currentDay }),
          });
        }
      );

      assert.strictEqual(res.status, 400, `Should reject invalid attempt: ${JSON.stringify(invalidData)}`);
      const body: ShareResponse = await res.json();
      assert.strictEqual(body.status, 'error');
      if (body.status === 'error') {
        assert.strictEqual(body.error, 'invalid_attempt_record');
      }
    }
  });

  void it('4. Ignores forged client stats and uses server-stored Redis records', async () => {
    let postedText = '';
    const mockReddit = {
      submitComment: async (options: { text: string }) => {
        postedText = options.text;
        return { id: 't1_verified_comment_123' };
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_cheater:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_cheater:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'lost', movesUsed: 22, stars: 0, deliveredCount: 1 })
    );
    mockRedis.store.set('user:t2_cheater:streak', '0');

    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });

    const res = await runWithContext(
      createTestContext({ userId: 't2_cheater', username: 'cheater_user', postId: 't3_game_post' }),
      async () => {
        return await app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dayIndex: currentDay,
            won: true,
            movesUsed: 5,
            stars: 3,
            streak: 99,
          }),
        });
      }
    );

    assert.strictEqual(res.status, 200);
    assert.ok(postedText.includes('Out of Moves'));
    assert.ok(postedText.includes('☆☆☆'));
    assert.ok(postedText.includes('Moves Used**: 22'));
    assert.ok(!postedText.includes('Route Delivered'));
    assert.ok(!postedText.includes('★★★'));
  });

  void it('5. Two overlapping share requests cannot both submit comments under lock semantics', async () => {
    let submitCommentCalls = 0;
    let releaseComment = () => {};
    const commentPromise = new Promise<void>((resolve) => {
      releaseComment = resolve;
    });

    const mockReddit = {
      submitComment: async () => {
        submitCommentCalls++;
        // Keep first call pending until we simulate the concurrent overlapping request
        await commentPromise;
        return { id: `t1_comment_${submitCommentCalls}` };
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_concurrent:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_concurrent:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });
    const userCtx = createTestContext({
      userId: 't2_concurrent',
      username: 'concurrent_user',
      postId: 't3_thread',
    });

    // Start request 1 (will hold lock and pause inside submitComment)
    const req1Promise = runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });

    // Wait a brief moment to ensure Request 1 acquired the lock
    await new Promise((r) => setTimeout(r, 20));

    // Start request 2 concurrently while Request 1 is still in-flight
    const req2Promise = runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });

    // Let Request 2 run into the lock conflict
    const res2 = await req2Promise;
    assert.strictEqual(res2.status, 409, 'Overlapping request must receive 409');
    const body2: ShareResponse = await res2.json();
    assert.strictEqual(body2.status, 'error');
    if (body2.status === 'error') {
      assert.strictEqual(body2.error, 'share_in_progress');
    }

    // Now release Request 1 so it finishes
    releaseComment();
    const res1 = await req1Promise;
    assert.strictEqual(res1.status, 200);

    // Exactly one comment was created
    assert.strictEqual(submitCommentCalls, 1, 'Reddit submitComment must only be called once');
  });

  void it('6. Second request after first successful share does not post again (HTTP 409 already_shared)', async () => {
    let callCount = 0;
    const mockReddit = {
      submitComment: async () => {
        callCount++;
        return { id: `t1_comment_${callCount}` };
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_seq:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_seq:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });
    const userCtx = createTestContext({
      userId: 't2_seq',
      username: 'seq_user',
      postId: 't3_thread',
    });

    // 1st request succeeds
    const res1 = await runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(callCount, 1);

    // 2nd request arrives after 1st has completed
    const res2 = await runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });
    assert.strictEqual(res2.status, 409);
    const body2: ShareResponse = await res2.json();
    assert.strictEqual(body2.status, 'error');
    if (body2.status === 'error') {
      assert.strictEqual(body2.error, 'already_shared');
    }
    assert.strictEqual(callCount, 1, 'Reddit submitComment must NOT be called on second request');
  });

  void it('7. Shared-record persistence failure is surfaced accurately as uncertain outcome', async () => {
    let commentSubmitted = false;
    const mockReddit = {
      submitComment: async () => {
        commentSubmitted = true;
        return { id: 't1_reddit_live_comment_123', url: 'https://reddit.com/r/test/comments/123/comment/xyz' };
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_persist_fail:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_persist_fail:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    // Cause Redis to fail when persisting the shared record
    const sharedKeyPrefix = `user:t2_persist_fail:shared:${currentDay}`;
    mockRedis.setFailSetKeyPrefix(sharedKeyPrefix);

    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });
    const userCtx = createTestContext({
      userId: 't2_persist_fail',
      username: 'persist_fail_user',
      postId: 't3_thread',
    });

    const res = await runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });

    assert.strictEqual(commentSubmitted, true, 'Comment was submitted to Reddit');
    assert.strictEqual(res.status, 500);

    const body: ShareResponse = await res.json();
    // Must NOT be reported as success! Must accurately report uncertain persistence failure
    assert.strictEqual(body.status, 'uncertain');
    if (body.status === 'uncertain') {
      assert.strictEqual(body.error, 'persistence_failed');
      assert.strictEqual(body.commentId, 't1_reddit_live_comment_123');
      assert.ok(body.message.includes('posted to Reddit, but the dispatch record could not be saved'));
    }
  });

  void it('8. Lock expiry and stale-owner cleanup cannot remove another owner\'s lock', async () => {
    const mockRedis = createMockRedis();
    const lockKey = `user:t2_lock_test:share_lock:${currentDay}`;

    // Step 1: Simulate owner A acquiring lock
    mockRedis.store.set(lockKey, 'owner_A');

    // Step 2: Simulate lock expiration and owner B acquiring lock
    mockRedis.store.set(lockKey, 'owner_B');

    // Step 3: Owner A attempts to release lock using stale owner token
    const released = await releaseLockSafely(mockRedis.client, lockKey, 'owner_A');

    assert.strictEqual(released, false, 'releaseLockSafely must return false for stale owner token');
    assert.strictEqual(
      mockRedis.store.get(lockKey),
      'owner_B',
      "Owner B's lock must NOT be deleted by Owner A's release call"
    );

    // Step 4: Owner B releases with correct token
    const releasedByB = await releaseLockSafely(mockRedis.client, lockKey, 'owner_B');
    assert.strictEqual(releasedByB, true, 'releaseLockSafely must return true for matching owner token');
    assert.strictEqual(mockRedis.store.has(lockKey), false, 'Lock key must be removed when owner matches');
  });

  void it('9. Reddit submission timeout surfaces uncertain outcome rather than ordinary failure', async () => {
    const mockReddit = {
      submitComment: async () => {
        throw new Error('Reddit Gateway ETIMEDOUT: connection timed out');
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_timeout:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_timeout:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });
    const userCtx = createTestContext({
      userId: 't2_timeout',
      username: 'timeout_user',
      postId: 't3_thread',
    });

    const res = await runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });

    assert.strictEqual(res.status, 504);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'uncertain');
    if (body.status === 'uncertain') {
      assert.strictEqual(body.error, 'submission_timeout');
      assert.ok(body.message.includes('timed out'));
    }

    // In-flight lock must be cleaned up
    assert.strictEqual(mockRedis.store.has(`user:t2_timeout:share_lock:${currentDay}`), false);
  });

  void it('10. Confirmed Reddit API error returns 500 submit_failed and safely releases lock', async () => {
    const mockReddit = {
      submitComment: async () => {
        throw new Error('Reddit 429 Too Many Requests');
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_retry_user:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_retry_user:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });
    const userCtx = createTestContext({
      userId: 't2_retry_user',
      username: 'retry_user',
      postId: 't3_thread',
    });

    const res = await runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });

    assert.strictEqual(res.status, 500);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'error');
    if (body.status === 'error') {
      assert.strictEqual(body.error, 'submit_failed');
    }

    // Lock must be released
    assert.strictEqual(mockRedis.store.has(`user:t2_retry_user:share_lock:${currentDay}`), false);
    assert.strictEqual(mockRedis.store.has(`user:t2_retry_user:shared:${currentDay}`), false);
  });

  void it('11. Real route integration compiles against current auth utility and passes', async () => {
    // Testing the default export `share` route imported from './share.ts'
    const res = await share.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayIndex: currentDay }),
    });

    // Without auth context, it must return 401 unauthenticated
    assert.strictEqual(res.status, 401);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'error');
    if (body.status === 'error') {
      assert.strictEqual(body.error, 'unauthenticated');
    }
  });

  void it('12. Missing watch() never causes unsafe lock deletion (leaves lock to expire via TTL)', async () => {
    const mockRedis = createMockRedis();
    const lockKey = `user:t2_no_watch:share_lock:${currentDay}`;
    const ownerToken = 'owner_token_123';
    mockRedis.store.set(lockKey, ownerToken);

    // Create a client variant where watch is undefined
    const clientWithoutWatch = {
      ...mockRedis.client,
      watch: undefined,
    };

    // Calling releaseLockSafely without watch must return false and NOT delete lockKey
    const released = await releaseLockSafely(clientWithoutWatch, lockKey, ownerToken);
    assert.strictEqual(released, false, 'Must return false when watch is not supported');
    assert.strictEqual(
      mockRedis.store.get(lockKey),
      ownerToken,
      'Lock key must remain intact in Redis so TTL handles expiry safely'
    );
  });

  void it('13. Failed post-lock Redis read returns HTTP 500 storage_error and never submits a Reddit comment', async () => {
    let redditSubmitted = false;
    const mockReddit = {
      submitComment: async () => {
        redditSubmitted = true;
        return { id: 't1_never_called' };
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_read_fail:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_read_fail:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    // Make Redis get() throw on the post-lock recheck of sharedKey
    const sharedKey = `user:t2_read_fail:shared:${currentDay}`;
    const originalGet = mockRedis.client.get;
    let getCallCount = 0;
    const clientWithFailingGet = {
      ...mockRedis.client,
      async get(k: string) {
        if (k === sharedKey) {
          getCallCount++;
          // First call is pre-lock check (returns undefined)
          if (getCallCount > 1) {
            // Second call is post-lock recheck: simulate transient Redis failure
            throw new Error('Redis connection dropped during post-lock recheck');
          }
        }
        return originalGet(k);
      },
    };

    const app = createShareRoute({ redisClient: clientWithFailingGet, redditClient: mockReddit });
    const userCtx = createTestContext({
      userId: 't2_read_fail',
      username: 'read_fail_user',
      postId: 't3_thread',
    });

    const res = await runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });

    assert.strictEqual(res.status, 500);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'error');
    if (body.status === 'error') {
      assert.strictEqual(body.error, 'storage_error');
    }
    assert.strictEqual(redditSubmitted, false, 'Reddit submitComment must NEVER be called when post-lock read fails');

    // Safe lock cleanup check
    assert.strictEqual(mockRedis.store.has(`user:t2_read_fail:share_lock:${currentDay}`), false);
  });

  void it('14. Unexpected Reddit errors produce an uncertain outcome without encouraging blind retries', async () => {
    const mockReddit = {
      submitComment: async () => {
        // Unknown, unexpected runtime error from Reddit SDK (not a definite 4xx rejection or timeout)
        throw new Error('Unexpected fatal Reddit SDK fault: internal state corruption');
      },
    };

    const mockRedis = createMockRedis();
    mockRedis.store.set(`user:t2_unexpected:completed:${currentDay}`, '1');
    mockRedis.store.set(
      `user:t2_unexpected:attempt:${currentDay}`,
      JSON.stringify({ outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 })
    );

    const app = createShareRoute({ redisClient: mockRedis.client, redditClient: mockReddit });
    const userCtx = createTestContext({
      userId: 't2_unexpected',
      username: 'unexpected_user',
      postId: 't3_thread',
    });

    const res = await runWithContext(userCtx, async () => {
      return await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIndex: currentDay }),
      });
    });

    assert.strictEqual(res.status, 500);
    const body: ShareResponse = await res.json();
    assert.strictEqual(body.status, 'uncertain');
    if (body.status === 'uncertain') {
      assert.strictEqual(body.error, 'submission_uncertain');
      assert.ok(body.message.includes('check the thread before trying again'));
      assert.ok(!body.message.includes('Please try again.'));
    }

    // In-flight lock is safely cleaned up
    assert.strictEqual(mockRedis.store.has(`user:t2_unexpected:share_lock:${currentDay}`), false);
  });
});
