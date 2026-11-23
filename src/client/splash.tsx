import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DailyResponse } from '../shared/types';

export const Splash = () => {
  const [hasAttempt, setHasAttempt] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    fetch('/api/daily')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DailyResponse | null) => {
        if (!isCancelled && data && (data.attempt || data.alreadyCompleted)) {
          setHasAttempt(true);
        }
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="flex relative flex-col justify-center items-center min-h-screen px-3 py-6 bg-zinc-950 text-zinc-100 font-mono select-none">
      <div className="w-full max-w-[340px] sm:max-w-[360px] rounded-xl border border-zinc-800 bg-zinc-900/95 p-5 sm:p-6 shadow-2xl backdrop-blur-sm text-center space-y-4">
        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white uppercase">
          Dead Drop Route
        </h1>

        {/* Hook */}
        <p className="text-xs text-zinc-300 leading-relaxed max-w-xs mx-auto">
          Deliver clandestine packages through district gridlines before sunrise.
        </p>

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
