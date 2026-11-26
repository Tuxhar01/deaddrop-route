import { useEffect, useState } from 'react';
import { formatUtcDate, getDailyMap, getUtcDayIndex } from '../shared/dates';
import type { DailyResponse } from '../shared/types';
import { useRun } from './hooks/useRun';
import { EndCard } from './screens/EndCard';
import { PlayScreen } from './screens/PlayScreen';
import { StartScreen } from './screens/StartScreen';
import {
  SubmissionController,
  type CompletedRunStats,
  type ScreenState,
} from './submissionController';

export type { ScreenState };

export const App = () => {
  const [screen, setScreen] = useState<ScreenState>('start');
  const [dailyData, setDailyData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [completedStats, setCompletedStats] = useState<CompletedRunStats | null>(null);

  const [controller] = useState(
    () =>
      new SubmissionController({
        onStateChange: (stats) => {
          setCompletedStats(stats);
        },
        onScreenChange: (nextScreen) => {
          setScreen(nextScreen);
        },
      })
  );

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
          controller.setDailyData(data);
          setLoading(false);
        }
      } catch (err) {
        console.warn('[App] Failed to load /api/daily, using deterministic fallback:', err);
        if (!isCancelled) {
          const dayIndex = getUtcDayIndex();
          const date = formatUtcDate();
          const map = getDailyMap(dayIndex);
          const fallbackData: DailyResponse = {
            dayIndex,
            date,
            map,
            par: map.par,
            streak: 0,
            bestMoves: null,
            completions: 0,
            attempt: null,
            alreadyCompleted: false,
          };
          setDailyData(fallbackData);
          controller.setDailyData(fallbackData);
          setLoading(false);
        }
      }
    };

    void loadDaily();

    return () => {
      isCancelled = true;
    };
  }, [controller]);

  const run = useRun(dailyData?.map ?? null);

  // Submit run to POST /api/complete once upon reaching terminal win/loss state
  useEffect(() => {
    if (
      screen === 'play' &&
      (run.won || run.lost) &&
      !completedStats &&
      dailyData &&
      controller.canAutoSubmit()
    ) {
      controller.markAutoSubmitted();
      controller.captureTerminalRun({
        dayIndex: dailyData.dayIndex,
        path: run.movePath,
        movesUsed: run.movesUsed,
        stars: run.stars,
        won: run.won,
      });

      const timer = setTimeout(() => {
        void controller.submitRun(false);
      }, 500);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [
    screen,
    run.won,
    run.lost,
    completedStats,
    dailyData,
    run.movePath,
    run.movesUsed,
    run.stars,
    controller,
  ]);

  const handleReset = () => {
    controller.startNewRun();
    run.reset();
    setCompletedStats(null);
  };

  const handlePlayOrViewResult = () => {
    if (dailyData?.attempt) {
      const stats: CompletedRunStats = {
        won: dailyData.attempt.outcome === 'won',
        stars: dailyData.attempt.stars,
        streak: dailyData.streak,
        movesUsed: dailyData.attempt.movesUsed,
        completions: dailyData.completions ?? 0,
        confirmationStatus: 'confirmed',
      };
      controller.setCompletedStats(stats);
      setCompletedStats(stats);
      setScreen('end');
      return;
    }

    if (dailyData?.alreadyCompleted) {
      const stats: CompletedRunStats = {
        alreadyDispatched: true,
        won: false,
        stars: 0,
        streak: dailyData.streak,
        movesUsed: 0,
        completions: dailyData.completions ?? 0,
        confirmationStatus: 'confirmed',
      };
      controller.setCompletedStats(stats);
      setCompletedStats(stats);
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
          confirmationStatus={completedStats?.confirmationStatus ?? 'confirmed'}
          confirmationError={completedStats?.confirmationError}
          onRetryConfirmation={async () => {
            await controller.submitRun(true);
          }}
          sectorId={dailyData.map.id}
          par={dailyData.par}
        />
      )}
    </main>
  );
};
