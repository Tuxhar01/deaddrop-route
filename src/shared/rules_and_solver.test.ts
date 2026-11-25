/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Coordinate, GameMap, Grid, TileType } from './types';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { computeStars, createInitialRunState, executeStep, getStepCost, GRID_SIZE, hasAffordableMovesFrom, isWithinBounds, replayPath, validateMap } from './rules.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { solveMap, solveMapDetailed } from './solver.ts';

const createTestMap = (options: {
  depot?: Coordinate;
  drops?: Coordinate[];
  par?: number;
  initialBudget?: number;
  tileOverrides?: Record<string, TileType>;
} = {}): GameMap => {
  const depot = options.depot ?? { x: 0, y: 0 };
  const drops = options.drops ?? [
    { x: 2, y: 0 },
    { x: 4, y: 0 },
    { x: 6, y: 0 },
  ];
  const par = options.par ?? 10;
  const initialBudget = options.initialBudget;
  const overrides = options.tileOverrides ?? {};

  const grid: Grid = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = `${x},${y}`;
      if (overrides[key]) {
        row.push(overrides[key]);
      } else if (x === depot.x && y === depot.y) {
        row.push('depot');
      } else if (drops.some((d) => d.x === x && d.y === y)) {
        row.push('drop');
      } else {
        row.push('road');
      }
    }
    grid.push(row);
  }

  return {
    grid,
    depot,
    drops,
    par,
    initialBudget,
  };
};

void describe('Shared Rules: Grid & Movement Bounds', () => {
  void it('validates 7x7 grid dimensions and coordinates', () => {
    assert.equal(isWithinBounds(0, 0), true);
    assert.equal(isWithinBounds(6, 6), true);
    assert.equal(isWithinBounds(7, 0), false);
    assert.equal(isWithinBounds(0, 7), false);
    assert.equal(isWithinBounds(-1, 0), false);
    assert.equal(isWithinBounds(0, -1), false);
  });

  void it('validates a correct map structure', () => {
    const map = createTestMap();
    const result = validateMap(map);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  void it('detects invalid map when depot is on a block tile', () => {
    const map = createTestMap({
      tileOverrides: { '0,0': 'block' },
    });
    const result = validateMap(map);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('block tile')));
  });

  void it('detects invalid map when parcel count is not exactly 3', () => {
    const map = createTestMap({
      drops: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    const result = validateMap(map);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('must have exactly 3 parcel drops')));
  });
});

void describe('Shared Rules: Blocked Moves & Step Rejection', () => {
  void it('rejects moving into a block tile and preserves position', () => {
    const map = createTestMap({
      tileOverrides: { '1,0': 'block' },
    });
    const state = createInitialRunState(map, 10);
    const { state: nextState, outcome } = executeStep(state, 'right', map);

    assert.equal(outcome.valid, false);
    assert.equal(outcome.reason, 'blocked');
    assert.equal(nextState.currentPosition.x, 0);
    assert.equal(nextState.currentPosition.y, 0);
    assert.equal(nextState.movesUsed, 0);
    assert.equal(nextState.movesLeft, 10);
  });

  void it('rejects moving out of grid bounds', () => {
    const map = createTestMap({ depot: { x: 0, y: 0 } });
    const state = createInitialRunState(map, 10);

    const { outcome: outUp } = executeStep(state, 'up', map);
    assert.equal(outUp.valid, false);
    assert.equal(outUp.reason, 'out_of_bounds');

    const { outcome: outLeft } = executeStep(state, 'left', map);
    assert.equal(outLeft.valid, false);
    assert.equal(outLeft.reason, 'out_of_bounds');
  });

  void it('fails path replay if any move hits a block or wall', () => {
    const map = createTestMap({
      tileOverrides: { '1,0': 'block' },
    });
    const result = replayPath(map, ['right', 'down'], 10);
    assert.equal(result.success, false);
    assert.equal(result.errorStep, 0);
    assert.equal(result.errorReason, 'blocked');
  });
});

