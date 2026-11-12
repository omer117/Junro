import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { HttpError } from '../errors.js';
import { GoogleNotConfiguredError } from '../google/errors.js';
import type { MapsClient, PlaceSuggestion } from '../google/types.js';
import type { RateLimiter } from '../rate-limit.js';

const searchQuery = z.object({
  q: z.string().trim().min(3).max(100),
  sessionToken: z.string().min(8).max(100),
});

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

export interface PlacesRouterDeps {
  /** Already wrapped by the usage guard. Undefined when no API key is configured. */
  maps: MapsClient | undefined;
  searchLimiter: RateLimiter;
  now?: () => number;
}

export function placesRouter({ maps, searchLimiter, now = Date.now }: PlacesRouterDeps): Router {
  const router = Router();
  router.use('/places', requireAuth);

  // Suggestions for the same text are the same for everyone, so a repeated search (typing,
  // deleting, typing again) is answered from memory and costs Google nothing.
  const cache = new Map<string, { at: number; value: PlaceSuggestion[] }>();

  router.get('/places/search', async (req, res) => {
    if (!maps) throw new GoogleNotConfiguredError();

    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'validation_error',
        'Invalid search',
        parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      );
    }
    const { q, sessionToken } = parsed.data;

    const key = q.toLowerCase().replace(/\s+/g, ' ');
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      res.json(hit.value);
      return;
    }

    if (!searchLimiter.allow(req.user!.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many searches. Wait a moment and try again.');
    }

    const value = await maps.autocomplete({ query: q, sessionToken });

    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now(), value });
    res.json(value);
  });

  return router;
}
