import seedsData from './seeds.json' with { type: 'json' };
import type { GameMap, TileType } from './types';

/**
 * Fixed UTC Launch Epoch: 2026-11-23T00:00:00Z
 */
export const LAUNCH_DATE_UTC = '2026-11-23T00:00:00Z';
export const LAUNCH_EPOCH_MS = Date.parse(LAUNCH_DATE_UTC);
export const MS_PER_DAY = 86_400_000;

/**
 * Type guard for TileType without casting.
 */
const isTileType = (val: string): val is TileType => {
  return (
    val === 'road' ||
    val === 'block' ||
    val === 'depot' ||
    val === 'drop' ||
    val === 'congested' ||
    val === 'relay'
  );
};

const parseMap = (raw: (typeof seedsData)[number]): GameMap => {
  const grid: TileType[][] = raw.grid.map((row) =>
    row.map((cell) => {
      if (isTileType(cell)) {
        return cell;
      }
      throw new Error(`Invalid tile type: ${cell}`);
    })
  );

  return {
    id: raw.id,
    grid,
    depot: { x: raw.depot.x, y: raw.depot.y },
    drops: raw.drops.map((d) => ({ x: d.x, y: d.y })),
    par: raw.par,
  };
};

export const SEEDS: GameMap[] = seedsData.map(parseMap);

/**
 * Computes the whole integer UTC days elapsed since the fixed launch date.
 * Guarantees a non-negative integer (0 for any time on or before launch day).
 */
export const getUtcDayIndex = (dateOrTimestamp?: Date | number): number => {
  const timestamp =
    typeof dateOrTimestamp === 'number'
      ? dateOrTimestamp
      : (dateOrTimestamp?.getTime() ?? Date.now());

  const diffMs = timestamp - LAUNCH_EPOCH_MS;
  if (diffMs <= 0) {
    return 0;
  }
  return Math.floor(diffMs / MS_PER_DAY);
};

/**
 * Formats a given date or timestamp into a UTC date string: YYYY-MM-DD.
 */
export const formatUtcDate = (dateOrTimestamp?: Date | number): string => {
  const d =
    typeof dateOrTimestamp === 'number'
      ? new Date(dateOrTimestamp)
      : (dateOrTimestamp ?? new Date());

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Computes non-negative seed index: dayIndex % seeds.length
 */
export const getDailySeedIndex = (dayIndex: number): number => {
  const len = SEEDS.length;
  if (len === 0) {
    return 0;
  }
  return ((dayIndex % len) + len) % len;
};

/**
 * Selects today's map deterministically from seeds.json via seeds[dayIndex % seeds.length].
 */
export const getDailyMap = (dayIndex: number): GameMap => {
  const index = getDailySeedIndex(dayIndex);
  const selected = SEEDS[index];
  if (!selected) {
    throw new Error(`Invalid seed selection for dayIndex ${dayIndex} at index ${index}`);
  }
  return selected;
};
