// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap } from './dates.ts';
import type { StarRating } from './types';

export type DispatchSummaryParams = {
  dayIndex: number;
  sectorId?: string | undefined;
  sectorName?: string | undefined;
  won: boolean;
  movesUsed: number;
  par?: number | undefined;
  stars: StarRating;
  streak: number;
  subreddit?: string | undefined;
};

/**
 * Formats a raw sector ID (e.g. "sector-04-neon-quarter") into a human-readable title
 * (e.g. "Sector 04: Neon Quarter").
 */
export const formatSectorName = (sectorId?: string): string => {
  if (!sectorId || typeof sectorId !== 'string') return 'Classified Sector';
  const trimmed = sectorId.trim();
  if (trimmed.length === 0) return 'Classified Sector';

  const parts = trimmed.split('-');
  if (parts.length >= 3 && parts[0]?.toLowerCase() === 'sector') {
    const num = parts[1];
    const name = parts
      .slice(2)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
    return `Sector ${num}: ${name}`;
  }

  return trimmed
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Converts star number to glyph representation.
 */
export const toStarGlyphs = (stars: StarRating, won: boolean): string => {
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

/**
 * Formats a canonical, spoiler-safe daily dispatch summary for both Reddit comments and clipboard copy.
 *
 * Guaranteed Spoiler-Safe:
 * Does NOT contain route coordinates, step sequences, visited tiles, or full board layouts.
 */
export const formatDispatchSummary = (params: DispatchSummaryParams): string => {
  const safeDayIndex =
    typeof params.dayIndex === 'number' && Number.isFinite(params.dayIndex)
      ? Math.max(0, Math.floor(params.dayIndex))
      : 0;

  let mapPar: number | undefined;
  let mapId: string | undefined;

  try {
    const map = getDailyMap(safeDayIndex);
    mapPar = map.par;
    mapId = map.id;
  } catch {
    // Fallback if dayIndex resolution fails
  }

  const effectiveSectorId = params.sectorId ?? mapId;
  const sectorTitle = params.sectorName ?? formatSectorName(effectiveSectorId);
  const effectivePar = params.par ?? mapPar ?? 20;
  const dayNumber = safeDayIndex + 1;

  const statusText = params.won ? 'Route Delivered' : 'Out of Moves';
  const starGlyphs = toStarGlyphs(params.stars, params.won);
  const safeStreak = Math.max(0, Math.floor(params.streak || 0));
  const streakText = `${safeStreak} ${safeStreak === 1 ? 'day' : 'days'}`;
  const safeMoves = Math.max(0, Math.floor(params.movesUsed || 0));
  const subreddit = params.subreddit ?? 'r/deaddrop_route';

  return [
    `📦 **DeadDrop Route — Night Shift Dispatch #${dayNumber}**`,
    sectorTitle,
    '',
    `- **Status**: ${statusText}`,
    `- **Rating**: ${starGlyphs}`,
    `- **Moves Used**: ${safeMoves} / ${effectivePar} (Par)`,
    `- **Courier Streak**: ${streakText}`,
    '',
    `Can you beat tonight's par? Route your run in ${subreddit}.`,
  ].join('\n');
};
