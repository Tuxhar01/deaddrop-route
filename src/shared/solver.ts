// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { GRID_SIZE, TOTAL_DROPS, getNextCoordinate, getStepCost, isPassableTile, isValidCoordinate } from './rules.ts';
import type { Coordinate, Direction, GameMap, SolverOutput } from './types';

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

type BFSNode = {
  x: number;
  y: number;
  movesLeft: number;
  movesUsed: number;
  collectedMask: number;
  usedRelayMask: number;
  path: Direction[];
};

export const solveMapDetailed = (
  map: GameMap,
  initialBudget?: number
): SolverOutput | null => {
  const budget = initialBudget ?? map.initialBudget ?? 999;

  // Extract all relay coordinates from map
  const relays: Coordinate[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    const row = map.grid[y];
    if (!row) continue;
    for (let x = 0; x < GRID_SIZE; x++) {
      if (row[x] === 'relay') {
        relays.push({ x, y });
      }
    }
  }

  // Initial collected mask if depot is on a drop
  let initCollectedMask = 0;
  for (let i = 0; i < map.drops.length; i++) {
    const drop = map.drops[i];
    if (drop && drop.x === map.depot.x && drop.y === map.depot.y) {
      initCollectedMask |= 1 << i;
    }
  }

  // Initial relay mask if depot is on a relay
  let initRelayMask = 0;
  let initMovesLeft = budget;
  for (let i = 0; i < relays.length; i++) {
    const r = relays[i];
    if (r && r.x === map.depot.x && r.y === map.depot.y) {
      initRelayMask |= 1 << i;
      initMovesLeft += 2;
    }
  }

  const goalMask = (1 << TOTAL_DROPS) - 1;

  if (initCollectedMask === goalMask) {
    return {
      minMoves: 0,
      path: [],
      finalMovesLeft: initMovesLeft,
    };
  }

  // Bucketed priority queue for BFS with edge costs 1 and 2 (Dial's algorithm)
  const buckets: BFSNode[][] = [];
  const startNode: BFSNode = {
    x: map.depot.x,
    y: map.depot.y,
    movesLeft: initMovesLeft,
    movesUsed: 0,
    collectedMask: initCollectedMask,
    usedRelayMask: initRelayMask,
    path: [],
  };

  buckets[0] = [startNode];

  // Visited set: track maximum movesLeft seen for each (x, y, collectedMask, usedRelayMask)
  const visitedMaxMovesLeft = new Map<string, number>();
  const startKey = `${map.depot.x},${map.depot.y},${initCollectedMask},${initRelayMask}`;
  visitedMaxMovesLeft.set(startKey, initMovesLeft);

  let currentCost = 0;

  while (currentCost < buckets.length) {
    const bucket = buckets[currentCost];
    if (!bucket || bucket.length === 0) {
      currentCost++;
      continue;
    }

    const current = bucket.shift();
    if (!current) {
      continue;
    }

    // Goal check: first time we pop a state with all drops collected is guaranteed to be minimal movesUsed
    if (current.collectedMask === goalMask) {
      return {
        minMoves: current.movesUsed,
        path: current.path,
        finalMovesLeft: current.movesLeft,
      };
    }

    const stateKey = `${current.x},${current.y},${current.collectedMask},${current.usedRelayMask}`;
    const bestMovesLeft = visitedMaxMovesLeft.get(stateKey);
    if (bestMovesLeft !== undefined && current.movesLeft < bestMovesLeft) {
      // Dominated by an earlier or equal-cost path that had more movesLeft
      continue;
    }

    for (let d = 0; d < DIRECTIONS.length; d++) {
      const dir = DIRECTIONS[d];
      if (!dir) continue;

      const nextCoord = getNextCoordinate({ x: current.x, y: current.y }, dir);
      if (!isValidCoordinate(nextCoord)) {
        continue;
      }

      const row = map.grid[nextCoord.y];
      const tile = row ? row[nextCoord.x] : undefined;
      if (!tile || !isPassableTile(tile)) {
        continue;
      }

      const cost = getStepCost(tile);
      if (current.movesLeft < cost) {
        // Cannot afford move
        continue;
      }

      const nextMovesUsed = current.movesUsed + cost;
      let nextMovesLeft = current.movesLeft - cost;
      let nextRelayMask = current.usedRelayMask;

      if (tile === 'relay') {
        for (let r = 0; r < relays.length; r++) {
          const relay = relays[r];
          if (relay && relay.x === nextCoord.x && relay.y === nextCoord.y) {
            const relayBit = 1 << r;
            if ((nextRelayMask & relayBit) === 0) {
              nextRelayMask |= relayBit;
              nextMovesLeft += 2;
            }
            break;
          }
        }
      }

      let nextCollectedMask = current.collectedMask;
      for (let p = 0; p < map.drops.length; p++) {
        const drop = map.drops[p];
        if (drop && drop.x === nextCoord.x && drop.y === nextCoord.y) {
          nextCollectedMask |= 1 << p;
          break;
        }
      }

      const nextStateKey = `${nextCoord.x},${nextCoord.y},${nextCollectedMask},${nextRelayMask}`;
      const prevBest = visitedMaxMovesLeft.get(nextStateKey);
      if (prevBest !== undefined && nextMovesLeft <= prevBest) {
        continue;
      }

      visitedMaxMovesLeft.set(nextStateKey, nextMovesLeft);

      const nextNode: BFSNode = {
        x: nextCoord.x,
        y: nextCoord.y,
        movesLeft: nextMovesLeft,
        movesUsed: nextMovesUsed,
        collectedMask: nextCollectedMask,
        usedRelayMask: nextRelayMask,
        path: [...current.path, dir],
      };

      const targetBucket = buckets[nextMovesUsed];
      if (!targetBucket) {
        buckets[nextMovesUsed] = [nextNode];
      } else {
        targetBucket.push(nextNode);
      }
    }
  }

  return null;
};

export const solveMap = (map: GameMap, initialBudget?: number): number | null => {
  const result = solveMapDetailed(map, initialBudget);
  return result ? result.minMoves : null;
};

export const solveMapBFS = solveMap;
export const findMinMoves = solveMap;
