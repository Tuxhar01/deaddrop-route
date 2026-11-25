import type { CompleteResponse, DailyResponse, Direction, StarRating } from '../shared/types';

export type ScreenState = 'start' | 'play' | 'end';

export type CompletedRunSnapshot = {
  runId: number;
  dayIndex: number;
  path: Direction[];
  movesUsed: number;
  stars: StarRating;
  won: boolean;
};

export type CompletedRunStats = {
  won: boolean;
  stars: StarRating;
  streak: number;
  movesUsed: number;
  completions: number;
  traffic?: Record<string, number> | undefined;
  alreadyDispatched?: boolean | undefined;
  confirmationStatus: 'confirmed' | 'pending' | 'rejected';
  confirmationError?: string | null | undefined;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SubmissionControllerOptions = {
  fetchFn?: FetchLike | undefined;
  delayFn?: ((ms: number) => Promise<void>) | undefined;
  onStateChange?: ((stats: CompletedRunStats) => void) | undefined;
  onScreenChange?: ((screen: ScreenState) => void) | undefined;
};

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class SubmissionController {
  private currentRunId = 1;
  private autoSubmittedRunId: number | null = null;
  private isSubmitting = false;
  private activeSnapshot: CompletedRunSnapshot | null = null;
  private completedStats: CompletedRunStats | null = null;
  private dailyData: DailyResponse | null = null;
  private readonly fetchFn: FetchLike;
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly onStateChange?: ((stats: CompletedRunStats) => void) | undefined;
  private readonly onScreenChange?: ((screen: ScreenState) => void) | undefined;

  constructor(options?: SubmissionControllerOptions) {
    this.fetchFn =
      options?.fetchFn ??
      (typeof fetch !== 'undefined'
        ? fetch
        : () => Promise.reject(new Error('Global fetch is not available')));
    this.delayFn = options?.delayFn ?? defaultDelay;
    this.onStateChange = options?.onStateChange;
    this.onScreenChange = options?.onScreenChange;
  }

  setDailyData(data: DailyResponse | null): void {
    const prevDayIndex = this.dailyData?.dayIndex;
    this.dailyData = data;
    if (data && prevDayIndex !== undefined && prevDayIndex !== data.dayIndex) {
      this.startNewRun();
    }
  }

  getDailyData(): DailyResponse | null {
    return this.dailyData;
  }

  getCurrentRunId(): number {
    return this.currentRunId;
  }

  isSubmissionInProgress(): boolean {
    return this.isSubmitting;
  }

  getCompletedStats(): CompletedRunStats | null {
    return this.completedStats;
  }

  setCompletedStats(stats: CompletedRunStats | null): void {
    this.completedStats = stats;
    if (stats) {
      this.onStateChange?.(stats);
    }
  }

  getActiveSnapshot(): CompletedRunSnapshot | null {
    return this.activeSnapshot;
  }

  startNewRun(): number {
    this.currentRunId++;
    this.activeSnapshot = null;
    this.completedStats = null;
    this.isSubmitting = false;
    return this.currentRunId;
  }

  canAutoSubmit(): boolean {
    return (
      this.autoSubmittedRunId !== this.currentRunId &&
      !this.completedStats &&
      !this.isSubmitting
    );
  }

  markAutoSubmitted(): void {
    this.autoSubmittedRunId = this.currentRunId;
  }

  captureTerminalRun(snapshot: Omit<CompletedRunSnapshot, 'runId'>): CompletedRunSnapshot {
    if (this.activeSnapshot && this.activeSnapshot.runId === this.currentRunId) {
      return this.activeSnapshot;
    }
    const fullSnapshot: CompletedRunSnapshot = {
      dayIndex: snapshot.dayIndex,
      path: [...snapshot.path],
      movesUsed: snapshot.movesUsed,
      stars: snapshot.stars,
      won: snapshot.won,
      runId: this.currentRunId,
    };
    this.activeSnapshot = fullSnapshot;
    return fullSnapshot;
  }

  async submitRun(isManualRetry = false): Promise<CompletedRunStats | null> {
    if (!this.dailyData || !this.activeSnapshot) {
      return null;
    }

    // 1. Only one completion submission active at a time for this run
    if (this.isSubmitting) {
      return null;
    }

    // 2. Once a run is confirmed, never downgrade or re-submit
    if (this.completedStats?.confirmationStatus === 'confirmed') {
      return this.completedStats;
    }

    const snapshot = this.activeSnapshot;
    const runId = snapshot.runId;

    // Verify snapshot belongs to current run
    if (runId !== this.currentRunId) {
      return null;
    }

    this.isSubmitting = true;

    try {
      const maxAttempts = isManualRetry ? 1 : 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await this.fetchFn('/api/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dayIndex: snapshot.dayIndex,
              path: snapshot.path,
            }),
          });

          // Abort if run was reset while request was in-flight
          if (this.currentRunId !== runId) {
            return null;
          }

          if (res.ok) {
            const data: CompleteResponse = await res.json();
            if (data.status === 'success') {
              const newStats: CompletedRunStats = {
                won: data.won,
                stars: data.stars,
                streak: data.streak ?? (data.won ? this.dailyData.streak + 1 : this.dailyData.streak),
                movesUsed: data.movesUsed,
                completions: data.completions ?? this.dailyData.completions ?? 0,
                traffic: data.traffic,
                confirmationStatus: 'confirmed',
              };
              this.completedStats = newStats;
              this.onStateChange?.(newStats);
              this.onScreenChange?.('end');
              return newStats;
            }
          } else if (res.status === 409) {
            const data: CompleteResponse = await res.json();
            if (data.status === 'already_completed') {
              let newStats: CompletedRunStats;
              if (data.attempt) {
                newStats = {
                  won: data.attempt.outcome === 'won',
                  stars: data.attempt.stars,
                  streak: this.dailyData.streak,
                  movesUsed: data.attempt.movesUsed,
                  completions: this.dailyData.completions ?? 0,
                  confirmationStatus: 'confirmed',
                };
              } else {
                newStats = {
                  alreadyDispatched: true,
                  won: false,
                  stars: 0,
                  streak: this.dailyData.streak,
                  movesUsed: 0,
                  completions: this.dailyData.completions ?? 0,
                  confirmationStatus: 'confirmed',
                };
              }
              this.completedStats = newStats;
              this.onStateChange?.(newStats);
              this.onScreenChange?.('end');
              return newStats;
            }
          } else if (res.status === 400 || res.status === 401) {
            let errMsg = 'Completion rejected by server.';
            try {
              const errData: CompleteResponse = await res.json();
              if (errData.status === 'error' && errData.message) {
                errMsg = errData.message;
              }
            } catch {
              // ignore JSON parsing errors
            }

            // Abort if run was reset or already confirmed
            if (this.currentRunId !== runId) {
              return null;
            }
            if (this.completedStats?.confirmationStatus === 'confirmed') {
              return this.completedStats;
            }

            const newStats: CompletedRunStats = {
              won: snapshot.won,
              stars: snapshot.stars,
              streak: this.dailyData.streak,
              movesUsed: snapshot.movesUsed,
              completions: this.dailyData.completions ?? 0,
              confirmationStatus: 'rejected',
              confirmationError: errMsg,
            };
            this.completedStats = newStats;
            this.onStateChange?.(newStats);
            this.onScreenChange?.('end');
            return newStats;
          } else if (res.status === 503 && attempt < maxAttempts) {
            await this.delayFn(1000);
            if (this.currentRunId !== runId) {
              return null;
            }
            continue;
          }
        } catch (err) {
          console.warn('[App] Error submitting run to /api/complete:', err);
          if (attempt < maxAttempts) {
            await this.delayFn(1000);
            if (this.currentRunId !== runId) {
              return null;
            }
            continue;
          }
        }
      }

      // Check lifecycle before applying pending fallback
      if (this.currentRunId !== runId) {
        return null;
      }
      if (this.completedStats?.confirmationStatus === 'confirmed') {
        return this.completedStats;
      }

      const pendingStats: CompletedRunStats = {
        won: snapshot.won,
        stars: snapshot.stars,
        streak: this.dailyData.streak,
        movesUsed: snapshot.movesUsed,
        completions: this.dailyData.completions ?? 0,
        confirmationStatus: 'pending',
        confirmationError: 'Dispatch confirmation failed. Tap retry to save your run.',
      };
      this.completedStats = pendingStats;
      this.onStateChange?.(pendingStats);
      this.onScreenChange?.('end');
      return pendingStats;
    } finally {
      this.isSubmitting = false;
    }
  }
}
