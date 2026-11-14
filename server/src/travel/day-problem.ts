import type { LatLng, Stage } from '@junro/solver';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { categoryPreferences, places, stages, type LiveFrom, type days } from '../db/schema.js';
import { windowForDate } from '../google/opening-hours.js';
import type { OpeningHours } from '../google/types.js';
import { resolveStayMinutes } from '../stay.js';

type DayRow = typeof days.$inferSelect;
type StageRow = typeof stages.$inferSelect;

export interface DayProblem {
  start: LatLng;
  end: LatLng;
  /** The day's stops in the order they were added, ready for the solver. */
  solverStages: Stage[];
  /** The rows behind them, same order. */
  rows: Array<{ stage: StageRow }>;
  /** Stop ids in the route that was saved, in route order. Empty before the first solve. */
  savedIds: string[];
}

/**
 * Everything the solver needs to know about a day, read from the database: each stop's place,
 * its stay (stage override, then the user's preference, then the system minimum) and that
 * weekday's opening window.
 *
 * The stops come in the order they were added. A full solve starts from this order, so the same
 * stops give the same answer every time (stops that tie never swap places between runs).
 */
export async function loadDayProblem(db: Db, userId: string, day: DayRow): Promise<DayProblem> {
  const rows = await db
    .select({ stage: stages, place: places })
    .from(stages)
    .innerJoin(places, eq(stages.placeId, places.id))
    .where(eq(stages.dayId, day.id))
    .orderBy(asc(stages.createdAt), asc(stages.id));

  const preferences = await db
    .select()
    .from(categoryPreferences)
    .where(eq(categoryPreferences.userId, userId));
  const preferred = new Map(preferences.map((p) => [p.category, p.stayMinutes]));

  const solverStages: Stage[] = rows.map(({ stage, place }) => ({
    id: stage.id,
    location: { lat: place.lat, lng: place.lng },
    stayMinutes: resolveStayMinutes({
      category: stage.category,
      preference: preferred.get(stage.category),
      override: stage.stayOverrideMinutes,
    }),
    ...windowForDate(place.openingHours as OpeningHours | null, day.date),
  }));

  const savedIds = rows
    .filter((r) => r.stage.position !== null)
    .sort((a, b) => a.stage.position! - b.stage.position!)
    .map((r) => r.stage.id);

  return {
    start: { lat: day.startLat, lng: day.startLng },
    end: { lat: day.endLat, lng: day.endLng },
    solverStages,
    rows,
    savedIds,
  };
}

/** What is left of the day to plan: done stops are out, and the start may be where the person is now. */
export interface Remaining {
  start: LatLng;
  end: LatLng;
  startTime: number;
  /** The stops not done yet, ready for the solver. */
  solverStages: Stage[];
  /** Done stop ids, in the order they had. */
  doneIds: string[];
  /** Not-done stop ids in the saved route order. */
  savedIds: string[];
  /** Where the person was when the day was replanned mid-day, or null. */
  live: LiveFrom | null;
}

/**
 * The day as it stands: stops that are done are left out, and if the day was replanned from the
 * person's location (`live`), the route starts there at that time. The end point never changes.
 */
export function remainingOf(problem: DayProblem, day: DayRow, live: LiveFrom | null): Remaining {
  const done = problem.rows
    .filter((r) => r.stage.done)
    .sort((a, b) => (a.stage.position ?? Infinity) - (b.stage.position ?? Infinity))
    .map((r) => r.stage.id);
  const isDone = new Set(done);
  return {
    start: live ? { lat: live.lat, lng: live.lng } : problem.start,
    end: problem.end,
    startTime: live ? live.time : day.startTime,
    solverStages: problem.solverStages.filter((s) => !isDone.has(s.id)),
    doneIds: done,
    savedIds: problem.savedIds.filter((id) => !isDone.has(id)),
    live,
  };
}
