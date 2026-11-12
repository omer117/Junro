import { MAX_STAGES } from '@junro/solver';
import { asc, count, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { CATEGORIES, places, stages } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { requireOwnedDay, requireOwnedStage } from './ownership.js';

/** A manual stay for one stage, in minutes (at most a full day). */
const override = z.number().int().min(1).max(1440);

const createBody = z.object({
  placeId: z.uuid(),
  category: z.enum(CATEGORIES),
  stayOverrideMinutes: override.optional(),
});

const patchBody = z.object({
  category: z.enum(CATEGORIES).optional(),
  /** null removes the override. */
  stayOverrideMinutes: override.nullable().optional(),
  done: z.boolean().optional(),
});

const stageWithPlace = {
  id: stages.id,
  dayId: stages.dayId,
  category: stages.category,
  stayOverrideMinutes: stages.stayOverrideMinutes,
  done: stages.done,
  place: {
    id: places.id,
    googlePlaceId: places.googlePlaceId,
    name: places.name,
    lat: places.lat,
    lng: places.lng,
  },
};

export function stagesRouter(db: Db): Router {
  const router = Router();
  router.use(['/days/:dayId/stages', '/stages'], requireAuth);

  const loadStage = async (id: string) => {
    const [row] = await db
      .select(stageWithPlace)
      .from(stages)
      .innerJoin(places, eq(stages.placeId, places.id))
      .where(eq(stages.id, id));
    return row!;
  };

  router.get('/days/:dayId/stages', async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.dayId));
    const rows = await db
      .select(stageWithPlace)
      .from(stages)
      .innerJoin(places, eq(stages.placeId, places.id))
      .where(eq(stages.dayId, day.id))
      .orderBy(asc(stages.createdAt), asc(stages.id));
    res.json(rows);
  });

  router.post('/days/:dayId/stages', validateBody(createBody), async (req, res) => {
    const day = await requireOwnedDay(db, req.user!.id, uuidParam(req.params.dayId));
    const body = req.body as z.infer<typeof createBody>;

    const [existing] = await db
      .select({ total: count() })
      .from(stages)
      .where(eq(stages.dayId, day.id));
    if (existing!.total >= MAX_STAGES) {
      throw new HttpError(409, 'day_full', `A day can have at most ${MAX_STAGES} stages`);
    }

    const [place] = await db
      .select({ id: places.id })
      .from(places)
      .where(eq(places.id, body.placeId));
    if (!place) throw new HttpError(400, 'unknown_place', 'That place does not exist');

    const [created] = await db
      .insert(stages)
      .values({
        dayId: day.id,
        placeId: body.placeId,
        category: body.category,
        ...(body.stayOverrideMinutes !== undefined && {
          stayOverrideMinutes: body.stayOverrideMinutes,
        }),
      })
      .returning({ id: stages.id });
    res.status(201).json(await loadStage(created!.id));
  });

  router.get('/stages/:id', async (req, res) => {
    const stage = await requireOwnedStage(db, req.user!.id, uuidParam(req.params.id));
    res.json(await loadStage(stage.id));
  });

  router.patch('/stages/:id', validateBody(patchBody), async (req, res) => {
    const stage = await requireOwnedStage(db, req.user!.id, uuidParam(req.params.id));
    const body = req.body as z.infer<typeof patchBody>;
    const changes = {
      ...(body.category !== undefined && { category: body.category }),
      ...(body.stayOverrideMinutes !== undefined && {
        stayOverrideMinutes: body.stayOverrideMinutes,
      }),
      ...(body.done !== undefined && { done: body.done }),
    };
    if (Object.keys(changes).length > 0) {
      await db.update(stages).set(changes).where(eq(stages.id, stage.id));
    }
    res.json(await loadStage(stage.id));
  });

  router.delete('/stages/:id', async (req, res) => {
    const stage = await requireOwnedStage(db, req.user!.id, uuidParam(req.params.id));
    await db.delete(stages).where(eq(stages.id, stage.id));
    res.sendStatus(204);
  });

  return router;
}
