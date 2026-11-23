import { context, reddit } from '@devvit/web/server';

/**
 * Returns the canonical, authenticated Reddit user ID (e.g. "t2_...").
 * Strictly extracts context.userId without falling back to usernames.
 */
export const getCanonicalUserId = (): string | undefined => {
  try {
    const rawId = context.userId;
    if (typeof rawId === 'string' && rawId.trim().length > 0) {
      return rawId.trim();
    }
  } catch {
    // Outside server request or unauthenticated
  }
  return undefined;
};

/**
 * Resolves the display username for presentation in UI/responses.
 * Never used for persistence or Redis key namespacing.
 */
export const getDisplayUsername = async (): Promise<string | undefined> => {
  try {
    const raw = context.username;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  } catch {
    // Outside server request
  }

  try {
    const current = await reddit.getCurrentUsername();
    if (typeof current === 'string' && current.trim().length > 0) {
      return current.trim();
    }
  } catch {
    // Unauthenticated or Reddit API unavailable
  }

  return undefined;
};
