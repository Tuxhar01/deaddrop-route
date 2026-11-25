import { Board } from '../components/Board';
import type { Coordinate, Direction, GameMap, RunState } from '../../shared/types';

export type PlayScreenProps = {
  dayIndex: number;
  map: GameMap;
  runState: RunState;
  onStep: (direction: Direction) => void;
  onMoveToCoordinate: (coord: Coordinate) => void;
  onReset: () => void;
  disabled?: boolean;
};

export const PlayScreen = ({
  dayIndex,
  map,
  runState,
  onStep,
  onMoveToCoordinate,
  onReset,
  disabled = false,
}: PlayScreenProps) => {
  const parcelsLeft = 3 - runState.deliveredIndices.length;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-[340px] sm:max-w-[360px] mx-auto p-1 sm:p-2 space-y-2.5 select-none font-mono">
      {/* 1. Compact HUD (Day, Moves left, Parcels left) */}
      <header className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-zinc-900/95 border border-zinc-800 text-xs tracking-wider">
        <div className="flex items-center gap-1 font-bold">
          <span className="text-zinc-500">DAY</span>
          <span className="text-amber-400">#{dayIndex + 1}</span>
        </div>
        <div className="flex items-center gap-1 font-bold">
          <span className="text-zinc-500">MOVES:</span>
          <span
            className={
              runState.movesLeft <= 3
                ? 'text-rose-400 font-black animate-pulse'
                : 'text-zinc-100'
            }
          >
            {runState.movesLeft}
          </span>
        </div>
        <div className="flex items-center gap-1 font-bold">
          <span className="text-cyan-400">{parcelsLeft} LEFT</span>
        </div>
      </header>

      {/* 2. The Board Grid */}
      <div className="w-full flex justify-center">
        <Board
          map={map}
          runState={runState}
          onStep={onStep}
          onMoveToCoordinate={onMoveToCoordinate}
          disabled={disabled}
        />
      </div>

      {/* 3. Compact Tile Legend */}
      <div
        className="w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1 px-2.5 rounded bg-zinc-900/60 border border-zinc-800/80 text-[10px] tracking-tight text-zinc-400"
        aria-label="Grid tile legend"
      >
        <span className="inline-flex items-center gap-1">
          <strong className="text-amber-400">HQ</strong>
          <span className="text-zinc-500">Start</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <strong className="text-cyan-400">D1–D3</strong>
          <span className="text-zinc-500">Targets</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <strong className="text-amber-500">+2</strong>
          <span className="text-zinc-500">Cost 2</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <strong className="text-emerald-400">⚡</strong>
          <span className="text-zinc-500">+2 once</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <strong className="text-zinc-600">■</strong>
          <span className="text-zinc-500">Wall</span>
        </span>
      </div>

      {/* 4. Reset Button */}
      <div className="w-full flex items-center">
        <button
          type="button"
          onClick={onReset}
          className="w-full min-h-[44px] py-2.5 px-3 rounded bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center justify-center"
        >
          RESET ROUTE
        </button>
      </div>
    </div>
  );
};
