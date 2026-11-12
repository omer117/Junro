import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { QuotaExceededError } from './errors.js';

export { QuotaExceededError };

/** Every Google API we call. Each has its own monthly cap. */
export const GOOGLE_APIS = [
  'autocomplete',
  'placeDetails',
  'routeMatrix',
  'computeRoutes',
] as const;
export type GoogleApi = (typeof GOOGLE_APIS)[number];

/** Monthly caps. `routeMatrix` counts matrix elements (origins x destinations), the rest count calls. */
export type QuotaCaps = Record<GoogleApi, number>;

/** The billing month Google uses: it resets free usage at midnight Pacific time on the 1st. */
export function usageMonth(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}`;
}

export interface UsageGuard {
  /** Call this BEFORE every Google request. Throws QuotaExceededError instead of going over the cap. */
  consume(api: GoogleApi, units?: number): Promise<void>;
  usage(): Promise<Record<GoogleApi, number>>;
}

export function createUsageGuard(deps: { db: Db; caps: QuotaCaps; now?: () => Date }): UsageGuard {
  const { db, caps } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async consume(api, units = 1) {
      const cap = caps[api];
      if (units > cap) throw new QuotaExceededError(api);

      // One atomic statement: add the units only if the total stays within the cap. Two
      // requests at the same moment cannot both squeeze in, because the database checks
      // the condition and updates the row as a single step. No row returned = refused.
      const result = await db.execute(sql`
        INSERT INTO api_usage (api, month, used)
        VALUES (${api}, ${usageMonth(now())}, ${units})
        ON CONFLICT (api, month) DO UPDATE
          SET used = api_usage.used + ${units}
          WHERE api_usage.used + ${units} <= ${cap}
        RETURNING used`);
      if (result.rows.length === 0) throw new QuotaExceededError(api);
    },

    async usage() {
      const result = await db.execute(
        sql`SELECT api, used FROM api_usage WHERE month = ${usageMonth(now())}`,
      );
      const used = Object.fromEntries(GOOGLE_APIS.map((api) => [api, 0])) as Record<
        GoogleApi,
        number
      >;
      for (const row of result.rows as Array<{ api: GoogleApi; used: number }>)
        used[row.api] = row.used;
      return used;
    },
  };
}
