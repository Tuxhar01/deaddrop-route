/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { SubmissionController, type CompletedRunStats } from './submissionController.ts';
import type { DailyResponse, Direction, GameMap } from '../shared/types';

const mockMap: GameMap = {
  grid: [
    ['depot', 'road', 'road', 'road', 'road'],
    ['road', 'road', 'road', 'road', 'road'],
    ['road', 'road', 'road', 'road', 'road'],
    ['road', 'road', 'road', 'road', 'road'],
    ['road', 'road', 'road', 'road', 'drop'],
  ],
  depot: { x: 0, y: 0 },
  drops: [{ x: 4, y: 4 }],
  par: 10,
};

const createMockDailyData = (dayIndex = 1): DailyResponse => ({
  dayIndex,
  date: '2026-11-24',
  map: mockMap,
  par: 10,
  streak: 3,
  bestMoves: 8,
  completions: 42,
  attempt: null,
  alreadyCompleted: false,
});

void describe('SubmissionController: Frontend Submission Race & Lifecycle Guards (Task 3D)', () => {
  void it('Regression 1: Two rapid retry clicks do not start overlapping requests; second click drops immediately', async () => {
    let fetchCalls = 0;
    let resolveFirstRequest: ((res: Response) => void) | undefined;

    const mockFetch = async () => {
      fetchCalls++;
      return new Promise<Response>((resolve) => {
        resolveFirstRequest = resolve;
      });
    };

    const controller = new SubmissionController({
      fetchFn: mockFetch,
      delayFn: async () => {},
    });

    controller.setDailyData(createMockDailyData(1));
    controller.captureTerminalRun({
      dayIndex: 1,
      path: ['right', 'right', 'down'],
      movesUsed: 3,
      stars: 3,
      won: true,
    });

    // Initial failed state
    controller.setCompletedStats({
      won: true,
      stars: 3,
      streak: 3,
      movesUsed: 3,
      completions: 42,
      confirmationStatus: 'pending',
    });

    // Click 1: initiates manual retry
    const promise1 = controller.submitRun(true);
    assert.strictEqual(fetchCalls, 1, 'First click should initiate exactly one fetch');
    assert.strictEqual(controller.isSubmissionInProgress(), true, 'Submission should be marked in progress');

    // Click 2: rapid duplicate click while Click 1 is in-flight
    const promise2 = controller.submitRun(true);
    assert.strictEqual(fetchCalls, 1, 'Second rapid click MUST NOT initiate an overlapping fetch');

    const result2 = await promise2;
    assert.strictEqual(result2, null, 'Overlapping second request should immediately return null');

    // Resolve click 1 successfully
    assert.ok(resolveFirstRequest, 'resolveFirstRequest should be defined');
    resolveFirstRequest(
      new Response(
        JSON.stringify({
          status: 'success',
          valid: true,
          won: true,
          lost: false,
          movesUsed: 3,
          stars: 3,
          deliveredCount: 1,
          movesLeft: 7,
          streak: 4,
          completions: 43,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result1 = await promise1;
    assert.ok(result1, 'First request should resolve with confirmed stats');
    assert.strictEqual(result1?.confirmationStatus, 'confirmed');
    assert.strictEqual(fetchCalls, 1, 'Total fetch calls must remain strictly 1');
  });

  void it('Regression 2: Stale request completing after run reset is safely discarded without corrupting new run state', async () => {
    let resolveStaleRequest: ((res: Response) => void) | undefined;

    const mockFetch = async () => {
      return new Promise<Response>((resolve) => {
        resolveStaleRequest = resolve;
      });
    };

    let stateUpdates = 0;
    const controller = new SubmissionController({
      fetchFn: mockFetch,
      delayFn: async () => {},
      onStateChange: () => {
        stateUpdates++;
      },
    });

    controller.setDailyData(createMockDailyData(1));
    const run1Id = controller.getCurrentRunId();

    controller.captureTerminalRun({
      dayIndex: 1,
      path: ['right', 'down'],
      movesUsed: 2,
      stars: 3,
      won: true,
    });

    // Start auto-submission for Run 1
    const run1Promise = controller.submitRun(false);
    assert.strictEqual(controller.isSubmissionInProgress(), true);

    // Player resets route while request is still pending
    const run2Id = controller.startNewRun();
    assert.strictEqual(run2Id, run1Id + 1, 'New runId should be incremented');
    assert.strictEqual(controller.getCompletedStats(), null, 'Completed stats must be cleared for new run');
    assert.strictEqual(controller.getActiveSnapshot(), null, 'Active snapshot must be cleared for new run');

    // Stale request for Run 1 now arrives with success
    assert.ok(resolveStaleRequest);
    resolveStaleRequest(
      new Response(
        JSON.stringify({
          status: 'success',
          valid: true,
          won: true,
          lost: false,
          movesUsed: 2,
          stars: 3,
          deliveredCount: 1,
          movesLeft: 8,
          streak: 4,
          completions: 43,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const run1Result = await run1Promise;
    assert.strictEqual(run1Result, null, 'Stale request for previous run must return null');
    assert.strictEqual(controller.getCompletedStats(), null, 'New run stats must remain unpolluted');
    assert.strictEqual(stateUpdates, 0, 'No state updates should be dispatched for stale run');
  });

  void it('Regression 3: Confirmed result is never downgraded to pending or rejected by an older or delayed request', async () => {
    let releaseDelay: (() => void) | undefined;
    const delayedGate = new Promise<void>((resolve) => {
      releaseDelay = resolve;
    });

    const mockFetch = async () => {
      return new Response(JSON.stringify({ status: 'retry_later' }), { status: 503 });
    };

    const controller = new SubmissionController({
      fetchFn: mockFetch,
      delayFn: async () => {
        await delayedGate;
      },
    });

    controller.setDailyData(createMockDailyData(1));
    controller.captureTerminalRun({
      dayIndex: 1,
      path: ['right', 'down'],
      movesUsed: 2,
      stars: 3,
      won: true,
    });

    // In-flight slow auto-submission starts and pauses in delayFn after attempt 1
    const slowSubmission = controller.submitRun(false);

    // While attempt 1 is paused before attempt 2, run is marked confirmed
    const confirmedStats: CompletedRunStats = {
      won: true,
      stars: 3,
      streak: 4,
      movesUsed: 2,
      completions: 43,
      confirmationStatus: 'confirmed',
    };
    controller.setCompletedStats(confirmedStats);

    // Unblock delayFn so attempt 2 proceeds and also returns 503
    assert.ok(releaseDelay);
    releaseDelay();

    const slowResult = await slowSubmission;

    // Must NOT be downgraded to pending or rejected
    assert.strictEqual(slowResult?.confirmationStatus, 'confirmed', 'Result from slow submission must remain confirmed');
    const finalStats = controller.getCompletedStats();
    assert.strictEqual(finalStats?.confirmationStatus, 'confirmed', 'Confirmed status must never be downgraded');
    assert.strictEqual(finalStats?.streak, 4);
  });

  void it('Regression 4: Automatic submission followed by manual retry preserves exact path and recovers to confirmed', async () => {
    const submittedBodies: string[] = [];
    let callCount = 0;

    const mockFetch = async (_url: string, init?: RequestInit) => {
      callCount++;
      if (init?.body && typeof init.body === 'string') {
        submittedBodies.push(init.body);
      }

      if (callCount <= 2) {
        // Auto-submit encounters 503 twice
        return new Response(JSON.stringify({ status: 'retry_later' }), { status: 503 });
      }

      // Manual retry succeeds
      return new Response(
        JSON.stringify({
          status: 'success',
          valid: true,
          won: true,
          lost: false,
          movesUsed: 4,
          stars: 2,
          deliveredCount: 1,
          movesLeft: 6,
          streak: 4,
          completions: 43,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const controller = new SubmissionController({
      fetchFn: mockFetch,
      delayFn: async () => {}, // Instant delay for test execution
    });

    controller.setDailyData(createMockDailyData(1));
    const originalPath: Direction[] = ['right', 'right', 'down', 'down'];
    controller.captureTerminalRun({
      dayIndex: 1,
      path: originalPath,
      movesUsed: 4,
      stars: 2,
      won: true,
    });

    // 1. Auto-submission runs with maxAttempts = 2
    const autoResult = await controller.submitRun(false);
    assert.strictEqual(autoResult?.confirmationStatus, 'pending', 'Failed auto-submit should land in pending');
    assert.strictEqual(callCount, 2, 'Auto-submit should have attempted 2 times on 503');

    // 2. Manual retry triggered
    const retryResult = await controller.submitRun(true);
    assert.strictEqual(retryResult?.confirmationStatus, 'confirmed', 'Manual retry should recover to confirmed');
    assert.strictEqual(callCount, 3, 'Manual retry should make exactly 1 attempt');

    // Verify all 3 requests submitted the EXACT identical path
    assert.strictEqual(submittedBodies.length, 3);
    for (const bodyStr of submittedBodies) {
      const parsed = JSON.parse(bodyStr);
      assert.deepStrictEqual(parsed.path, originalPath, 'Preserved path must be identical across retries');
    }
  });

  void it('Regression 5: Auto-submission guard resets cleanly when a genuinely new run starts after reset', async () => {
    let callCount = 0;
    const pathsReceived: string[][] = [];

    const mockFetch = async (_url: string, init?: RequestInit) => {
      callCount++;
      if (init?.body && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body);
        pathsReceived.push(parsed.path);
      }
      return new Response(
        JSON.stringify({
          status: 'success',
          valid: true,
          won: true,
          lost: false,
          movesUsed: 3,
          stars: 3,
          deliveredCount: 1,
          movesLeft: 7,
          streak: 4,
          completions: 43,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const controller = new SubmissionController({
      fetchFn: mockFetch,
      delayFn: async () => {},
    });

    controller.setDailyData(createMockDailyData(1));

    // Run 1: completes and auto-submits
    assert.strictEqual(controller.canAutoSubmit(), true, 'Run 1 should be eligible for auto-submission');
    controller.markAutoSubmitted();
    assert.strictEqual(controller.canAutoSubmit(), false, 'Run 1 cannot auto-submit twice');

    controller.captureTerminalRun({
      dayIndex: 1,
      path: ['up', 'left'],
      movesUsed: 2,
      stars: 3,
      won: true,
    });
    const run1Stats = await controller.submitRun(false);
    assert.strictEqual(run1Stats?.confirmationStatus, 'confirmed');
    assert.strictEqual(callCount, 1);

    // Player resets the route
    controller.startNewRun();

    // Run 2: is now eligible for auto-submission
    assert.strictEqual(controller.canAutoSubmit(), true, 'New Run 2 must be eligible for auto-submission');
    controller.markAutoSubmitted();

    controller.captureTerminalRun({
      dayIndex: 1,
      path: ['down', 'right', 'right'],
      movesUsed: 3,
      stars: 3,
      won: true,
    });

    const run2Stats = await controller.submitRun(false);
    assert.strictEqual(run2Stats?.confirmationStatus, 'confirmed');
    assert.strictEqual(callCount, 2, 'Run 2 must successfully submit to the server');

    assert.deepStrictEqual(pathsReceived, [['up', 'left'], ['down', 'right', 'right']], 'Both runs submitted their respective paths');
  });
});
