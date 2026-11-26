import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatSectorName } from '../shared/format.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap, getUtcDayIndex } from '../shared/dates.ts';
import type { DailyResponse, GameMap } from '../shared/types';

export const Splash = () => {
  const initialDayIndex = getUtcDayIndex();
  const initialMap = getDailyMap(initialDayIndex);

  const [hasAttempt, setHasAttempt] = useState(false);
  const [dayIndex, setDayIndex] = useState<number>(initialDayIndex);
  const [dailyMap, setDailyMap] = useState<GameMap>(initialMap);

  useEffect(() => {
    let isCancelled = false;
    fetch('/api/daily')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DailyResponse | null) => {
        if (!isCancelled && data) {
          if (data.map) {
            setDailyMap(data.map);
          }
          if (typeof data.dayIndex === 'number') {
            setDayIndex(data.dayIndex);
          }
          if (data.attempt || data.alreadyCompleted) {
            setHasAttempt(true);
          }
        }
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, []);

  const dispatchNumber = dayIndex + 1;
  const sectorTitle = formatSectorName(dailyMap.id);
  const parTarget = dailyMap.par ?? 20;

  return (
    <div className="flex relative flex-col justify-center items-center min-h-screen px-3 py-4 sm:py-6 bg-zinc-950 text-zinc-100 font-mono select-none">
      <div className="w-full max-w-[340px] sm:max-w-[360px] rounded-xl border border-zinc-800 bg-zinc-900/95 p-4 sm:p-5 shadow-2xl backdrop-blur-sm text-center space-y-3">
        {/* Title */}
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white uppercase">
            Dead Drop Route
          </h1>
          <p className="text-xs text-zinc-300 leading-relaxed max-w-xs mx-auto">
            Deliver clandestine packages through district gridlines before sunrise.
          </p>
        </div>

        {/* Sector Identity Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 text-[10px] sm:text-xs font-bold tracking-wider">
          <span className="text-amber-400 font-black">DISPATCH #{dispatchNumber}</span>
          <span className="text-zinc-600">•</span>
          <span className="text-zinc-300 truncate max-w-[180px]">{sectorTitle}</span>
        </div>

        {/* District Radar Preview */}
        <div className="w-full flex flex-col items-center justify-center space-y-1.5 py-1">
          <div
            className="w-32 h-32 sm:w-36 sm:h-36 grid grid-cols-7 gap-0.5 p-1 rounded-lg bg-zinc-950/90 border border-zinc-800/80 shadow-inner"
            aria-label="District map preview"
          >
            {dailyMap.grid.map((row, y) =>
              row.map((cell, x) => {
                const isDepot = dailyMap.depot.x === x && dailyMap.depot.y === y;
                const isDrop = dailyMap.drops.some((d) => d.x === x && d.y === y);
                const isBlock = cell === 'block';
                const isCongested = cell === 'congested';
                const isRelay = cell === 'relay';

                if (isDepot) {
                  return (
                    <div
                      key={`radar-${x}-${y}`}
                      className="bg-amber-500/90 rounded-[2px] flex items-center justify-center text-[7px] font-black text-zinc-950 shadow-sm"
                      title="HQ Start"
                    >
                      HQ
                    </div>
                  );
                }
                if (isDrop) {
                  return (
                    <div
                      key={`radar-${x}-${y}`}
                      className="bg-cyan-400/90 rounded-[2px] flex items-center justify-center text-[7px] font-black text-zinc-950 motion-safe:animate-pulse motion-reduce:animate-none shadow-sm shadow-cyan-500/30"
                      title="Drop Target"
                    >
                      D
                    </div>
                  );
                }
                if (isBlock) {
                  return (
                    <div
                      key={`radar-${x}-${y}`}
                      className="bg-zinc-950 border border-zinc-800/60 rounded-[2px]"
                      title="Obstacle"
                    />
                  );
                }
                if (isCongested) {
                  return (
                    <div
                      key={`radar-${x}-${y}`}
                      className="bg-amber-950/40 border border-amber-800/30 rounded-[2px]"
                      title="Congested Route (+2)"
                    />
                  );
                }
                if (isRelay) {
                  return (
                    <div
                      key={`radar-${x}-${y}`}
                      className="bg-emerald-950/40 border border-emerald-800/30 rounded-[2px]"
                      title="Relay (⚡)"
                    />
                  );
                }
                return (
                  <div
                    key={`radar-${x}-${y}`}
                    className="bg-zinc-800/30 rounded-[2px]"
                    title="Transit Route"
                  />
                );
              })
            )}
          </div>
          <div className="text-[10px] text-zinc-400 font-semibold tracking-wide">
            PAR TARGET: <span className="text-amber-400 font-bold">{parTarget} MOVES</span> • 3 TARGETS
          </div>
        </div>

        {/* Action Button */}
        <button
          type="button"
          className="w-full min-h-[48px] py-3 px-4 rounded bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-black text-sm tracking-widest uppercase transition-colors shadow-lg shadow-amber-500/10 cursor-pointer flex items-center justify-center"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          {hasAttempt ? 'VIEW RESULT' : 'INITIALIZE RUN'}
        </button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
