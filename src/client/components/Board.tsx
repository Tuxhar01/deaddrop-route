import { useEffect } from 'react';
import type { Coordinate, Direction, GameMap, RunState, TileType } from '../../shared/types';
import { getDirectionBetweenCoordinates } from '../hooks/useRun';

export type BoardProps = {
  map: GameMap;
  runState: RunState;
  onStep?: (direction: Direction) => void;
  onMoveToCoordinate?: (coord: Coordinate) => void;
  disabled?: boolean;
};

const getTileVisuals = (
  tile: TileType,
  isDepot: boolean,
  isDrop: boolean,
  isDelivered: boolean,
  dropNumber: number | null,
  isRelayUsed: boolean
) => {
  if (isDrop) {
    if (isDelivered) {
      return {
        bg: 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400',
        badge: '✓',
        label: `DROP #${dropNumber ?? ''} DELIVERED`,
      };
    }
    return {
      bg: 'bg-cyan-950/60 border-cyan-400/80 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.35)] animate-pulse',
      badge: `D${dropNumber ?? ''}`,
      label: `PARCEL #${dropNumber ?? ''} TARGET`,
    };
  }

  if (isDepot) {
    return {
      bg: 'bg-amber-950/40 border-amber-500/60 text-amber-400',
      badge: 'HQ',
      label: 'DISPATCH DEPOT',
    };
  }

  switch (tile) {
    case 'block':
      return {
        bg: 'bg-zinc-950 border-zinc-900 text-zinc-700',
        badge: '■',
        label: 'BLOCKED GRID',
      };
    case 'congested':
      return {
        bg: 'bg-amber-950/30 border-amber-600/50 text-amber-500',
        badge: '+2',
        label: 'CONGESTION (+2 COST)',
      };
    case 'relay':
      if (isRelayUsed) {
        return {
          bg: 'bg-zinc-900/60 border-zinc-800 text-zinc-600',
          badge: '○',
          label: 'RELAY EXHAUSTED',
        };
      }
      return {
        bg: 'bg-emerald-950/60 border-emerald-400/80 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]',
        badge: '⚡',
        label: 'RELAY (+2 BOOST)',
      };
    case 'road':
    default:
      return {
        bg: 'bg-zinc-900/50 border-zinc-800/80 text-zinc-500 hover:border-zinc-700',
        badge: '·',
        label: 'CLEAR ROADWAY',
      };
  }
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
                isRelayUsed
              );

              return (
                <button
                  key={`cell-${x}-${y}`}
                  type="button"
                  onClick={() => handleCellClick(x, y)}
                  disabled={!isLegalMove}
                  aria-label={`Tile at column ${x + 1}, row ${y + 1}: ${visuals.label}${isCourier ? ' (COURIER PRESENT)' : ''}${isLegalMove ? ' (LEGAL MOVE)' : ''}`}
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
                  {/* Courier presence indicator */}
                  {isCourier ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-amber-500 text-zinc-950 font-black rounded z-20 animate-in fade-in zoom-in-75 duration-100">
                      <span className="text-[11px] sm:text-xs tracking-tighter">VAN</span>
                    </div>
                  ) : (
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
