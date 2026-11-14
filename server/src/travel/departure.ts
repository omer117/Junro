import type { LatLng } from '@junro/solver';
import tzLookup from 'tz-lookup';

const MINUTE = 60_000;

/** How far a time zone is ahead of UTC at a given moment, in milliseconds. */
function offsetAt(timeZone: string, moment: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(moment));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const shown = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return shown - Math.floor(moment / 1000) * 1000;
}

/**
 * The moment (an ISO timestamp) for "this day at this clock time" where the place is.
 * Google wants an exact moment for public transport, and timetables are local, so a bare
 * "09:00" is not enough: the time zone of the place and daylight saving decide which moment it is.
 * (The time zone comes from the coordinates, offline.)
 *
 * Google rejects a departure in the past, so a moment that has already gone becomes two
 * minutes from now.
 */
export function departureInstant(args: {
  /** 'YYYY-MM-DD' */
  date: string;
  /** Minutes since midnight of that day (may pass 1440 for a day that runs past midnight). */
  minutes: number;
  at: LatLng;
  now: Date;
}): string {
  const timeZone = tzLookup(args.at.lat, args.at.lng);
  const [year, month, day] = args.date.split('-').map(Number) as [number, number, number];
  const asIfUtc = Date.UTC(year, month - 1, day) + args.minutes * MINUTE;

  // The offset depends on the moment, which is what we are looking for: guess, then correct once
  // (that also settles the hours around a daylight saving change).
  let moment = asIfUtc - offsetAt(timeZone, asIfUtc);
  moment = asIfUtc - offsetAt(timeZone, moment);

  const earliest = args.now.getTime() + 2 * MINUTE;
  return new Date(Math.max(moment, earliest)).toISOString();
}
