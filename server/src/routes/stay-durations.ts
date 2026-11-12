import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { CATEGORIES, categoryPreferences, type Category } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { SYSTEM_MINIMUM_STAY } from '../stay.js';
import { validateBody } from '../validate.js';
import { notFoundError } from './helpers.js';

const body = z.object({ stayMinutes: z.number().int().min(1).max(1440) });

function categoryParam(value: unknown): Category {
  const parsed = z.enum(CATEGORIES).safeParse(value);
  if (!parsed.success) throw notFoundError();
  return parsed.data;
}

const view = (category: Category, preferenceMinutes: number | null) => ({
  category,
  minimumMinutes: SYSTEM_MINIMUM_STAY[category],
  preferenceMinutes,
});

/** The signed-in user's own default stay per category. Only ever touches their own rows. */
export function stayDurationsRouter(db: Db): Router {
  const router = Router();
  router.use('/me/stay-durations', requireAuth);

  router.get('/me/stay-durations', async (req, res) => {
    const rows = await db
      .select()
      .from(categoryPreferences)
      .where(eq(categoryPreferences.userId, req.user!.id));
    const byCategory = new Map(rows.map((r) => [r.category, r.stayMinutes]));
    res.json(CATEGORIES.map((category) => view(category, byCategory.get(category) ?? null)));
  });

  router.put('/me/stay-durations/:category', validateBody(body), async (req, res) => {
    const category = categoryParam(req.params.category);
    const { stayMinutes } = req.body as z.infer<typeof body>;
    const minimum = SYSTEM_MINIMUM_STAY[category];
    if (stayMinutes < minimum) {
      throw new HttpError(
        400,
        'below_minimum',
        `The shortest stay for ${category} is ${minimum} minutes`,
      );
    }
    await db
      .insert(categoryPreferences)
      .values({ userId: req.user!.id, category, stayMinutes })
      .onConflictDoUpdate({
        target: [categoryPreferences.userId, categoryPreferences.category],
        set: { stayMinutes },
      });
    res.json(view(category, stayMinutes));
  });

  router.delete('/me/stay-durations/:category', async (req, res) => {
    const category = categoryParam(req.params.category);
    await db
      .delete(categoryPreferences)
      .where(
        and(
          eq(categoryPreferences.userId, req.user!.id),
          eq(categoryPreferences.category, category),
        ),
      );
    res.sendStatus(204);
  });

  return router;
}
