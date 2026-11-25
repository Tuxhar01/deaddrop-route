import type {
  Coordinate,
  Direction,
  GameMap,
  Grid,
  MapValidationResult,
  PathReplayResult,
  RunState,
  StarRating,
  StepOutcome,
  TileType,
} from './types';

export const GRID_SIZE = 7;
export const TOTAL_DROPS = 3;

export const isValidTileType = (tile: string): tile is TileType => {
  return (
    tile === 'road' ||
    tile === 'block' ||
    tile === 'depot' ||
    tile === 'drop' ||
    tile === 'congested' ||
    tile === 'relay'
  );
};

export const isDirection = (val: string): val is Direction => {
  return val === 'up' || val === 'down' || val === 'left' || val === 'right';
};

export const isWithinBounds = (x: number, y: number): boolean => {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < GRID_SIZE &&
    y >= 0 &&
    y < GRID_SIZE
  );
};

export const isValidCoordinate = (coord: Coordinate): boolean => {
  return isWithinBounds(coord.x, coord.y);
};

export const isPassableTile = (tile: TileType): boolean => {
  return tile !== 'block';
};

export const getStepCost = (tile: TileType): number => {
  return tile === 'congested' ? 2 : 1;
};

export const getNextCoordinate = (coord: Coordinate, direction: Direction): Coordinate => {
  switch (direction) {
    case 'up':
      return { x: coord.x, y: coord.y - 1 };
    case 'down':
      return { x: coord.x, y: coord.y + 1 };
    case 'left':
      return { x: coord.x - 1, y: coord.y };
    case 'right':
      return { x: coord.x + 1, y: coord.y };
  }
};

export const validateGridDimensions = (grid: Grid): boolean => {
  if (grid.length !== GRID_SIZE) {
    return false;
  }
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = grid[r];
    if (!row || row.length !== GRID_SIZE) {
      return false;
    }
    for (let c = 0; c < GRID_SIZE; c++) {
      const tile = row[c];
      if (!tile || !isValidTileType(tile)) {
        return false;
      }
    }
  }
  return true;
};

