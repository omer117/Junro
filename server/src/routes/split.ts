import { createHash } from 'node:crypto';
import { MAX_STAGES, type SplitPlace } from '@junro/solver';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { categoryPreferences, days, places, stages } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { windowsForDate } from '../google/opening-hours.js';
import type { OpeningHours } from '../google/types.js';
import type { RateLimiter } from '../rate-limit.js';
import { resolveStayMinutes } from '../stay.js';
import { runSplitInWorker } from '../split/run-split.js';
import type { SplitRunner } from '../split/split-job.js';
import { validateBody } from '../validate.js';
import { uuidParam } from './helpers.js';
import { requireOwnedSegment } from './ownership.js';

export interface SplitRouterDeps {
  db: Db;
  limiter: RateLimiter;
  /** Defaults to a worker thread; tests run it inline. */
  runner?: SplitRunner;
}

const acceptBody = z.object({
  inputHash: z.string().min(1).max(100),
  days: z.array(z.object({ dayId: z.uuid(), stageIds: z.array(z.uuid()).max(MAX_STAGES) })).max(10),
});

/**
 * Everything the split depends on, read from the database: the days that are free to change, the
 * days that are already under way (frozen), and the places that may move. The same state is read
 * again when a proposal is accepted; a hash of it tells whether anything changed in between.
 */
async function loadSplitState(db: Db, userId: string, segmentId: string) {
  const dayRows = await db
    .select()
    .from(days)
    .where(eq(days.segmentId, segmentId))
    .orderBy(asc(days.date), asc(days.startTime), asc(days.id));
  const stageRows = await db
    .select({ stage: stages, place: places })
    .from(stages)
    .innerJoin(places, eq(stages.placeId, places.id))
    .where(eq(stages.segmentId, segmentId))
    .orderBy(asc(stages.createdAt), asc(stages.id));
  const preferences = await db
    .select()
    .from(categoryPreferences)
    .where(eq(categoryPreferences.userId, userId));
  const preferred = new Map(preferences.map((p) => [p.category, p.stayMinutes]));

  // A day with a place that is done is already under way: it stays as it is.
  const frozen = new Set(
    stageRows.filter((r) => r.stage.done && r.stage.dayId).map((r) => r.stage.dayId!),
  );
  const freeDays = dayRows.filter((d) => !frozen.has(d.id));
  const movable = stageRows
    .filter((r) => r.stage.dayId === null || (!r.stage.done && !frozen.has(r.stage.dayId)))
    .map((r) => ({
      ...r,
      stay: resolveStayMinutes({
        category: r.stage.category,
        preference: preferred.get(r.stage.category),
        override: r.stage.stayOverrideMinutes,
      }),
    }));

  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        days: freeDays.map((d) => [
          d.id,
          d.date,
          d.startLat,
          d.startLng,
          d.endLat,
          d.endLng,
          d.startTime,
          d.endTime,
          d.travelMode,
        ]),
        frozen: [...frozen].sort(),
        stages: movable.map((r) => [
          r.stage.id,
          r.stage.dayId,
          r.stage.pinnedTime,
          r.stage.priority,
          r.stay,
          r.place.id,
        ]),
      }),
    )
    .digest('hex');

  return { freeDays, frozen, movable, hash };
}

