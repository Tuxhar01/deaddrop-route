export type TileType = 'road' | 'block' | 'depot' | 'drop' | 'congested' | 'relay';

export type Direction = 'up' | 'down' | 'left' | 'right';

export type Coordinate = {
  x: number;
  y: number;
};

export type Grid = TileType[][];

export type StarRating = 0 | 1 | 2 | 3;

export type GameMap = {
  id?: string | undefined;
  grid: Grid;
  depot: Coordinate;
  drops: Coordinate[];
  par: number;
  initialBudget?: number | undefined;
};

export type StepFailureReason =
  | 'out_of_bounds'
  | 'blocked'
  | 'insufficient_moves'
  | 'game_already_over'
  | 'invalid_step';

export type StepOutcome = {
  valid: boolean;
  reason?: StepFailureReason | undefined;
  position: Coordinate;
  movesUsed: number;
  movesLeft: number;
  cost: number;
  deliveredCount: number;
  isDelivered: boolean;
  isRelayTriggered: boolean;
  won: boolean;
  lost: boolean;
};

export type RunState = {
  currentPosition: Coordinate;
  movesUsed: number;
  movesLeft: number;
  deliveredIndices: number[];
  collectedMask: number;
  usedRelayKeys: string[];
  usedRelayMask: number;
  won: boolean;
  lost: boolean;
  stars: StarRating;
  history: Coordinate[];
};

export type PathReplayResult = {
  success: boolean;
  finalState: RunState;
  movesUsed: number;
  movesLeft: number;
  deliveredCount: number;
  won: boolean;
  lost: boolean;
  stars: StarRating;
  errorStep?: number | undefined;
  errorReason?: StepFailureReason | undefined;
};

export type MapValidationResult = {
  valid: boolean;
  errors: string[];
};

export type SolverOutput = {
  minMoves: number;
  path: Direction[];
  finalMovesLeft: number;
};

export type UserDailyAttempt = {
  outcome: 'won' | 'lost';
  movesUsed: number;
  stars: StarRating;
  deliveredCount: number;
  recordedAt?: string | undefined;
};

export type DailyResponse = {
  dayIndex: number;
  date: string;
  map: GameMap;
  par: number;
  streak: number;
  bestMoves: number | null;
  username?: string | undefined;
  completions?: number | undefined;
  postId?: string | undefined;
  attempt: UserDailyAttempt | null;
  alreadyCompleted: boolean;
};

export type CompleteSubmission = {
  dayIndex: number;
  path: Direction[];
};

export type CompleteResponse =
  | {
      status: 'success';
      valid: true;
      won: boolean;
      lost: boolean;
      movesUsed: number;
      stars: StarRating;
      deliveredCount: number;
      movesLeft: number;
      streak?: number | undefined;
      bestMoves?: number | null | undefined;
      completions?: number | undefined;
      traffic?: Record<string, number> | undefined;
    }
  | {
      status: 'already_completed';
      attempt: UserDailyAttempt | null;
    }
  | {
      status: 'retry_later';
    }
  | {
      status: 'error';
      valid: false;
      error: string;
      message: string;
      step?: number | undefined;
    };

export type ShareSubmission = {
  dayIndex: number;
  won: boolean;
  movesUsed: number;
  stars: StarRating;
  streak: number;
  postId?: string | undefined;
};

export type ShareResponse =
  | {
      status: 'success';
      commentId: string;
      commentUrl?: string | undefined;
    }
  | {
      status: 'error';
      error: string;
      message: string;
    };
