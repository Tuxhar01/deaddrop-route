import { useCallback, useState } from 'react';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { createInitialRunState, executeStep, getStepCost, GRID_SIZE, isPassableTile, isWithinBounds, TOTAL_DROPS } from '../../shared/rules.ts';
import type { Coordinate, Direction, GameMap, RunState, StarRating, StepOutcome } from '../../shared/types';

export type RunSession = {
  state: RunState;
  movePath: Direction[];
  lastOutcome?: StepOutcome | undefined;
};

export const createRunSession = (map: GameMap, budget?: number): RunSession => ({
  state: createInitialRunState(map, budget),
  movePath: [],
  lastOutcome: undefined,
});

export const getDirectionBetweenCoordinates = (
  from: Coordinate,
  to: Coordinate
): Direction | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === -1) return 'up';
  if (dx === 0 && dy === 1) return 'down';
  if (dx === -1 && dy === 0) return 'left';
  if (dx === 1 && dy === 0) return 'right';

  return null;
};

export const applyRunStep = (
  session: RunSession,
  direction: Direction,
  map: GameMap
): { nextSession: RunSession; outcome: StepOutcome } => {
  const { state: nextState, outcome } = executeStep(session.state, direction, map);

  const nextSession: RunSession = {
    state: nextState,
    movePath: outcome.valid ? [...session.movePath, direction] : session.movePath,
    lastOutcome: outcome,
  };

  return { nextSession, outcome };
};

export type UseRunOptions = {
  initialBudget?: number | undefined;
};

export type UseRunReturn = {
  state: RunState | null;
  courierPosition: Coordinate | null;
  movesUsed: number;
  movesLeft: number;
  deliveredIndices: number[];
  deliveredCount: number;
  usedRelayKeys: string[];
  won: boolean;
  lost: boolean;
  isActive: boolean;
  stars: StarRating;
  movePath: Direction[];
  history: Coordinate[];
  lastOutcome: StepOutcome | null;
  step: (direction: Direction) => StepOutcome | null;
  moveToCoordinate: (target: Coordinate) => StepOutcome | null;
  reset: () => void;
  canMoveTo: (target: Coordinate) => boolean;
};

export const useRun = (
  map: GameMap | null,
  options?: UseRunOptions
): UseRunReturn => {
  const initialBudget = options?.initialBudget;
  const [prevMap, setPrevMap] = useState<GameMap | null>(map);
  const [session, setSession] = useState<RunSession | null>(() =>
    map ? createRunSession(map, initialBudget) : null
  );

  // Synchronize state when map changes without an effect
  if (map !== prevMap) {
    setPrevMap(map);
    setSession(map ? createRunSession(map, initialBudget) : null);
  }

  const step = useCallback(
    (direction: Direction): StepOutcome | null => {
      if (!map) return null;

      const currentSession = session ?? createRunSession(map, initialBudget);
      const { nextSession, outcome } = applyRunStep(currentSession, direction, map);

      setSession(nextSession);
      return outcome;
    },
    [map, session, initialBudget]
  );

  const moveToCoordinate = useCallback(
    (target: Coordinate): StepOutcome | null => {
      if (!map) return null;
      const currentSession = session ?? createRunSession(map, initialBudget);
      const dir = getDirectionBetweenCoordinates(currentSession.state.currentPosition, target);
      if (!dir) return null;
      return step(dir);
    },
    [map, session, step, initialBudget]
  );

  const reset = useCallback(() => {
    if (map) {
      setSession(createRunSession(map, initialBudget));
    } else {
      setSession(null);
    }
  }, [map, initialBudget]);

  const canMoveTo = useCallback(
    (target: Coordinate): boolean => {
      if (!map || !session || session.state.won || session.state.lost) return false;
      const dir = getDirectionBetweenCoordinates(session.state.currentPosition, target);
      if (!dir) return false;
      if (!isWithinBounds(target.x, target.y)) return false;
      const row = map.grid[target.y];
      const tile = row ? row[target.x] : undefined;
      return (
        tile !== undefined &&
        isPassableTile(tile) &&
        session.state.movesLeft >= getStepCost(tile)
      );
    },
    [map, session]
  );

  const currentState = session?.state ?? null;

  return {
    state: currentState,
    courierPosition: currentState?.currentPosition ?? null,
    movesUsed: currentState?.movesUsed ?? 0,
    movesLeft: currentState?.movesLeft ?? 0,
    deliveredIndices: currentState?.deliveredIndices ?? [],
    deliveredCount: currentState?.deliveredIndices.length ?? 0,
    usedRelayKeys: currentState?.usedRelayKeys ?? [],
    won: currentState?.won ?? false,
    lost: currentState?.lost ?? false,
    isActive: Boolean(currentState && !currentState.won && !currentState.lost),
    stars: currentState?.stars ?? 0,
    movePath: session?.movePath ?? [],
    history: currentState?.history ?? [],
    lastOutcome: session?.lastOutcome ?? null,
    step,
    moveToCoordinate,
    reset,
    canMoveTo,
  };
};

export { GRID_SIZE, TOTAL_DROPS };
