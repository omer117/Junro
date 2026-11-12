import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { trips } from '../db/schema.js';
import { validateBody } from '../validate.js';
import { notFoundError, uuidParam } from './helpers.js';

const tripBody = z.object({ name: z.string().trim().min(1).max(100) });

/** What the client sees of a trip: never the owner's id. */
const publicTrip = { id: trips.id, name: trips.name, createdAt: trips.createdAt };

/**
 * Every query filters by the signed-in user's id, so a trip that belongs to someone else
 * simply does not exist for this user (404, never 403: we do not reveal that it exists).
 */
export function tripsRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const rows = await db
      .select(publicTrip)
      .from(trips)
      .where(eq(trips.userId, req.user!.id))
      .orderBy(desc(trips.createdAt));
    res.json(rows);
  });

  router.post('/', validateBody(tripBody), async (req, res) => {
    const [trip] = await db
      .insert(trips)
      .values({ userId: req.user!.id, name: req.body.name })
      .returning(publicTrip);
    res.status(201).json(trip);
  });

  router.get('/:id', async (req, res) => {
    const [trip] = await db
      .select(publicTrip)
      .from(trips)
      .where(and(eq(trips.id, uuidParam(req.params.id)), eq(trips.userId, req.user!.id)));
    if (!trip) throw notFoundError();
    res.json(trip);
  });

  router.patch('/:id', validateBody(tripBody), async (req, res) => {
    const [trip] = await db
      .update(trips)
      .set({ name: req.body.name })
      .where(and(eq(trips.id, uuidParam(req.params.id)), eq(trips.userId, req.user!.id)))
      .returning(publicTrip);
    if (!trip) throw notFoundError();
    res.json(trip);
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await db
      .delete(trips)
      .where(and(eq(trips.id, uuidParam(req.params.id)), eq(trips.userId, req.user!.id)))
      .returning({ id: trips.id });
    if (deleted.length === 0) throw notFoundError();
    res.sendStatus(204);
  });

  return router;
}