void describe('Shared Rules: Congested Cost (2 moves)', () => {
  void it('deducts 2 moves and increases movesUsed by 2 when entering congested tile', () => {
    const map = createTestMap({
      tileOverrides: { '1,0': 'congested' },
    });
    const state = createInitialRunState(map, 10);

    assert.equal(getStepCost('congested'), 2);
    assert.equal(getStepCost('road'), 1);

    const { state: nextState, outcome } = executeStep(state, 'right', map);
    assert.equal(outcome.valid, true);
    assert.equal(outcome.cost, 2);
    assert.equal(nextState.movesUsed, 2);
    assert.equal(nextState.movesLeft, 8);
    assert.equal(nextState.currentPosition.x, 1);
    assert.equal(nextState.currentPosition.y, 0);
  });

  void it('rejects move without marking premature loss if courier cannot afford congested step cost (movesLeft < 2)', () => {
    const map = createTestMap({
      tileOverrides: { '1,0': 'congested' },
    });
    const state = createInitialRunState(map, 1); // only 1 move left

    const { state: nextState, outcome } = executeStep(state, 'right', map);
    assert.equal(outcome.valid, false);
    assert.equal(outcome.reason, 'insufficient_moves');
    assert.equal(nextState.lost, false);
    assert.equal(nextState.won, false);
    assert.equal(nextState.movesLeft, 1);
    assert.equal(nextState.currentPosition.x, 0);
    assert.equal(nextState.currentPosition.y, 0);
  });
});

void describe('Shared Rules: Relay Bonus (+2 once only)', () => {
  void it('grants +2 moves to remaining budget upon first visit to a relay tile', () => {
    const map = createTestMap({
      tileOverrides: { '1,0': 'relay' },
    });
    const state = createInitialRunState(map, 5);

    // Move right into relay: cost is 1, bonus is +2 -> net movesLeft: 5 - 1 + 2 = 6
    const { state: s1, outcome: o1 } = executeStep(state, 'right', map);
    assert.equal(o1.valid, true);
    assert.equal(o1.isRelayTriggered, true);
    assert.equal(s1.movesUsed, 1);
    assert.equal(s1.movesLeft, 6);
  });

  void it('does NOT grant relay bonus a second time when re-entering the same relay tile', () => {
    const map = createTestMap({
      tileOverrides: { '1,0': 'relay' },
    });
    const state = createInitialRunState(map, 5);

    // Step 1: depot (0,0) -> relay (1,0): movesUsed = 1, movesLeft = 5 - 1 + 2 = 6
    const { state: s1 } = executeStep(state, 'right', map);
    assert.equal(s1.movesLeft, 6);

    // Step 2: relay (1,0) -> road (2,0): movesUsed = 2, movesLeft = 6 - 1 = 5
    const { state: s2 } = executeStep(s1, 'right', map);
    assert.equal(s2.movesLeft, 5);

    // Step 3: road (2,0) -> back to relay (1,0): movesUsed = 3, movesLeft = 5 - 1 = 4 (NO +2 bonus!)
    const { state: s3, outcome: o3 } = executeStep(s2, 'left', map);
    assert.equal(o3.valid, true);
    assert.equal(o3.isRelayTriggered, false);
    assert.equal(s3.movesUsed, 3);
    assert.equal(s3.movesLeft, 4);
  });

  void it('handles multiple distinct relay tiles independently granting +2 each', () => {
    const map = createTestMap({
      tileOverrides: { '1,0': 'relay', '3,0': 'relay' },
    });

    // Path: (0,0) -> (1,0) [relay1] -> (2,0) [road] -> (3,0) [relay2]
    const result = replayPath(map, ['right', 'right', 'right'], 10);
    assert.equal(result.success, true);
    // movesUsed = 3; movesLeft = 10 - 3 + 2 (relay1) + 2 (relay2) = 11
    assert.equal(result.movesUsed, 3);
    assert.equal(result.movesLeft, 11);
  });
});

