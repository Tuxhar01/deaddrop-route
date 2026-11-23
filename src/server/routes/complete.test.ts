/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { complete } from './complete.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { validateRunSubmission } from '../services/validate.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap, getUtcDayIndex } from '../../shared/dates.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { solveMapDetailed } from '../../shared/solver.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getNextCoordinate, isWithinBounds } from '../../shared/rules.ts';
import type { CompleteResponse, Direction, GameMap } from '../../shared/types';

void describe('POST /api/complete & Server Path Validation', () => {
  const currentDay = getUtcDayIndex();
  const todayMap: GameMap = getDailyMap(currentDay);

  void it('accepts a valid winning path and returns validated scores (case 1: valid win)', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved, 'Daily map should be solvable');

    // 1. Test direct service validation
    const directResult = validateRunSubmission({
      dayIndex: currentDay,
      path: solved.path,
    });

    assert.strictEqual(directResult.valid, true);
    assert.strictEqual(directResult.won, true);
    assert.strictEqual(directResult.lost, false);
    assert.strictEqual(directResult.deliveredCount, 3);
    assert.strictEqual(directResult.movesUsed, solved.minMoves);
    assert.strictEqual(directResult.stars, 3);

    // 2. Test HTTP route via Hono request
    const res = await complete.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: currentDay,
        path: solved.path,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body: CompleteResponse = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.valid, true);
    assert.strictEqual(body.won, true);
    assert.strictEqual(body.lost, false);
    assert.strictEqual(body.movesUsed, solved.minMoves);
    assert.strictEqual(body.stars, 3);
  });

  void it('rejects step into a block tile or out of bounds (case 2: invalid step)', async () => {
    // Find an illegal move from depot (either out of bounds or into block)
    const depot = todayMap.depot;
    const directions: Direction[] = ['up', 'down', 'left', 'right'];
    let illegalDir: Direction | null = null;

    for (const dir of directions) {
      const nextCoord = getNextCoordinate(depot, dir);
      if (!isWithinBounds(nextCoord.x, nextCoord.y)) {
        illegalDir = dir;
        break;
      }
      const tile = todayMap.grid[nextCoord.y]?.[nextCoord.x];
      if (tile === 'block') {
        illegalDir = dir;
        break;
      }
    }

    const testPath: Direction[] = illegalDir ? [illegalDir] : ['up', 'up', 'up', 'up', 'up', 'up', 'up'];

    const res = await complete.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: currentDay,
        path: testPath,
      }),
    });

    assert.strictEqual(res.status, 400);
    const body: CompleteResponse = await res.json();
    if (body.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(body.valid, false);
    assert.ok(
      body.error === 'blocked' || body.error === 'out_of_bounds',
      `Expected 'blocked' or 'out_of_bounds', got ${body.error}`
    );
  });

  void it('rejects paths that exceed move budget (case 3: over budget / unaffordable)', async () => {
    const depot = todayMap.depot;
    let forwardDir: Direction;
    let reverseDir: Direction;

    if (depot.x + 1 < 7 && todayMap.grid[depot.y]?.[depot.x + 1] !== 'block') {
      forwardDir = 'right';
      reverseDir = 'left';
    } else if (depot.x - 1 >= 0 && todayMap.grid[depot.y]?.[depot.x - 1] !== 'block') {
      forwardDir = 'left';
      reverseDir = 'right';
    } else if (depot.y + 1 < 7 && todayMap.grid[depot.y + 1]?.[depot.x] !== 'block') {
      forwardDir = 'down';
      reverseDir = 'up';
    } else {
      forwardDir = 'up';
      reverseDir = 'down';
    }

    const budget = todayMap.initialBudget ?? todayMap.par + 4;
    const exhaustingPath: Direction[] = [];
    for (let i = 0; i < budget + 6; i++) {
      exhaustingPath.push(i % 2 === 0 ? forwardDir : reverseDir);
    }

    const res = await complete.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: currentDay,
        path: exhaustingPath,
      }),
    });

    assert.strictEqual(res.status, 400);
    const body: CompleteResponse = await res.json();
    if (body.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(body.valid, false);
    assert.ok(
      body.error === 'insufficient_moves' || body.error === 'game_already_over',
      `Expected 'insufficient_moves' or 'game_already_over', got ${body.error}`
    );
  });

  void it('rejects submission for wrong dayIndex (case 4: wrong dayIndex)', async () => {
    const solved = solveMapDetailed(todayMap);
    assert.ok(solved);

    const wrongDay = currentDay + 1;
    const res = await complete.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: wrongDay,
        path: solved.path,
      }),
    });

    assert.strictEqual(res.status, 400);
    const body: CompleteResponse = await res.json();
    if (body.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(body.valid, false);
    assert.strictEqual(body.error, 'invalid_day_index');
  });

  void it('rejects tampered or non-terminal paths (case 5: tampered path)', async () => {
    // 5a. Empty path
    const resEmpty = await complete.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: currentDay,
        path: [],
      }),
    });
    assert.strictEqual(resEmpty.status, 400);
    const bodyEmpty: CompleteResponse = await resEmpty.json();
    if (bodyEmpty.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(bodyEmpty.error, 'malformed_path');

    // 5b. Invalid direction in array
    const resInvalidDir = await complete.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: currentDay,
        path: ['up', 'warp_to_exit'],
      }),
    });
    assert.strictEqual(resInvalidDir.status, 400);
    const bodyInvalidDir: CompleteResponse = await resInvalidDir.json();
    if (bodyInvalidDir.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(bodyInvalidDir.error, 'malformed_path');

    // 5c. Path terminates early without reaching win or loss (non-terminal state)
    const depot = todayMap.depot;
    let singleValidDir: Direction = 'right';
    for (const d of ['right', 'left', 'down', 'up'] as Direction[]) {
      const target = getNextCoordinate(depot, d);
      if (isWithinBounds(target.x, target.y) && todayMap.grid[target.y]?.[target.x] !== 'block') {
        singleValidDir = d;
        break;
      }
    }

    const resNonTerminal = await complete.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayIndex: currentDay,
        path: [singleValidDir],
      }),
    });
    assert.strictEqual(resNonTerminal.status, 400);
    const bodyNonTerminal: CompleteResponse = await resNonTerminal.json();
    if (bodyNonTerminal.status !== 'error') {
      assert.fail('Expected error response');
    }
    assert.strictEqual(bodyNonTerminal.error, 'non_terminal_state');
  });
});
