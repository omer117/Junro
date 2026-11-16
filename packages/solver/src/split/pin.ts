import type { Minutes, TimeWindow } from '../types.js';

/** A booked time may be started this many minutes late before it counts as lateness. */
export const PIN_SLACK = 15;

/**
 * The only time window of a place that was booked for a time: from the booked time until the stay
 * is over plus a little slack. Arriving early means waiting for it; the booking wins over the
 * place's own opening hours. The day solve and the split both use it, so a booking behaves the
 * same everywhere.
 */
export function pinWindow(time: Minutes, stayMinutes: number): TimeWindow {
  return { open: time, close: time + stayMinutes + PIN_SLACK };
}
