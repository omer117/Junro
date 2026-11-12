import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { places } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { GoogleNotConfiguredError } from '../google/errors.js';
import type { MapsClient, PlaceSuggestion } from '../google/types.js';
import type { RateLimiter } from '../rate-limit.js';
import { validateBody } from '../validate.js';

const searchQuery = z.object({
  q: z.string().trim().min(3).max(100),
  sessionToken: z.string().min(8).max(100),
});

/** Real Google place ids look like "ChIJ...": letters, digits, - and _. Anything else is refused up front. */
const createBody = z.object({
  googlePlaceId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  sessionToken: z.string().min(8).max(100).optional(),
});

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

export interface PlacesRouterDeps {
  db: Db;
  /** Already wrapped by the usage guard. Undefined when no API key is configured. */
  maps: MapsClient | undefined;
  searchLimiter: RateLimiter;
  placeLimiter: RateLimiter;
  now?: () => number;
}

/** What the client sees of a place. The stored opening hours stay on the server. */
const publicPlace = {
  id: places.id,
  googlePlaceId: places.googlePlaceId,
  name: places.name,
  lat: places.lat,
  lng: places.lng,
};

export function placesRouter({
  db,
  maps,
  searchLimiter,
  placeLimiter,
  now = Date.now,
}: PlacesRouterDeps): Router {
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
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
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

  // Places that are being fetched right now, so two people adding the same new place at the
  // same moment cost one Google call, not two.
  const inFlight = new Map<string, Promise<PublicPlace>>();

  const findStored = async (googlePlaceId: string) => {
    const [row] = await db
      .select(publicPlace)
      .from(places)
      .where(eq(places.googlePlaceId, googlePlaceId));
    return row;
  };

  router.post('/places', validateBody(createBody), async (req, res) => {
    const { googlePlaceId, sessionToken } = req.body as z.infer<typeof createBody>;

    // A place we already have never goes back to Google, for any user.
    const stored = await findStored(googlePlaceId);
    if (stored) {
      res.status(200).json(stored);
      return;
    }

    if (!maps) throw new GoogleNotConfiguredError();

    const pending = inFlight.get(googlePlaceId);
    if (pending) {
      res.status(200).json(await pending);
      return;
    }

    if (!placeLimiter.allow(req.user!.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many new places. Wait a moment and try again.');
    }

    const fetching = (async () => {
      const details = await maps.placeDetails({
        googlePlaceId,
        ...(sessionToken ? { sessionToken } : {}),
      });
      await db
        .insert(places)
        .values({
          // Keyed by the id we were asked for, so the same id never costs a second fetch.
          googlePlaceId,
          name: details.name,
          lat: details.lat,
          lng: details.lng,
          openingHours: details.openingHours,
        })
        .onConflictDoNothing();
      return (await findStored(googlePlaceId))!;
    })();

    inFlight.set(googlePlaceId, fetching);
    try {
      res.status(201).json(await fetching);
    } finally {
      inFlight.delete(googlePlaceId);
    }
  });

  return router;
}

type PublicPlace = { id: string; googlePlaceId: string; name: string; lat: number; lng: number };
