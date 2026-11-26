// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { TRAFFIC_THRESHOLD } from '../../shared/constants.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatDispatchSummary, formatSectorName } from '../../shared/format.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { isClipboardSupported } from './clipboard.ts';
import type { StarRating, UserDailyAttempt } from '../../shared/types';

export type EndCardProps = {
  won: boolean;
  stars: StarRating;
  streak: number;
  dayIndex?: number | undefined;
  movesUsed?: number | undefined;
  completions?: number | undefined;
  traffic?: Record<string, number> | undefined;
  postId?: string | undefined;
  onShare?: (() => Promise<void>) | undefined;
  alreadyDispatched?: boolean | undefined;
  attempt?: UserDailyAttempt | Record<string, unknown> | null | undefined;
  confirmationStatus?: 'confirmed' | 'pending' | 'rejected' | undefined;
  confirmationError?: string | null | undefined;
  onRetryConfirmation?: (() => Promise<void> | void) | undefined;
  sectorId?: string | undefined;
  par?: number | undefined;
  onCopy?: (() => Promise<boolean>) | undefined;
};

export type EndCardViewModel = {
  resultHeading: string;
  isWon: boolean;
  starsGlyphs: string;
  streakText: string;
  isBelowTrafficThreshold: boolean;
  trafficDisplayText: string;
  courierCountText: string | null;
  backTomorrowText: string;
  showShareButton: boolean;
  confirmationStatus: 'confirmed' | 'pending' | 'rejected';
  confirmationNotice?: string | undefined;
  showRetryConfirmation: boolean;
  sectorTitle: string;
  canCopyDispatch: boolean;
  dispatchSummary: string;
};

export const isValidAttemptRecord = (
  data: unknown,
  expectedDayIndex?: number
): data is UserDailyAttempt => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const rec = data as Record<string, unknown>;
  if (rec.outcome !== 'won' && rec.outcome !== 'lost') return false;
  if (
    typeof rec.movesUsed !== 'number' ||
    !Number.isFinite(rec.movesUsed) ||
    !Number.isInteger(rec.movesUsed) ||
    rec.movesUsed < 0
  ) {
    return false;
  }
  if (
    typeof rec.stars !== 'number' ||
    !Number.isInteger(rec.stars) ||
    (rec.stars !== 0 && rec.stars !== 1 && rec.stars !== 2 && rec.stars !== 3)
  ) {
    return false;
  }
  if (
    typeof rec.deliveredCount !== 'number' ||
    !Number.isFinite(rec.deliveredCount) ||
    !Number.isInteger(rec.deliveredCount) ||
    rec.deliveredCount < 0
  ) {
    return false;
  }
  if (rec.outcome === 'lost' && rec.stars !== 0) return false;
  if (
    expectedDayIndex !== undefined &&
    'dayIndex' in rec &&
    rec.dayIndex !== undefined &&
    rec.dayIndex !== expectedDayIndex
  ) {
    return false;
  }
  if ('recordedAt' in rec && rec.recordedAt !== undefined && typeof rec.recordedAt !== 'string') {
    return false;
  }
  return true;
};

export const renderStarGlyphs = (stars: StarRating, won: boolean): string => {
  if (!won) return '☆☆☆';
  switch (stars) {
    case 3:
      return '★★★';
    case 2:
      return '★★☆';
    case 1:
      return '★☆☆';
    default:
      return '☆☆☆';
  }
};

