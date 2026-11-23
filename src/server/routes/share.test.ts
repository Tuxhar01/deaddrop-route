/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { executeShareComment, formatShareComment, isT3Id, share, toStarRating, toT3Id } from './share.ts';
import type { ShareResponse, ShareSubmission } from '../../shared/types';

const isShareResponse = (val: unknown): val is ShareResponse => {
  return typeof val === 'object' && val !== null && 'status' in val;
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

  void it('rejects POST /api/share with missing required fields', async () => {
    const res = await share.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: 1,
      }),
    });

    assert.strictEqual(res.status, 400);

    const body: unknown = await res.json();
    assert.ok(isShareResponse(body));
    if (isShareResponse(body)) {
      assert.strictEqual(body.status, 'error');
      if (body.status === 'error') {
        assert.strictEqual(body.error, 'invalid_payload');
      }
    }
  });

  void it('rejects POST /api/share when target post ID is unavailable', async () => {
    const res = await share.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: 1,
        won: true,
        movesUsed: 15,
        stars: 3,
        streak: 2,
      }),
    });

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

  void it('POST /api/share with missing movesUsed returns 400 and does not call submitComment', async () => {
    const res = await share.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: 1,
        won: true,
        // movesUsed is deliberately omitted
        stars: 3,
        streak: 2,
        postId: 't3_some_valid_post',
      }),
    });

    assert.strictEqual(res.status, 400);

    const body: unknown = await res.json();
    assert.ok(isShareResponse(body));
    if (isShareResponse(body)) {
      assert.strictEqual(body.status, 'error');
      if (body.status === 'error') {
        assert.strictEqual(body.error, 'invalid_payload');
        assert.ok(body.message.includes('movesUsed'));
      }
    }
  });
});
