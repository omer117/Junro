import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../client.js';
import { userIdentities, users } from '../schema.js';
import { resetDb, testDatabaseUrl } from '../test-db.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

describe('user_identities (the migration)', () => {
  it('gives every existing user one identity, with the email not known to be verified', async () => {
    // Users as they were before this change: provider and provider id on the user row.
    await db.insert(users).values([
      { provider: 'google', providerId: 'g-1', email: 'ann@example.com', name: 'Ann' },
      { provider: 'google', providerId: 'g-2', email: 'bob@example.com', name: 'Bob' },
    ]);
    // The copy step of the migration, run again as it would on a database with old users.
    const migration = readFileSync(
      new URL('../../../drizzle/0015_user_identities.sql', import.meta.url),
      'utf8',
    );
    const copy = migration
      .split(';')
      .find((statement) => /INSERT INTO "user_identities"/.test(statement))!;
    await db.execute(sql.raw(copy));

    const identities = await db.select().from(userIdentities);

    expect(identities).toHaveLength(2);
    expect(
      identities.map((i) => [i.provider, i.providerId, i.email, i.emailVerified]).sort(),
    ).toEqual([
      ['google', 'g-1', 'ann@example.com', false],
      ['google', 'g-2', 'bob@example.com', false],
    ]);
  });

  it('can be run again without duplicating anything', async () => {
    await db
      .insert(users)
      .values({ provider: 'google', providerId: 'g-1', email: 'ann@example.com', name: 'Ann' });
    const migration = readFileSync(
      new URL('../../../drizzle/0015_user_identities.sql', import.meta.url),
      'utf8',
    );
    const copy = migration
      .split(';')
      .find((statement) => /INSERT INTO "user_identities"/.test(statement))!;

    await db.execute(sql.raw(copy));
    await db.execute(sql.raw(copy));

    expect(await db.select().from(userIdentities)).toHaveLength(1);
  });

  it('lets a user exist without a provider on the user row (new users only have identities)', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'new@example.com', name: 'New' })
      .returning();

    expect(user!.provider).toBeNull();
  });

  it('removes the identities of a deleted user', async () => {
    const [user] = await db.insert(users).values({ email: 'a@x.com', name: 'A' }).returning();
    await db.insert(userIdentities).values({
      userId: user!.id,
      provider: 'github',
      providerId: '1',
      email: 'a@x.com',
      emailVerified: true,
    });

    await db.delete(users);

    expect(await db.select().from(userIdentities)).toEqual([]);
  });

  it('refuses the same provider account twice', async () => {
    const [user] = await db.insert(users).values({ email: 'a@x.com', name: 'A' }).returning();
    const row = {
      userId: user!.id,
      provider: 'github',
      providerId: '1',
      email: 'a@x.com',
      emailVerified: true,
    };
    await db.insert(userIdentities).values(row);

    await expect(db.insert(userIdentities).values(row)).rejects.toThrow();
  });
});
