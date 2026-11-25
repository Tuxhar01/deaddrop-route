/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Direction, GameMap } from '../../shared/types';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { applyRunStep, createRunSession, getDirectionBetweenCoordinates } from './useRun.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { executeStep, replayPath } from '../../shared/rules.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { SEEDS } from '../../shared/dates.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { solveMapDetailed } from '../../shared/solver.ts';

void describe('useRun Hook State & Step Logic Parity', () => {
  const seedMap: GameMap = SEEDS[0]!;

  void it('calculates cardinal direction between adjacent coordinates correctly', () => {
    const origin = { x: 3, y: 3 };

    assert.strictEqual(getDirectionBetweenCoordinates(origin, { x: 3, y: 2 }), 'up');
    assert.strictEqual(getDirectionBetweenCoordinates(origin, { x: 3, y: 4 }), 'down');
    assert.strictEqual(getDirectionBetweenCoordinates(origin, { x: 2, y: 3 }), 'left');
    assert.strictEqual(getDirectionBetweenCoordinates(origin, { x: 4, y: 3 }), 'right');

    // Diagonal or non-adjacent should return null
    assert.strictEqual(getDirectionBetweenCoordinates(origin, { x: 4, y: 4 }), null);
    assert.strictEqual(getDirectionBetweenCoordinates(origin, { x: 3, y: 5 }), null);
    assert.strictEqual(getDirectionBetweenCoordinates(origin, { x: 3, y: 3 }), null);
  });

  void it('replays a fixed winning sequence with 100% parity against src/shared/rules.ts', () => {
    const solved = solveMapDetailed(seedMap);
    assert.ok(solved, 'Seed map should be solvable');
    const moveSequence: Direction[] = solved.path;

    // 1. Run through useRun hook logic (createRunSession + applyRunStep)
    let hookSession = createRunSession(seedMap);

    // 2. Step-by-step parallel verification with executeStep
    let directState = hookSession.state;

    for (let i = 0; i < moveSequence.length; i++) {
      const dir = moveSequence[i]!;

      const { nextSession, outcome: hookOutcome } = applyRunStep(hookSession, dir, seedMap);
      const { state: nextDirectState, outcome: directOutcome } = executeStep(
        directState,
        dir,
        seedMap
      );

      // Verify identical outcome at every step
      assert.strictEqual(hookOutcome.valid, directOutcome.valid);
      assert.strictEqual(hookOutcome.movesUsed, directOutcome.movesUsed);
      assert.strictEqual(hookOutcome.movesLeft, directOutcome.movesLeft);
      assert.strictEqual(hookOutcome.deliveredCount, directOutcome.deliveredCount);
      assert.strictEqual(hookOutcome.position.x, directOutcome.position.x);
      assert.strictEqual(hookOutcome.position.y, directOutcome.position.y);

      // Verify session state matches rules state
      assert.deepStrictEqual(nextSession.state.currentPosition, nextDirectState.currentPosition);
      assert.strictEqual(nextSession.state.movesLeft, nextDirectState.movesLeft);
      assert.strictEqual(nextSession.state.movesUsed, nextDirectState.movesUsed);
      assert.strictEqual(
        nextSession.state.deliveredIndices.length,
        nextDirectState.deliveredIndices.length
      );

      hookSession = nextSession;
      directState = nextDirectState;
    }

    // 3. Compare with full path replay helper
    const replayResult = replayPath(seedMap, moveSequence);

    assert.strictEqual(hookSession.state.won, true);
    assert.strictEqual(hookSession.state.won, replayResult.won);
    assert.strictEqual(hookSession.state.movesUsed, replayResult.movesUsed);
    assert.strictEqual(hookSession.state.movesLeft, replayResult.movesLeft);
    assert.strictEqual(hookSession.state.deliveredIndices.length, replayResult.deliveredCount);
    assert.strictEqual(hookSession.state.stars, replayResult.stars);
    assert.deepStrictEqual(hookSession.movePath, moveSequence);
  });

  void it('handles illegal blocked moves identically to src/shared/rules.ts', () => {
    const hookSession = createRunSession(seedMap);
    const initialPos = hookSession.state.currentPosition;

    // Find an impassable direction or test moving into walls/blocks
    const { nextSession, outcome } = applyRunStep(hookSession, 'up', seedMap);
    const directResult = executeStep(hookSession.state, 'up', seedMap);

    assert.strictEqual(outcome.valid, directResult.outcome.valid);
    assert.strictEqual(outcome.reason, directResult.outcome.reason);
    assert.strictEqual(nextSession.movePath.length, 0, 'movePath should not record illegal steps');
    assert.deepStrictEqual(nextSession.state.currentPosition, initialPos);
  });

  void it('rejects unaffordable congested move without declaring loss or recording step', () => {
    const map = SEEDS[0]!;
    // Create session with default budget (19) ending at (2,6) where (3,6) is congested (cost 2)
    const session = createRunSession(map);
    const pathPrefix: Direction[] = [
      'down', 'down', 'right', 'right',
      'down', 'down',
      'left', 'left', 'down', 'down', 'right', 'right',
      'left', 'right',
      'left', 'right',
      'left', 'right',
    ];

    let current = session;
    for (const dir of pathPrefix) {
      current = applyRunStep(current, dir, map).nextSession;
    }

    assert.strictEqual(current.state.currentPosition.x, 2);
    assert.strictEqual(current.state.currentPosition.y, 6);
    assert.strictEqual(current.state.movesLeft, 1);
    assert.strictEqual(current.state.lost, false);

    // Attempt to step right into (3,6) which is congested (cost 2)
    const { nextSession, outcome } = applyRunStep(current, 'right', map);

    assert.strictEqual(outcome.valid, false);
    assert.strictEqual(outcome.reason, 'insufficient_moves');
    assert.strictEqual(outcome.lost, false);
    assert.strictEqual(nextSession.state.lost, false);
    assert.strictEqual(nextSession.state.movesLeft, 1);
    assert.strictEqual(nextSession.movePath.length, 18, 'movePath must not record unaffordable step');

    // Courier now takes an affordable step left to (1,6) (cost 1)
    const finalStep = applyRunStep(nextSession, 'left', map);
    assert.strictEqual(finalStep.outcome.valid, true);
    assert.strictEqual(finalStep.nextSession.state.movesLeft, 0);
    assert.strictEqual(finalStep.nextSession.state.lost, true);
    assert.strictEqual(finalStep.nextSession.movePath.length, 19, 'movePath must include the move that exhausted budget');

    // Server replay of this valid terminal path must succeed
    const replay = replayPath(map, finalStep.nextSession.movePath);
    assert.strictEqual(replay.success, true);
    assert.strictEqual(replay.lost, true);
    assert.strictEqual(replay.won, false);
  });
});
