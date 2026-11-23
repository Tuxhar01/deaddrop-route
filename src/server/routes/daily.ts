import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatUtcDate, getDailyMap, getUtcDayIndex } from '../../shared/dates.ts';
import type { DailyResponse, GameMap } from '../../shared/types';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getUserDailyStats, type RedisClientLike } from '../services/stats.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getCanonicalUserId, getDisplayUsername } from '../auth.ts';

export type DailyEnv = {
  Bindings: {
    redisClient?: RedisClientLike;
  };
};

export const daily = new Hono<DailyEnv>();

export type DailyOptions = {
  redisClient?: RedisClientLike;
};

export const getDailyPayload = async (
  options: DailyOptions = {}
): Promise<DailyResponse> => {
  const dayIndex = getUtcDayIndex();
  const date = formatUtcDate();
  const rawMap = getDailyMap(dayIndex);

  // Guarantee clean map payload without exposing any solver/solution metadata
  const map: GameMap = {
    id: rawMap.id,
    grid: rawMap.grid,
    depot: { x: rawMap.depot.x, y: rawMap.depot.y },
    drops: rawMap.drops.map((d) => ({ x: d.x, y: d.y })),
    par: rawMap.par,
    ...(rawMap.initialBudget !== undefined ? { initialBudget: rawMap.initialBudget } : {}),
  };

  const userId = getCanonicalUserId();
  const username = await getDisplayUsername();

  let postId: string | undefined;
  try {
    if (typeof context.postId === 'string' && context.postId.trim().length > 0) {
      postId = context.postId.trim();
    }
  } catch {
    // Outside server request
  }

  const client = options.redisClient ?? redis;
  const {
    streak,
    bestMoves,
    completions,
    attempt,
    alreadyCompleted,
  } = await getUserDailyStats(userId, dayIndex, client);

  const response: DailyResponse = {
    dayIndex,
    date,
    map,
    par: map.par,
    streak,
    bestMoves,
    ...(username ? { username } : {}),
    completions,
    ...(postId ? { postId } : {}),
    attempt,
    alreadyCompleted,
  };

  return response;
};

daily.get('/', async (c) => {
  const redisClient = c.env?.redisClient ?? redis;
  const payload = await getDailyPayload({ redisClient });
  return c.json<DailyResponse>(payload);
});