export const validateMap = (map: GameMap): MapValidationResult => {
  const errors: string[] = [];

  if (!validateGridDimensions(map.grid)) {
    errors.push(`Grid dimensions must be exactly ${GRID_SIZE}x${GRID_SIZE} with valid tiles.`);
  }

  if (!isValidCoordinate(map.depot)) {
    errors.push(`Depot coordinate (${map.depot.x}, ${map.depot.y}) is out of bounds.`);
  } else {
    const depotRow = map.grid[map.depot.y];
    const depotTile = depotRow ? depotRow[map.depot.x] : undefined;
    if (depotTile === 'block') {
      errors.push('Depot cannot be placed on an impassable block tile.');
    }
  }

  if (map.drops.length !== TOTAL_DROPS) {
    errors.push(`Map must have exactly ${TOTAL_DROPS} parcel drops, got ${map.drops.length}.`);
  }

  const dropKeys = new Set<string>();
  for (let i = 0; i < map.drops.length; i++) {
    const drop = map.drops[i];
    if (!drop || !isValidCoordinate(drop)) {
      errors.push(`Drop #${i} is invalid or out of bounds.`);
      continue;
    }
    const dropKey = `${drop.x},${drop.y}`;
    if (dropKeys.has(dropKey)) {
      errors.push(`Duplicate drop coordinate at (${drop.x}, ${drop.y}).`);
    }
    dropKeys.add(dropKey);

    const dropRow = map.grid[drop.y];
    const dropTile = dropRow ? dropRow[drop.x] : undefined;
    if (dropTile === 'block') {
      errors.push(`Drop #${i} at (${drop.x}, ${drop.y}) cannot be on a block tile.`);
    }
  }

  if (map.par <= 0) {
    errors.push(`Map par must be a positive integer, got ${map.par}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export const hasAffordableMovesFrom = (
  position: Coordinate,
  movesLeft: number,
  map: GameMap
): boolean => {
  if (movesLeft <= 0) {
    return false;
  }
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  for (let i = 0; i < directions.length; i++) {
    const dir = directions[i]!;
    const nextCoord = getNextCoordinate(position, dir);
    if (!isWithinBounds(nextCoord.x, nextCoord.y)) {
      continue;
    }
    const row = map.grid[nextCoord.y];
    const tile = row ? row[nextCoord.x] : undefined;
    if (!tile || !isPassableTile(tile)) {
      continue;
    }
    if (movesLeft >= getStepCost(tile)) {
      return true;
    }
  }
  return false;
};

export const computeStars = (movesUsed: number, par: number): StarRating => {
  if (movesUsed <= par) {
    return 3;
  }
  if (movesUsed <= par + 2) {
    return 2;
  }
  return 1;
};

export const createInitialRunState = (map: GameMap, budget?: number): RunState => {
  const movesLeft = budget ?? map.initialBudget ?? map.par + 4;
  const initialPosition: Coordinate = { x: map.depot.x, y: map.depot.y };

  // Check if depot itself overlaps with any drop
  const deliveredIndices: number[] = [];
  let collectedMask = 0;
  for (let i = 0; i < map.drops.length; i++) {
    const drop = map.drops[i];
    if (drop && drop.x === initialPosition.x && drop.y === initialPosition.y) {
      deliveredIndices.push(i);
      collectedMask |= 1 << i;
    }
  }

  // Check if depot itself is on a relay tile
  const usedRelayKeys: string[] = [];
  let usedRelayMask = 0;
  let finalMovesLeft = movesLeft;
  const depotRow = map.grid[initialPosition.y];
  const depotTile = depotRow ? depotRow[initialPosition.x] : undefined;
  if (depotTile === 'relay') {
    const relayKey = `${initialPosition.x},${initialPosition.y}`;
    usedRelayKeys.push(relayKey);
    usedRelayMask = 1;
    finalMovesLeft += 2;
  }

  const isWon = deliveredIndices.length === TOTAL_DROPS;

  return {
    currentPosition: initialPosition,
    movesUsed: 0,
    movesLeft: finalMovesLeft,
    deliveredIndices,
    collectedMask,
    usedRelayKeys,
    usedRelayMask,
    won: isWon,
    lost: false,
    stars: isWon ? computeStars(0, map.par) : 0,
    history: [initialPosition],
  };
};

export const executeStep = (
  state: RunState,
  direction: Direction,
  map: GameMap
): { state: RunState; outcome: StepOutcome } => {
  if (state.won || state.lost) {
    const outcome: StepOutcome = {
      valid: false,
      reason: 'game_already_over',
      position: state.currentPosition,
      movesUsed: state.movesUsed,
      movesLeft: state.movesLeft,
      cost: 0,
      deliveredCount: state.deliveredIndices.length,
      isDelivered: false,
      isRelayTriggered: false,
      won: state.won,
      lost: state.lost,
    };
    return { state, outcome };
  }

  const targetCoord = getNextCoordinate(state.currentPosition, direction);

  if (!isValidCoordinate(targetCoord)) {
    const outcome: StepOutcome = {
      valid: false,
      reason: 'out_of_bounds',
      position: state.currentPosition,
      movesUsed: state.movesUsed,
      movesLeft: state.movesLeft,
      cost: 0,
      deliveredCount: state.deliveredIndices.length,
      isDelivered: false,
      isRelayTriggered: false,
      won: state.won,
      lost: state.lost,
    };
    return { state, outcome };
  }

  const row = map.grid[targetCoord.y];
  const tile = row ? row[targetCoord.x] : undefined;

  if (!tile || !isPassableTile(tile)) {
    const outcome: StepOutcome = {
      valid: false,
      reason: 'blocked',
      position: state.currentPosition,
      movesUsed: state.movesUsed,
      movesLeft: state.movesLeft,
      cost: 0,
      deliveredCount: state.deliveredIndices.length,
      isDelivered: false,
      isRelayTriggered: false,
      won: state.won,
      lost: state.lost,
    };
    return { state, outcome };
  }

  const stepCost = getStepCost(tile);

  if (state.movesLeft < stepCost) {
    const outcome: StepOutcome = {
      valid: false,
      reason: 'insufficient_moves',
      position: state.currentPosition,
      movesUsed: state.movesUsed,
      movesLeft: state.movesLeft,
      cost: stepCost,
      deliveredCount: state.deliveredIndices.length,
      isDelivered: false,
      isRelayTriggered: false,
      won: state.won,
      lost: state.lost,
    };
    return { state, outcome };
  }

  const newMovesUsed = state.movesUsed + stepCost;
  let newMovesLeft = state.movesLeft - stepCost;

  // Relay handling: at most once per relay tile per run
  let isRelayTriggered = false;
  const newUsedRelayKeys = [...state.usedRelayKeys];
  let newUsedRelayMask = state.usedRelayMask;
  const coordKey = `${targetCoord.x},${targetCoord.y}`;

  if (tile === 'relay' && !state.usedRelayKeys.includes(coordKey)) {
    isRelayTriggered = true;
    newMovesLeft += 2;
    newUsedRelayKeys.push(coordKey);
    // Find index of this relay if numbered
    newUsedRelayMask |= 1 << state.usedRelayKeys.length;
  }

  // Parcel delivery handling: at most once per drop
  let isDelivered = false;
  const newDeliveredIndices = [...state.deliveredIndices];
  let newCollectedMask = state.collectedMask;

  for (let i = 0; i < map.drops.length; i++) {
    const drop = map.drops[i];
    if (drop && drop.x === targetCoord.x && drop.y === targetCoord.y) {
      if (!newDeliveredIndices.includes(i)) {
        isDelivered = true;
        newDeliveredIndices.push(i);
        newCollectedMask |= 1 << i;
      }
      break;
    }
  }

  const deliveredCount = newDeliveredIndices.length;
  const won = deliveredCount === TOTAL_DROPS;
  const lost =
    !won && (newMovesLeft <= 0 || !hasAffordableMovesFrom(targetCoord, newMovesLeft, map));
  const stars: StarRating = won ? computeStars(newMovesUsed, map.par) : 0;

  const nextState: RunState = {
    currentPosition: targetCoord,
    movesUsed: newMovesUsed,
    movesLeft: newMovesLeft,
    deliveredIndices: newDeliveredIndices,
    collectedMask: newCollectedMask,
    usedRelayKeys: newUsedRelayKeys,
    usedRelayMask: newUsedRelayMask,
    won,
    lost,
    stars,
    history: [...state.history, targetCoord],
  };

  const outcome: StepOutcome = {
    valid: true,
    position: targetCoord,
    movesUsed: newMovesUsed,
    movesLeft: newMovesLeft,
    cost: stepCost,
    deliveredCount,
    isDelivered,
    isRelayTriggered,
    won,
    lost,
  };

  return { state: nextState, outcome };
};

export const step = (state: RunState, direction: Direction, map: GameMap): StepOutcome => {
  return executeStep(state, direction, map).outcome;
};

export const coordinateToDirection = (from: Coordinate, to: Coordinate): Direction | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return 'right';
  if (dx === -1 && dy === 0) return 'left';
  if (dx === 0 && dy === 1) return 'down';
  if (dx === 0 && dy === -1) return 'up';
  return null;
};

export const replayPath = (
  map: GameMap,
  path: Direction[] | Coordinate[],
  initialBudget?: number
): PathReplayResult => {
  let currentState = createInitialRunState(map, initialBudget);

  // If already won at initial state (e.g., all drops at depot, rare edge case)
  if (currentState.won) {
    return {
      success: true,
      finalState: currentState,
      movesUsed: currentState.movesUsed,
      movesLeft: currentState.movesLeft,
      deliveredCount: currentState.deliveredIndices.length,
      won: true,
      lost: false,
      stars: currentState.stars,
    };
  }

  if (path.length === 0) {
    return {
      success: true,
      finalState: currentState,
      movesUsed: currentState.movesUsed,
      movesLeft: currentState.movesLeft,
      deliveredCount: currentState.deliveredIndices.length,
      won: currentState.won,
      lost: currentState.lost,
      stars: currentState.stars,
    };
  }

  // Check whether path is Coordinate[] or Direction[]
  const firstItem = path[0];
  const isCoordPath = typeof firstItem === 'object' && firstItem !== null && 'x' in firstItem;

  const directions: Direction[] = [];
  if (isCoordPath) {
    let currentPoint = currentState.currentPosition;
    let startIndex = 0;

    // If the first coordinate in path is the start position (depot), start from index 1
    const firstCoord = path[0];
    if (
      typeof firstCoord === 'object' &&
      firstCoord !== null &&
      'x' in firstCoord &&
      firstCoord.x === currentPoint.x &&
      firstCoord.y === currentPoint.y
    ) {
      startIndex = 1;
    }

    for (let i = startIndex; i < path.length; i++) {
      const nextCoord = path[i];
      if (!nextCoord || typeof nextCoord !== 'object' || !('x' in nextCoord)) {
        return {
          success: false,
          finalState: currentState,
          movesUsed: currentState.movesUsed,
          movesLeft: currentState.movesLeft,
          deliveredCount: currentState.deliveredIndices.length,
          won: currentState.won,
          lost: currentState.lost,
          stars: currentState.stars,
          errorStep: i,
          errorReason: 'invalid_step',
        };
      }
      const dir = coordinateToDirection(currentPoint, nextCoord);
      if (!dir) {
        return {
          success: false,
          finalState: currentState,
          movesUsed: currentState.movesUsed,
          movesLeft: currentState.movesLeft,
          deliveredCount: currentState.deliveredIndices.length,
          won: currentState.won,
          lost: currentState.lost,
          stars: currentState.stars,
          errorStep: i,
          errorReason: 'invalid_step',
        };
      }
      directions.push(dir);
      currentPoint = nextCoord;
    }
  } else {
    for (let i = 0; i < path.length; i++) {
      const item = path[i];
      if (typeof item === 'string' && isDirection(item)) {
        directions.push(item);
      } else {
        return {
          success: false,
          finalState: currentState,
          movesUsed: currentState.movesUsed,
          movesLeft: currentState.movesLeft,
          deliveredCount: currentState.deliveredIndices.length,
          won: currentState.won,
          lost: currentState.lost,
          stars: currentState.stars,
          errorStep: i,
          errorReason: 'invalid_step',
        };
      }
    }
  }

  for (let i = 0; i < directions.length; i++) {
    const dir = directions[i];
    if (!dir) continue;

    const { state: nextState, outcome } = executeStep(currentState, dir, map);
    currentState = nextState;

    if (!outcome.valid) {
      return {
        success: false,
        finalState: currentState,
        movesUsed: currentState.movesUsed,
        movesLeft: currentState.movesLeft,
        deliveredCount: currentState.deliveredIndices.length,
        won: currentState.won,
        lost: currentState.lost,
        stars: currentState.stars,
        errorStep: i,
        errorReason: outcome.reason,
      };
    }

    if (currentState.won) {
      return {
        success: true,
        finalState: currentState,
        movesUsed: currentState.movesUsed,
        movesLeft: currentState.movesLeft,
        deliveredCount: currentState.deliveredIndices.length,
        won: true,
        lost: false,
        stars: currentState.stars,
      };
    }
  }

  return {
    success: true,
    finalState: currentState,
    movesUsed: currentState.movesUsed,
    movesLeft: currentState.movesLeft,
    deliveredCount: currentState.deliveredIndices.length,
    won: currentState.won,
    lost: currentState.lost,
    stars: currentState.stars,
  };
};
