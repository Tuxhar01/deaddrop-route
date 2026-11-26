import { useEffect } from 'react';
import type { Coordinate, Direction, GameMap, RunState } from '../../shared/types';
import { getDirectionBetweenCoordinates } from '../hooks/useRun';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getTileVisuals } from './boardVisuals.ts';

export type BoardProps = {
  map: GameMap;
  runState: RunState;
  onStep?: (direction: Direction) => void;
  onMoveToCoordinate?: (coord: Coordinate) => void;
  disabled?: boolean;
};

export const Board = ({
  map,
  runState,
  onStep,
  onMoveToCoordinate,
  disabled = false,
}: BoardProps) => {
  const isGameOver = runState.won || runState.lost;
  const isInputLocked = disabled || isGameOver;

  // Global keyboard navigation (Arrow keys + WASD)
  useEffect(() => {
    if (isInputLocked || !onStep) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent scrolling when using arrow keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          onStep('up');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          onStep('down');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          onStep('left');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          onStep('right');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInputLocked, onStep]);

  const handleCellClick = (x: number, y: number) => {
    if (isInputLocked) return;

    const target: Coordinate = { x, y };

    if (onMoveToCoordinate) {
      onMoveToCoordinate(target);
      return;
    }

    if (onStep) {
      const dir = getDirectionBetweenCoordinates(runState.currentPosition, target);
      if (dir) {
        onStep(dir);
      }
    }
  };

  const getDropIndex = (x: number, y: number): number => {
    for (let i = 0; i < map.drops.length; i++) {
      const drop = map.drops[i];
      if (drop && drop.x === x && drop.y === y) {
        return i;
      }
    }
    return -1;
  };

  // Map of visited tile counts from authoritative local run history
  const visitedCounts = new Map<string, number>();
  for (const pos of runState.history) {
    const k = `${pos.x},${pos.y}`;
    visitedCounts.set(k, (visitedCounts.get(k) ?? 0) + 1);
  }

  return (
    <div className="w-full flex flex-col items-center select-none font-mono">
      {/* 7x7 Grid Container - responsive sizing so it fits cleanly on short viewports & 375px mobile */}
      <div className="relative w-[min(92vw,340px,50vh)] aspect-square p-1.5 sm:p-2 rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-sm">
        <div
          className="grid grid-cols-7 grid-rows-7 gap-1 sm:gap-1.5 w-full h-full"
          role="grid"
          aria-label="Courier dispatch 7x7 grid"
        >
          {map.grid.map((row, y) =>
            row.map((tile, x) => {
              const isCourier = runState.currentPosition.x === x && runState.currentPosition.y === y;
              const isDepot = map.depot.x === x && map.depot.y === y;
              const dropIndex = getDropIndex(x, y);
              const isDrop = dropIndex >= 0;
              const isDelivered = isDrop && runState.deliveredIndices.includes(dropIndex);
              const isRelayUsed = tile === 'relay' && runState.usedRelayKeys.includes(`${x},${y}`);

              const cellKey = `${x},${y}`;
              const visitCount = visitedCounts.get(cellKey) ?? 0;
              const isVisited = visitCount > 0;

              const isAdjacent =
                Math.abs(runState.currentPosition.x - x) +
                  Math.abs(runState.currentPosition.y - y) ===
                1;
              const isPassable = tile !== 'block';
              const stepCost = tile === 'congested' ? 2 : 1;
              const isAffordable = runState.movesLeft >= stepCost;
              const isLegalMove = !isInputLocked && isAdjacent && isPassable && isAffordable;

              const visuals = getTileVisuals(
                tile,
                isDepot,
                isDrop,
                isDelivered,
                dropIndex >= 0 ? dropIndex + 1 : null,
                isRelayUsed,
                isVisited
              );

              return (
                <button
                  key={`cell-${x}-${y}`}
                  type="button"
                  onClick={() => handleCellClick(x, y)}
                  disabled={!isLegalMove}
                  aria-label={`Tile at column ${x + 1}, row ${y + 1}: ${visuals.label}${isVisited ? ' (VISITED)' : ''}${isCourier ? ' (COURIER PRESENT)' : ''}${isLegalMove ? ' (LEGAL MOVE)' : ''}`}
                  className={`
                    relative flex flex-col items-center justify-center rounded border transition-all duration-150
                    text-[10px] sm:text-xs font-bold
                    ${visuals.bg}
                    ${
                      isLegalMove
                        ? 'ring-1 ring-inset ring-amber-400/50 border-amber-400/80 shadow-[0_0_6px_rgba(251,191,36,0.15)] cursor-pointer hover:border-amber-300 hover:scale-[1.03] active:scale-95'
                        : 'cursor-default'
                    }
                    ${isCourier ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-950 z-20 shadow-lg shadow-amber-500/30' : ''}
                  `}
                >
                  {/* Courier presence indicator (Highest precedence) */}
                  {isCourier ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-amber-500 text-zinc-950 font-black rounded z-20 animate-in fade-in zoom-in-75 duration-100">
                      <span className="text-[11px] sm:text-xs tracking-tighter">VAN</span>
                    </div>
                  ) : tile === 'road' && isVisited ? (
                    /* Visited road breadcrumb with intersection counter */
                    <div className="flex flex-col items-center justify-center leading-none">
                      <span
                        className={`rounded-full transition-all ${
                          visitCount > 1
                            ? 'w-2 h-2 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)] ring-1 ring-amber-300'
                            : 'w-1.5 h-1.5 bg-amber-400/80 shadow-[0_0_4px_rgba(251,191,36,0.3)]'
                        }`}
                      />
                      {visitCount > 1 && (
                        <span className="text-[7px] text-amber-300 font-bold leading-none mt-0.5 tracking-tighter">
                          ×{visitCount}
                        </span>
                      )}
                    </div>
                  ) : (
                    /* Standard tile badge and target indicators */
                    <>
                      <span className="leading-none">{visuals.badge}</span>
                      {isDrop && (
                        <span className="text-[8px] leading-tight opacity-75">
                          {isDelivered ? 'DONE' : 'DROP'}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
