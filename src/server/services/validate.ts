// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap, getUtcDayIndex } from '../../shared/dates.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { replayPath } from '../../shared/rules.ts';
import type { Coordinate, Direction, StarRating } from '../../shared/types';

export type ValidationOutcome =
  | {
      valid: true;
      won: boolean;
      lost: boolean;
      movesUsed: number;
      stars: StarRating;
      deliveredCount: number;
      movesLeft: number;
      visitedCoordinates: Coordinate[];
    }
  | {
      valid: false;
      error: string;
      message: string;
      step?: number | undefined;
    };

const isDirection = (val: unknown): val is Direction => {
  return val === 'up' || val === 'down' || val === 'left' || val === 'right';
};

const isRecord = (val: unknown): val is Record<string, unknown> => {
  return typeof val === 'object' && val !== null;
};

export const validateRunSubmission = (
  payload: unknown,
  expectedDayIndex?: number
): ValidationOutcome => {
  if (!isRecord(payload)) {
    return {
      valid: false,
      error: 'invalid_payload',
      message: 'Request payload must be a JSON object',
    };
  }

  const { dayIndex, path } = payload;

  // 1. Validate dayIndex
  if (typeof dayIndex !== 'number' || !Number.isInteger(dayIndex)) {
    return {
      valid: false,
      error: 'invalid_day_index',
      message: 'dayIndex must be an integer',
    };
  }

  const currentDayIndex = expectedDayIndex ?? getUtcDayIndex();
  if (dayIndex !== currentDayIndex) {
    return {
      valid: false,
      error: 'invalid_day_index',
      message: `dayIndex ${dayIndex} does not match current UTC dayIndex ${currentDayIndex}`,
    };
  }

  // 2. Validate path structure
  if (!Array.isArray(path)) {
    return {
      valid: false,
      error: 'malformed_path',
      message: 'path must be an array of directions',
    };
  }

  if (path.length === 0) {
    return {
      valid: false,
      error: 'malformed_path',
      message: 'path must not be empty',
    };
  }

  const directions: Direction[] = [];
  for (let i = 0; i < path.length; i++) {
    const item = path[i];
    if (!isDirection(item)) {
      return {
        valid: false,
        error: 'malformed_path',
        message: `Invalid direction "${String(item)}" at step ${i}`,
        step: i,
      };
    }
    directions.push(item);
  }

  // 3. Retrieve today's seed map
  const map = getDailyMap(currentDayIndex);

  // 4. Replay path through deterministic shared rules
  const replay = replayPath(map, directions);

  if (!replay.success) {
    const errorReason = replay.errorReason ?? 'invalid_step';
    return {
      valid: false,
      error: errorReason,
      message: `Step execution failed at step ${replay.errorStep ?? 'unknown'}: ${errorReason}`,
      ...(replay.errorStep !== undefined ? { step: replay.errorStep } : {}),
    };
  }

  // 5. Must reach a terminal win or loss state
  if (!replay.won && !replay.lost) {
    return {
      valid: false,
      error: 'non_terminal_state',
      message: 'Path terminated before reaching a valid win or loss state',
    };
  }

  return {
    valid: true,
    won: replay.won,
    lost: replay.lost,
    movesUsed: replay.movesUsed,
    stars: replay.stars,
    deliveredCount: replay.deliveredCount,
    movesLeft: replay.movesLeft,
    visitedCoordinates: replay.finalState.history,
  };
};