export const getEndCardViewModel = (props: EndCardProps): EndCardViewModel => {
  const {
    streak,
    completions = 0,
    alreadyDispatched,
    attempt,
    confirmationStatus = 'confirmed',
    confirmationError,
  } = props;
  const isBelowTrafficThreshold = completions < TRAFFIC_THRESHOLD;
  const streakText = `STREAK: ${streak} ${streak === 1 ? 'DAY' : 'DAYS'}`;
  const trafficDisplayText = isBelowTrafficThreshold
    ? 'BE THE FIRST TO ROUTE'
    : `${completions} ${completions === 1 ? 'COURIER DISPATCHED' : 'COURIERS DISPATCHED'}`;
  const courierCountText = isBelowTrafficThreshold
    ? null
    : `${completions} ${completions === 1 ? 'COURIER DISPATCHED' : 'COURIERS DISPATCHED'}`;

  if (confirmationStatus === 'rejected') {
    return {
      resultHeading: 'DISPATCH REJECTED',
      isWon: false,
      starsGlyphs: '',
      streakText,
      isBelowTrafficThreshold,
      trafficDisplayText,
      courierCountText,
      backTomorrowText: 'Back tomorrow for your next drop.',
      showShareButton: false,
      confirmationStatus: 'rejected',
      confirmationNotice: confirmationError || 'Run rejected by server.',
      showRetryConfirmation: false,
      sectorTitle: formatSectorName(props.sectorId),
      canCopyDispatch: false,
      dispatchSummary: '',
    };
  }

  const isInvalidOrMissingAttempt =
    alreadyDispatched ||
    (attempt !== undefined && (attempt === null || !isValidAttemptRecord(attempt)));

  if (isInvalidOrMissingAttempt) {
    return {
      resultHeading: 'ALREADY DISPATCHED',
      isWon: false,
      starsGlyphs: '',
      streakText,
      isBelowTrafficThreshold,
      trafficDisplayText,
      courierCountText,
      backTomorrowText: 'Back tomorrow for your next drop.',
      showShareButton: false,
      confirmationStatus,
      confirmationNotice: undefined,
      showRetryConfirmation: false,
      sectorTitle: formatSectorName(props.sectorId),
      canCopyDispatch: false,
      dispatchSummary: '',
    };
  }

  const effectiveWon = attempt ? attempt.outcome === 'won' : props.won;
  const effectiveStars = attempt ? attempt.stars : props.stars;
  const effectiveMovesUsed = attempt ? attempt.movesUsed : props.movesUsed;

  const hasValidMovesUsed =
    typeof effectiveMovesUsed === 'number' &&
    Number.isFinite(effectiveMovesUsed) &&
    effectiveMovesUsed > 0;

  const hasValidStars =
    effectiveWon ? (effectiveStars >= 1 && effectiveStars <= 3) : (effectiveStars === 0);

  // Sharing is strictly disallowed until server confirms completion
  const showShareButton =
    confirmationStatus === 'confirmed' && hasValidMovesUsed && hasValidStars;
  const showRetryConfirmation = confirmationStatus === 'pending';

  const resultHeading = effectiveWon ? 'ROUTE DELIVERED' : 'OUT OF MOVES';
  const starsGlyphs = renderStarGlyphs(effectiveStars, effectiveWon);
  const sectorTitle = formatSectorName(props.sectorId);
  const canCopyDispatch = showShareButton && isClipboardSupported();
  const dispatchSummary = showShareButton
    ? formatDispatchSummary({
        dayIndex: props.dayIndex ?? 0,
        sectorId: props.sectorId,
        won: effectiveWon,
        movesUsed: effectiveMovesUsed ?? 0,
        par: props.par,
        stars: effectiveStars,
        streak,
      })
    : '';

  return {
    resultHeading,
    isWon: effectiveWon,
    starsGlyphs,
    streakText,
    isBelowTrafficThreshold,
    trafficDisplayText,
    courierCountText,
    backTomorrowText: 'Back tomorrow for your next drop.',
    showShareButton,
    confirmationStatus,
    confirmationNotice:
      confirmationStatus === 'pending'
        ? (confirmationError || 'Dispatch unconfirmed. Tap retry to save your run.')
        : undefined,
    showRetryConfirmation,
    sectorTitle,
    canCopyDispatch,
    dispatchSummary,
  };
};