export function splitRouter({ db, limiter, runner = runSplitInWorker }: SplitRouterDeps): Router {
  const router = Router();
  router.use('/segments/:id/split', requireAuth);

  router.post('/segments/:id/split', async (req, res) => {
    const userId = req.user!.id;
    const segment = await requireOwnedSegment(db, userId, uuidParam(req.params.id));
    if (!limiter.allow(userId)) {
      throw new HttpError(429, 'rate_limited', 'Too many splits. Wait a moment.');
    }

    const { freeDays, frozen, movable, hash } = await loadSplitState(db, userId, segment.id);
    if (freeDays.length === 0) {
      throw new HttpError(409, 'no_days_to_split', 'Every day of this stay is already under way');
    }
    if (movable.length === 0) {
      throw new HttpError(409, 'nothing_to_split', 'Add some places to the stay first');
    }

    const dayIndex = new Map(freeDays.map((d, i) => [d.id, i]));
    const splitPlaces: SplitPlace[] = movable.map(({ stage, place, stay }) => ({
      id: stage.id,
      location: { lat: place.lat, lng: place.lng },
      stayMinutes: stay,
      priority: stage.priority,
      hours: freeDays.map((d) => windowsForDate(place.openingHours as OpeningHours | null, d.date)),
      ...(stage.pinnedTime !== null && stage.dayId !== null
        ? { pin: { day: dayIndex.get(stage.dayId)!, time: stage.pinnedTime } }
        : {}),
    }));
    // A re-run starts from where the places are now, so the plan stays steady.
    const onDays = movable.filter((m) => m.stage.dayId !== null);
    const current =
      onDays.length > 0
        ? Object.fromEntries(onDays.map((m) => [m.stage.id, dayIndex.get(m.stage.dayId!)!]))
        : undefined;

    const result = await runner({
      mode: segment.travelMode,
      days: freeDays.map((d) => ({
        id: d.id,
        start: { lat: d.startLat, lng: d.startLng },
        end: { lat: d.endLat, lng: d.endLng },
        startTime: d.startTime,
        ...(d.endTime !== null ? { endTime: d.endTime } : {}),
      })),
      places: splitPlaces,
      ...(current ? { current } : {}),
    });

    const newDay = new Map<string, string>();
    for (const day of result.days) for (const id of day.result.order) newDay.set(id, day.dayId);
    const moved = movable
      .filter(
        (m) =>
          m.stage.dayId !== null &&
          newDay.has(m.stage.id) &&
          newDay.get(m.stage.id) !== m.stage.dayId,
      )
      .map((m) => ({ stageId: m.stage.id, fromDayId: m.stage.dayId! }));

    res.json({
      days: result.days.map(({ dayId, result: r }) => ({
        dayId,
        order: r.order,
        visits: r.visits,
        endArrival: r.endArrival,
        violations: r.violations,
        dropped: r.dropped,
      })),
      leftOut: result.leftOut,
      frozenDayIds: [...frozen],
      score: result.score,
      moved,
      inputHash: hash,
      // The times come from distance guesses, not from Google; real times appear when a day is planned.
      estimated: true,
    });
  });

  router.post('/segments/:id/split/accept', validateBody(acceptBody), async (req, res) => {
    const userId = req.user!.id;
    const segment = await requireOwnedSegment(db, userId, uuidParam(req.params.id));
    const body = req.body as z.infer<typeof acceptBody>;

    const { freeDays, movable, hash } = await loadSplitState(db, userId, segment.id);
    if (hash !== body.inputHash) {
      throw new HttpError(
        409,
        'stale_proposal',
        'Your places changed since this plan was made. Split again.',
      );
    }

    const freeIds = new Set(freeDays.map((d) => d.id));
    const movableById = new Map(movable.map((m) => [m.stage.id, m.stage]));
    const assigned = new Map<string, string>(); // stage id -> day id
    for (const entry of body.days) {
      if (!freeIds.has(entry.dayId)) {
        throw new HttpError(400, 'bad_proposal', 'A day in the plan is not part of this stay');
      }
      for (const stageId of entry.stageIds) {
        if (!movableById.has(stageId) || assigned.has(stageId)) {
          throw new HttpError(400, 'bad_proposal', 'A place in the plan is not part of this stay');
        }
        assigned.set(stageId, entry.dayId);
      }
    }
    // A booked place has to stay on the day it was booked for.
    for (const stage of movableById.values()) {
      if (stage.pinnedTime !== null && assigned.get(stage.id) !== stage.dayId) {
        throw new HttpError(400, 'bad_proposal', 'A booked place has to stay on its day');
      }
    }

    await db.transaction(async (tx) => {
      const changedDays = new Set<string>();
      for (const stage of movableById.values()) {
        const to = assigned.get(stage.id) ?? null;
        if (to === stage.dayId) continue;
        if (stage.dayId) changedDays.add(stage.dayId);
        if (to) changedDays.add(to);
        await tx
          .update(stages)
          .set({
            dayId: to,
            position: null,
            dropped: false,
            ...(to === null ? { pinnedTime: null } : {}),
          })
          .where(eq(stages.id, stage.id));
      }
      // A day whose places changed needs a new calculation (its saved order no longer fits).
      if (changedDays.size > 0) {
        await tx
          .update(stages)
          .set({ position: null, dropped: false })
          .where(inArray(stages.dayId, [...changedDays]));
      }
    });

    const pool = await db
      .select({ id: stages.id })
      .from(stages)
      .where(and(eq(stages.segmentId, segment.id), isNull(stages.dayId)));
    res.json({ ok: true, inPool: pool.length });
  });

  return router;
}