void describe('Shared Rules: Parcel Delivery in Any Order', () => {
  void it('allows delivery in order A -> B -> C', () => {
    const drops = [
      { x: 1, y: 0 }, // Drop 0
      { x: 2, y: 0 }, // Drop 1
      { x: 3, y: 0 }, // Drop 2
    ];
    const map = createTestMap({ drops, par: 5 });
    const result = replayPath(map, ['right', 'right', 'right'], 10);

    assert.equal(result.success, true);
    assert.equal(result.won, true);
    assert.equal(result.deliveredCount, 3);
    assert.equal(result.movesUsed, 3);
    assert.equal(result.stars, 3);
  });

  void it('allows delivery in reverse order C -> B -> A', () => {
    // Layout: depot at (0,1), drops at (1,0) [A], (2,0) [B], (3,0) [C]
    // Courier travels along row 1 to x=3, enters C, then moves left to B, then A
    const drops = [
      { x: 1, y: 0 }, // A
      { x: 2, y: 0 }, // B
      { x: 3, y: 0 }, // C
    ];
    const map = createTestMap({ depot: { x: 0, y: 1 }, drops, par: 10 });
    const moves: ('up' | 'down' | 'left' | 'right')[] = [
      'right',
      'right',
      'right',
      'up',
      'left',
      'left',
    ];
    const result = replayPath(map, moves, 10);

    assert.equal(result.success, true);
    assert.equal(result.won, true);
    assert.equal(result.deliveredCount, 3);
    assert.deepEqual(result.finalState.deliveredIndices, [2, 1, 0]);
  });

  void it('does not double count delivered count when re-entering an already delivered drop', () => {
    const drops = [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
      { x: 5, y: 0 },
    ];
    const map = createTestMap({ drops, par: 10 });

    // Step to drop 0 at (1,0), step back to depot (0,0), step to drop 0 at (1,0) again
    const result = replayPath(map, ['right', 'left', 'right'], 10);
    assert.equal(result.success, true);
    assert.equal(result.deliveredCount, 1);
  });
});

void describe('Shared Rules: Loss Conditions & Zero Moves', () => {
  void it('marks loss when moves reach 0 before all 3 parcels are delivered', () => {
    const map = createTestMap({
      drops: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 5, y: 0 },
      ],
      par: 5,
    });
    // Starting with budget = 2:
    // Move 1: right to (1,0) -> 1 drop delivered, movesLeft = 1
    // Move 2: right to (2,0) -> 2 drops delivered, movesLeft = 0 (parcels remaining: 1)
    const result = replayPath(map, ['right', 'right'], 2);

    assert.equal(result.success, true);
    assert.equal(result.won, false);
    assert.equal(result.lost, true);
    assert.equal(result.deliveredCount, 2);
    assert.equal(result.movesLeft, 0);
    assert.equal(result.stars, 0);
  });

  void it('wins on the exact final move if all 3 parcels are delivered even when movesLeft hits 0', () => {
    const drops = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const map = createTestMap({ drops, par: 5 });
    // Starting with exactly 3 budget:
    const result = replayPath(map, ['right', 'right', 'right'], 3);

    assert.equal(result.success, true);
    assert.equal(result.won, true);
    assert.equal(result.lost, false);
    assert.equal(result.movesLeft, 0);
    assert.equal(result.stars, 3);
  });

  void it('terminates with loss when courier enters dead-end with movesLeft > 0 but no affordable legal moves', () => {
    // Corridor: (0,0) road -> (1,0) congested (cost 2) -> (2,0) road (dead-end)
    // Neighbors of (2,0): (3,0) block, (2,1) block, (2,-1) OOB, and (1,0) congested (cost 2).
    // Starting with budget = 4:
    // Step 1: to (1,0) [cost 2] -> movesLeft = 2
    // Step 2: to (2,0) [cost 1] -> movesLeft = 1
    // At (2,0), movesLeft = 1. Only passable neighbor is (1,0), which costs 2.
    // hasAffordableMovesFrom returns false -> run immediately terminates as loss with valid step.
    const map = createTestMap({
      tileOverrides: {
        '1,0': 'congested',
        '2,0': 'road',
        '3,0': 'block',
        '2,1': 'block',
      },
    });

    const result = replayPath(map, ['right', 'right'], 4);
    assert.equal(result.success, true);
    assert.equal(result.won, false);
    assert.equal(result.lost, true);
    assert.equal(result.movesLeft, 1);
    assert.equal(result.stars, 0);
  });
});

