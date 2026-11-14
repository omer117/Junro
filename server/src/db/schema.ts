import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** A stored route line, oldest first in a day's list (a jsonb object would not keep its order). */
export interface LiveFrom {
  lat: number;
  lng: number;
  time: number;
}

export interface RouteLine {
  fingerprint: string;
  line: string;
}

/** The fixed list of stage categories (hardcoded on purpose, see the spec). */
export const CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'temple',
  'museum',
  'market',
  'park',
  'shop',
  'viewpoint',
  'transit',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const TRAVEL_MODES = ['walking', 'driving', 'transit'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

export const categoryEnum = pgEnum('category', CATEGORIES);
export const travelModeEnum = pgEnum('travel_mode', TRAVEL_MODES);

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Which sign-in provider ('google' in beta). More providers need no schema change. */
    provider: text('provider').notNull(),
    /** The user's id at that provider. */
    providerId: text('provider_id').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('users_provider_identity').on(t.provider, t.providerId)],
);

/** A user's own default stay per category. Never below the system minimum (enforced in the API). */
export const categoryPreferences = pgTable(
  'category_preferences',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: categoryEnum('category').notNull(),
    stayMinutes: integer('stay_minutes').notNull(),
  },
  (t) => [unique('category_preferences_user_category').on(t.userId, t.category)],
);

export const trips = pgTable(
  'trips',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Where the trip starts and ends, as airports from the airports list. Optional. */
    originAirport: text('origin_airport').references(() => airports.iataCode, {
      onDelete: 'set null',
    }),
    destinationAirport: text('destination_airport').references(() => airports.iataCode, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('trips_user_idx').on(t.userId)],
);

export const days = pgTable(
  'days',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    startLat: doublePrecision('start_lat').notNull(),
    startLng: doublePrecision('start_lng').notNull(),
    endLat: doublePrecision('end_lat').notNull(),
    endLng: doublePrecision('end_lng').notNull(),
    /** What to call the two ends of the day, for example "Hotel". Optional. */
    startName: text('start_name'),
    endName: text('end_name'),
    /** Minutes since midnight, same unit as the solver. */
    startTime: integer('start_time').notNull(),
    travelMode: travelModeEnum('travel_mode').notNull(),
    /**
     * Route lines for the map, one per route (a fingerprint of the mode and the stops in order),
     * so the same route is never bought twice and going back to an earlier one is free.
     */
    /** Set when the day was replanned mid-day: where the person was, and the time (minutes). */
    liveFrom: jsonb('live_from').$type<LiveFrom>(),
    /** Public transport days: the moment (ISO timestamp) the saved route was planned for. */
    transitDeparture: text('transit_departure'),
    routeLines: jsonb('route_lines').$type<RouteLine[]>().notNull().default([]),
  },
  (t) => [index('days_trip_idx').on(t.tripId)],
);

/** Google place data, fetched once and shared by every user (protects the free tier). */
export const places = pgTable('places', {
  id: id(),
  googlePlaceId: text('google_place_id').notNull().unique(),
  name: text('name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  /** Raw opening hours from Google; parsed into time windows per date at solve time. */
  openingHours: jsonb('opening_hours'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stages = pgTable(
  'stages',
  {
    id: id(),
    dayId: uuid('day_id')
      .notNull()
      .references(() => days.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'restrict' }),
    category: categoryEnum('category').notNull(),
    /** Manual override for this one stage; wins over the user's preference. */
    stayOverrideMinutes: integer('stay_override_minutes'),
    done: boolean('done').notNull().default(false),
    /** Place in the solved route (0 = first). null until the day has been solved. */
    position: integer('position'),
    createdAt: createdAt(),
  },
  (t) => [index('stages_day_idx').on(t.dayId)],
);

/** Route matrix for a day, cached so we do not pay Google twice for the same inputs. */
export const routeMatrixCache = pgTable(
  'route_matrix_cache',
  {
    dayId: uuid('day_id')
      .notNull()
      .references(() => days.id, { onDelete: 'cascade' }),
    travelMode: travelModeEnum('travel_mode').notNull(),
    /** Hash of the places in the matrix; a different set of stages means a different matrix. */
    inputHash: text('input_hash').notNull(),
    matrix: jsonb('matrix').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.dayId, t.travelMode] })],
);

/** How many Google calls (or billable units) we used in a month, per API. See google/guard.ts. */
export const apiUsage = pgTable(
  'api_usage',
  {
    api: text('api').notNull(),
    /** 'YYYY-MM' in Pacific time, the month Google bills by. */
    month: text('month').notNull(),
    used: integer('used').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.api, t.month] })],
);

/**
 * About 300 of the world's biggest and busiest airports, at least one per country. Reference
 * data: it is loaded by `npm run db:seed:airports` from server/data/airports.json and is the same
 * for everyone. The IATA code ("TLV") is the key.
 */
export const airports = pgTable(
  'airports',
  {
    iataCode: text('iata_code').primaryKey(),
    icaoCode: text('icao_code'),
    name: text('name').notNull(),
    city: text('city').notNull(),
    countryCode: text('country_code').notNull(),
    countryName: text('country_name').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** 1 = the biggest and busiest of the list. */
    rank: integer('rank').notNull(),
  },
  (t) => [index('airports_country_idx').on(t.countryCode), index('airports_rank_idx').on(t.rank)],
);
