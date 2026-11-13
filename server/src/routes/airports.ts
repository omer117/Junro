import { asc, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { airports } from '../db/schema.js';
import { HttpError } from '../errors.js';

const query = z.object({
  q: z.string().trim().min(2).max(50),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/** % and _ would act as wildcards in a LIKE search; a person typing them means the characters. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Search the airports list by code, name, city or country, to pick where a trip starts and ends. */
export function airportsRouter(db: Db): Router {
  const router = Router();
  router.use('/airports', requireAuth);

  router.get('/airports', async (req, res) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'validation_error',
        'Invalid search',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const { q, limit } = parsed.data;
    const pattern = `%${escapeLike(q)}%`;

    const rows = await db
      .select({
        iata: airports.iataCode,
        name: airports.name,
        city: airports.city,
        countryCode: airports.countryCode,
        countryName: airports.countryName,
      })
      .from(airports)
      .where(
        or(
          sql`${airports.iataCode} ILIKE ${pattern}`,
          sql`${airports.name} ILIKE ${pattern}`,
          sql`${airports.city} ILIKE ${pattern}`,
          sql`${airports.countryName} ILIKE ${pattern}`,
        ),
      )
      // An exact code ("TLV") first, then the biggest and busiest.
      .orderBy(sql`(${airports.iataCode} = ${q.toUpperCase()}) DESC`, asc(airports.rank))
      .limit(limit);

    res.json(rows);
  });

  return router;
}