void describe('Shared Rules: Star Rating Thresholds', () => {
  void it('awards 3 stars when movesUsed <= par', () => {
    assert.equal(computeStars(5, 10), 3);
    assert.equal(computeStars(10, 10), 3);
  });

  void it('awards 2 stars when par < movesUsed <= par + 2', () => {
    assert.equal(computeStars(11, 10), 2);
    assert.equal(computeStars(12, 10), 2);
  });

  void it('awards 1 star when movesUsed > par + 2', () => {
    assert.equal(computeStars(13, 10), 1);
    assert.equal(computeStars(25, 10), 1);
  });

  void it('awards 0 stars on loss in path replay', () => {
    const map = createTestMap({
      drops: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
      par: 10,
    });
    // Budget 2 for 3-step route
    const result = replayPath(map, ['right', 'right'], 2);
    assert.equal(result.lost, true);
    assert.equal(result.stars, 0);
  });
});

void describe('BFS Solver: Minimum Move Calculation', () => {
  void it('solves simple straight path to all 3 drops', () => {
    const drops = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const map = createTestMap({ drops });
    const minMoves = solveMap(map);
    assert.equal(minMoves, 3);
  });

  void it('respects congested tile cost = 2 when finding minimum moves', () => {
    // Map layout:
    // (0,0) Depot
    // (1,0) Congested (cost 2)
    // (0,1) Road, (1,1) Road
    // (2,0) Drop 0, (3,0) Drop 1, (4,0) Drop 2
    // Path 1 through (1,0):
    //   (0,0) -> (1,0)[congested: +2] -> (2,0)[drop 0: +1] = 3 moves to drop 0
    // Path 2 detour through (0,1) and (1,1):
    //   (0,0) -> (0,1)[road: +1] -> (1,1)[road: +1] -> (2,1)[road: +1] -> (2,0)[drop 0: +1] = 4 moves
    // The solver should take the congested tile since 3 < 4 moves!
    const drops = [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ];
    const map = createTestMap({
      drops,
      tileOverrides: { '1,0': 'congested' },
    });

    const minMoves = solveMap(map);
    // Path: (0,0) -> (1,0)[+2] -> (2,0)[+1] -> (3,0)[+1] -> (4,0)[+1] = 5 moves total
    assert.equal(minMoves, 5);
  });

  void it('chooses road detour over severely congested route', () => {
    const drops = [
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ];
    const map = createTestMap({
      drops,
      tileOverrides: {
        '1,0': 'congested',
        '2,0': 'congested',
      },
    });

    const detailed = solveMapDetailed(map);
    assert.ok(detailed !== null);
    assert.equal(detailed.minMoves, 5);
    assert.deepEqual(detailed.path, ['down', 'right', 'right', 'right', 'right']);
  });

  void it('uses relay tile bonus (+2 budget) to reach otherwise unreachable drops', () => {
    // Depot at (0,0). Drops at (4,0), (5,0), (6,0). Total moves required = 6.
    // If initialBudget is 5:
    // Without relay: 6 moves required > 5 budget -> unreachable!
    const drops = [
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 6, y: 0 },
    ];
    const mapWithoutRelay = createTestMap({ drops });
    assert.equal(solveMap(mapWithoutRelay, 5), null);

    // With a relay placed at (2,0):
    // Courier enters relay at move 2 (+2 budget added to movesLeft), allowing completion of all 6 moves!
    const mapWithRelay = createTestMap({
      drops,
      tileOverrides: { '2,0': 'relay' },
    });
    const minMovesWithRelay = solveMap(mapWithRelay, 5);
    assert.equal(minMovesWithRelay, 6);
  });

  void it('returns null when any drop is completely walled off by blocks', () => {
    const drops = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 6, y: 6 }, // walled off in the bottom-right corner
    ];
    const map = createTestMap({
      drops,
      tileOverrides: {
        '5,6': 'block',
        '6,5': 'block',
      },
    });
    assert.equal(solveMap(map), null);
  });

  void it('re-enters relay without double-granting bonus inside BFS exploration', () => {
    const drops = [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ];
    const map = createTestMap({
      drops,
      tileOverrides: { '1,0': 'relay' },
    });
    const detailed = solveMapDetailed(map, 10);
    assert.ok(detailed !== null);
    assert.equal(detailed.minMoves, 4);
    assert.deepEqual(detailed.path, ['right', 'right', 'right', 'right']);
  });
});
