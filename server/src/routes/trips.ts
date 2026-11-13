import { and, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import type { Db } from '../db/client.js';
import { airports, trips } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { validateBody } from '../validate.js';
import { notFoundError, uuidParam } from './helpers.js';

/** An airport as a three-letter IATA code. Lower case is accepted and turned into upper case. */
const airportCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter airport code, for example TLV');

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  originAirport: airportCode.optional(),
  destinationAirport: airportCode.optional(),
});

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    /** null clears the airport. */
    originAirport: airportCode.nullable().optional(),
    destinationAirport: airportCode.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');

const origin = alias(airports, 'origin');
const destination = alias(airports, 'destination');

/** What the client sees of a trip: never the owner's id. */
const publicTrip = {
  id: trips.id,
  name: trips.name,
  createdAt: trips.createdAt,
  originCode: trips.originAirport,
  destinationCode: trips.destinationAirport,
  origin: {
    iata: origin.iataCode,
    name: origin.name,
    city: origin.city,
    countryCode: origin.countryCode,
    countryName: origin.countryName,
  },
  destination: {
    iata: destination.iataCode,
    name: destination.name,
    city: destination.city,
    countryCode: destination.countryCode,
    countryName: destination.countryName,
  },
};

type Row = {
  id: string;
  name: string;
  createdAt: Date;
  originCode: string | null;
  destinationCode: string | null;
  origin: { iata: string | null } & Record<string, string | null>;
  destination: { iata: string | null } & Record<string, string | null>;
};

/** A trip as the API sends it: the airports are whole objects, or null when not set. */
function toTrip(row: Row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    origin: row.originCode ? row.origin : null,
    destination: row.destinationCode ? row.destination : null,
  };
}

/** Checks the codes exist in the airports list and are not the same airport. */
async function checkAirports(
  db: Db,
  from: string | null | undefined,
  to: string | null | undefined,
) {
  if (from && to && from === to) {
    throw new HttpError(400, 'same_airport', 'The origin and the destination must differ.');
  }
  const wanted = [from, to].filter((code): code is string => Boolean(code));
  if (wanted.length === 0) return;
  const found = await db
    .select({ code: airports.iataCode })
    .from(airports)
    .where(inArray(airports.iataCode, wanted));
  const known = new Set(found.map((row) => row.code));
  const missing = wanted.find((code) => !known.has(code));
  if (missing) {
    throw new HttpError(400, 'unknown_airport', `There is no airport with the code ${missing}.`);
  }
}

/**
 * Every query filters by the signed-in user's id, so a trip that belongs to someone else
 * simply does not exist for this user (404, never 403: we do not reveal that it exists).
 */
export function tripsRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth);

  const select = () =>
    db
      .select(publicTrip)
      .from(trips)
      .leftJoin(origin, eq(trips.originAirport, origin.iataCode))
      .leftJoin(destination, eq(trips.destinationAirport, destination.iataCode));

  const loadOwned = async (id: string, userId: string) => {
    const [row] = await select().where(and(eq(trips.id, id), eq(trips.userId, userId)));
    return row as Row | undefined;
  };

  router.get('/', async (req, res) => {
    const rows = await select()
      .where(eq(trips.userId, req.user!.id))
      .orderBy(desc(trips.createdAt));
    res.json((rows as Row[]).map(toTrip));
  });

  router.post('/', validateBody(createBody), async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    await checkAirports(db, body.originAirport, body.destinationAirport);
    const [created] = await db
      .insert(trips)
      .values({
        userId: req.user!.id,
        name: body.name,
        originAirport: body.originAirport ?? null,
        destinationAirport: body.destinationAirport ?? null,
      })
      .returning({ id: trips.id });
    res.status(201).json(toTrip((await loadOwned(created!.id, req.user!.id))!));
  });

  router.get('/:id', async (req, res) => {
    const trip = await loadOwned(uuidParam(req.params.id), req.user!.id);
    if (!trip) throw notFoundError();
    res.json(toTrip(trip));
  });

  router.patch('/:id', validateBody(patchBody), async (req, res) => {
    const id = uuidParam(req.params.id);
    const current = await loadOwned(id, req.user!.id);
    if (!current) throw notFoundError();

    const body = req.body as z.infer<typeof patchBody>;
    const nextOrigin = body.originAirport !== undefined ? body.originAirport : current.originCode;
    const nextDestination =
      body.destinationAirport !== undefined ? body.destinationAirport : current.destinationCode;
    await checkAirports(db, nextOrigin, nextDestination);

    await db
      .update(trips)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.originAirport !== undefined && { originAirport: body.originAirport }),
        ...(body.destinationAirport !== undefined && {
          destinationAirport: body.destinationAirport,
        }),
      })
      .where(and(eq(trips.id, id), eq(trips.userId, req.user!.id)));
    res.json(toTrip((await loadOwned(id, req.user!.id))!));
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
