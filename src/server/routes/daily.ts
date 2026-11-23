import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatUtcDate, getDailyMap, getUtcDayIndex } from '../../shared/dates.ts';
import type { DailyResponse, GameMap } from '../../shared/types';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getUserDailyStats } from '../services/stats.ts';

export const daily = new Hono();

export const getDailyPayload = async (userIdOverride?: string): Promise<DailyResponse> => {
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

  let userId: string | undefined = userIdOverride;
  let username: string | undefined = userIdOverride;
  let postId: string | undefined;

  if (!userId) {
    try {
      userId = context.userId ?? context.username;
      username = context.username;
      if (context.postId) {
        postId = context.postId;
      }
    } catch {
      // Headless test or outside server request
    }
  }

  if (!userId) {
    try {
      const currentUsername = await reddit.getCurrentUsername();
      if (currentUsername) {
        userId = currentUsername;
        username = currentUsername;
      }
    } catch (err) {
      console.warn('[Daily API] Unable to fetch current username from Reddit:', err);
    }
  }

  const {
    streak,
    bestMoves,
    completions,
    attempt,
    alreadyCompleted,
  } = await getUserDailyStats(userId, dayIndex);

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
  const headerUserId = c.req.header('x-user-id');
  const payload = await getDailyPayload(headerUserId);
  return c.json<DailyResponse>(payload);
});
