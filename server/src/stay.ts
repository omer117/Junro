import type { Category } from './db/schema.js';

/**
 * The shortest sensible visit per category, in minutes. A user's own preference can never
 * go below this. (A single stage may still be overridden by hand: that is the user's call.)
 */
export const SYSTEM_MINIMUM_STAY: Record<Category, number> = {
  restaurant: 45,
  cafe: 20,
  bar: 30,
  temple: 20,
  museum: 45,
  market: 30,
  park: 20,
  shop: 15,
  viewpoint: 10,
  /** A station or stop you only pass through. */
  transit: 5,
  other: 10,
};

export interface StayInputs {
  category: Category;
  /** The user's default for this category, if they set one. */
  preference?: number | null | undefined;
  /** A manual value for this one stage, if the user set one. */
  override?: number | null | undefined;
}

/** Stage override, then the user's preference for the category, then the system minimum. */
export function resolveStayMinutes({ category, preference, override }: StayInputs): number {
  if (override != null) return override;
  const minimum = SYSTEM_MINIMUM_STAY[category];
  // The API already refuses a preference below the minimum; the max() is a second guard.
  return preference != null ? Math.max(preference, minimum) : minimum;
}
