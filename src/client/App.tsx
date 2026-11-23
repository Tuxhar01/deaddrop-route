import { useEffect, useState } from 'react';
import { formatUtcDate, getDailyMap, getUtcDayIndex } from '../shared/dates';
import type { CompleteResponse, DailyResponse, StarRating } from '../shared/types';
import { useRun } from './hooks/useRun';
import { EndCard } from './screens/EndCard';
import { PlayScreen } from './screens/PlayScreen';
import { StartScreen } from './screens/StartScreen';

export type ScreenState = 'start' | 'play' | 'end';

type CompletedRunStats = {
  won: boolean;
  stars: StarRating;
  streak: number;
  movesUsed: number;
  completions: number;
  traffic?: Record<string, number> | undefined;
  alreadyDispatched?: boolean | undefined;
};

export const App = () => {
  const [screen, setScreen] = useState<ScreenState>('start');
  const [dailyData, setDailyData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [completedStats, setCompletedStats] = useState<CompletedRunStats | null>(null);

  // Load daily dispatch data from API with deterministic offline fallback
  useEffect(() => {
    let isCancelled = false;

    const loadDaily = async () => {
      try {
        const res = await fetch('/api/daily');
        if (!res.ok) {
          throw new Error(`Daily API responded with status ${res.status}`);
        }
        const data: DailyResponse = await res.json();
        if (!isCancelled) {
          setDailyData(data);
          setLoading(false);
        }
      } catch (err) {
        console.warn('[App] Failed to load /api/daily, using deterministic fallback:', err);
        if (!isCancelled) {
          const dayIndex = getUtcDayIndex();
          const date = formatUtcDate();
          const map = getDailyMap(dayIndex);
          setDailyData({
            dayIndex,
            date,
            map,
            par: map.par,
            streak: 0,
            bestMoves: null,
            completions: 0,
            attempt: null,
            alreadyCompleted: false,
          });
          setLoading(false);
        }
      }
    };

    void loadDaily();

    return () => {
      isCancelled = true;
    };
  }, []);

  const run = useRun(dailyData?.map ?? null);

  // Submit run to POST /api/complete upon reaching terminal win/loss state
  useEffect(() => {
    if (screen === 'play' && (run.won || run.lost) && !completedStats && dailyData) {
      let isCancelled = false;

      const submitRun = async () => {
        try {
          const res = await fetch('/api/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dayIndex: dailyData.dayIndex,
              path: run.movePath,
            }),
          });

          if (res.ok) {
            const data: CompleteResponse = await res.json();
            if (!isCancelled && data.status === 'success') {
              setCompletedStats({
                won: data.won,
                stars: data.stars,
                streak: data.streak ?? (data.won ? dailyData.streak + 1 : dailyData.streak),
                movesUsed: data.movesUsed,
                completions: data.completions ?? dailyData.completions ?? 0,
                traffic: data.traffic,
              });
              setScreen('end');
              return;
            }
          } else if (res.status === 409) {
            const data: CompleteResponse = await res.json();
            if (!isCancelled && data.status === 'already_completed') {
              if (data.attempt) {
                setCompletedStats({
                  won: data.attempt.outcome === 'won',
                  stars: data.attempt.stars,
                  streak: dailyData.streak,
                  movesUsed: data.attempt.movesUsed,
                  completions: dailyData.completions ?? 0,
                });
              } else {
                setCompletedStats({
                  alreadyDispatched: true,
                  won: false,
                  stars: 0,
                  streak: dailyData.streak,
                  movesUsed: 0,
                  completions: dailyData.completions ?? 0,
                });
              }
              setScreen('end');
              return;
            }
          }
        } catch (err) {
          console.warn('[App] Error submitting run to /api/complete, using local fallback:', err);
        }

        if (!isCancelled) {
          setCompletedStats({
            won: run.won,
            stars: run.stars,
            streak: run.won ? dailyData.streak + 1 : dailyData.streak,
            movesUsed: run.movesUsed,
            completions: dailyData.completions ?? 0,
          });
          setScreen('end');
        }
      };

      const timer = setTimeout(() => {
        void submitRun();
      }, 500);

      return () => {
        isCancelled = true;
        clearTimeout(timer);
      };
    }
  }, [
    screen,
    run.won,
    run.lost,
    run.movePath,
    run.movesUsed,
    run.stars,
    dailyData,
    completedStats,
  ]);

  const handleReset = () => {
    run.reset();
    setCompletedStats(null);
  };

  const handlePlayOrViewResult = () => {
    if (dailyData?.attempt) {
      setCompletedStats({
        won: dailyData.attempt.outcome === 'won',
        stars: dailyData.attempt.stars,
        streak: dailyData.streak,
        movesUsed: dailyData.attempt.movesUsed,
        completions: dailyData.completions ?? 0,
      });
      setScreen('end');
      return;
    }

    if (dailyData?.alreadyCompleted) {
      setCompletedStats({
        alreadyDispatched: true,
        won: false,
        stars: 0,
        streak: dailyData.streak,
        movesUsed: 0,
        completions: dailyData.completions ?? 0,
      });
      setScreen('end');
      return;
    }

    setScreen('play');
  };

  if (loading || !dailyData || !run.state) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen w-full bg-zinc-950 text-zinc-400 font-mono text-xs select-none p-4">
        <div className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse mb-3" />
        <span className="tracking-widest uppercase font-semibold text-zinc-300">
          CONNECTING TO DISPATCH NODE...
        </span>
      </div>
    );
  }

  return (
    <main className="flex flex-col items-center justify-center w-full min-h-screen p-2 sm:p-4 bg-zinc-950 text-zinc-100 font-mono select-none">
      {screen === 'start' && (
        <StartScreen
          date={dailyData.date}
          streak={dailyData.streak}
          hasAttempt={Boolean(dailyData.attempt || dailyData.alreadyCompleted)}
          onPlay={handlePlayOrViewResult}
        />
      )}

      {screen === 'play' && (
        <PlayScreen
          dayIndex={dailyData.dayIndex}
          map={dailyData.map}
          runState={run.state}
          onStep={run.step}
          onMoveToCoordinate={run.moveToCoordinate}
          onReset={handleReset}
        />
      )}

      {screen === 'end' && (
        <EndCard
          won={completedStats ? completedStats.won : run.won}
          stars={completedStats ? completedStats.stars : run.stars}
          streak={completedStats?.streak ?? dailyData.streak}
          dayIndex={dailyData.dayIndex}
          movesUsed={completedStats ? completedStats.movesUsed : run.movesUsed}
          completions={completedStats?.completions ?? dailyData.completions ?? 0}
          traffic={completedStats?.traffic}
          postId={dailyData.postId}
          alreadyDispatched={completedStats?.alreadyDispatched}
        />
      )}
    </main>
  );
};
