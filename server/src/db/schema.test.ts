import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import {
  categoryPreferences,
  days,
  places,
  routeMatrixCache,
  stages,
  trips,
  users,
} from './schema.js';
import { resetDb, testDatabaseUrl } from './test-db.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

async function seedDay() {
  const [user] = await db
    .insert(users)
    .values({ provider: 'google', providerId: 'g-1', email: 'a@example.com', name: 'Ann' })
    .returning();
  const [trip] = await db.insert(trips).values({ userId: user!.id, name: 'Japan' }).returning();
  const [day] = await db
    .insert(days)
    .values({
      tripId: trip!.id,
      date: '2027-04-01',
      startLat: 35.68,
      startLng: 139.76,
      endLat: 35.68,
      endLng: 139.76,
      startTime: 540,
      travelMode: 'walking',
    })
    .returning();
  const [place] = await db
    .insert(places)
    .values({ googlePlaceId: 'p-1', name: 'Senso-ji', lat: 35.71, lng: 139.8 })
    .returning();
  const [stage] = await db
    .insert(stages)
    .values({ dayId: day!.id, placeId: place!.id, category: 'temple' })
    .returning();
  return { user: user!, trip: trip!, day: day!, place: place!, stage: stage! };
}

describe('schema', () => {
  it('stores a user, trip, day, place and stage and links them', async () => {
    const { stage, day } = await seedDay();

    expect(stage.done).toBe(false);
    expect(stage.stayOverrideMinutes).toBeNull();
    expect(day.travelMode).toBe('walking');
  });

  it('deleting a user deletes their trips, days, stages and preferences', async () => {
    const { user } = await seedDay();
    await db
      .insert(categoryPreferences)
      .values({ userId: user.id, category: 'museum', stayMinutes: 90 });

    await db.delete(users).where(eq(users.id, user.id));

    expect(await db.select().from(trips)).toHaveLength(0);
    expect(await db.select().from(days)).toHaveLength(0);
    expect(await db.select().from(stages)).toHaveLength(0);
    expect(await db.select().from(categoryPreferences)).toHaveLength(0);
    // Places are shared between users, so they stay.
    expect(await db.select().from(places)).toHaveLength(1);
  });

  it('refuses a second user with the same provider identity', async () => {
    await db
      .insert(users)
      .values({ provider: 'google', providerId: 'same', email: 'a@x.com', name: 'A' });

    await expect(
      db
        .insert(users)
        .values({ provider: 'google', providerId: 'same', email: 'b@x.com', name: 'B' }),
    ).rejects.toThrow();
  });

  it('allows the same providerId under a different provider', async () => {
    await db
      .insert(users)
      .values({ provider: 'google', providerId: 'same', email: 'a@x.com', name: 'A' });
    await db
      .insert(users)
      .values({ provider: 'facebook', providerId: 'same', email: 'b@x.com', name: 'B' });

    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('keeps one stay preference per user and category', async () => {
    const { user } = await seedDay();
    await db
      .insert(categoryPreferences)
      .values({ userId: user.id, category: 'museum', stayMinutes: 90 });

    await expect(
      db
        .insert(categoryPreferences)
        .values({ userId: user.id, category: 'museum', stayMinutes: 60 }),
    ).rejects.toThrow();
  });

  it('refuses an unknown category', async () => {
    const { day, place } = await seedDay();

    await expect(
      db
        .insert(stages)
        .values({ dayId: day.id, placeId: place.id, category: 'spaceport' as 'temple' }),
    ).rejects.toThrow();
  });

  it('refuses to delete a place that a stage still uses', async () => {
    const { place } = await seedDay();

    await expect(db.delete(places).where(eq(places.id, place.id))).rejects.toThrow();
  });

  it('keeps one cached route matrix per day and travel mode', async () => {
    const { day } = await seedDay();
    const entry = { dayId: day.id, travelMode: 'walking' as const, inputHash: 'h', matrix: [[0]] };
    await db.insert(routeMatrixCache).values(entry);

    await expect(db.insert(routeMatrixCache).values(entry)).rejects.toThrow();
  });
});
