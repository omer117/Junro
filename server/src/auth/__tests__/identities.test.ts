import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../db/client.js';
import { userIdentities, users } from '../../db/schema.js';
import { resetDb, testDatabaseUrl } from '../../db/test-db.js';
import { signInWithIdentity, SignInRefused, type ProviderIdentity } from '../identities.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const google: ProviderIdentity = {
  provider: 'google',
  providerId: 'g-1',
  email: 'ann@example.com',
  emailVerified: true,
  name: 'Ann',
};
const github: ProviderIdentity = {
  provider: 'github',
  providerId: 'gh-9',
  email: 'ann@example.com',
  emailVerified: true,
  name: 'ann-dev',
};

const refusedWith = async (identity: ProviderIdentity) => {
  try {
    await signInWithIdentity(db, identity);
  } catch (error) {
    if (error instanceof SignInRefused) return error.reason;
    throw error;
  }
  return null;
};

describe('signInWithIdentity', () => {
  it('creates a user and an identity the first time', async () => {
    const user = await signInWithIdentity(db, google);

    expect(user).toMatchObject({ email: 'ann@example.com', name: 'Ann' });
    const identities = await db.select().from(userIdentities);
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({
      userId: user.id,
      provider: 'google',
      providerId: 'g-1',
      emailVerified: true,
    });
  });

  it('signs in the same user the second time, and refreshes the identity but not the user', async () => {
    const first = await signInWithIdentity(db, google);

    const second = await signInWithIdentity(db, {
      ...google,
      email: 'new@example.com',
      name: 'Anna',
    });

    expect(second.id).toBe(first.id);
    // The person keeps the name and email they started with; the identity follows the provider.
    expect(second).toMatchObject({ email: 'ann@example.com', name: 'Ann' });
    const [identity] = await db.select().from(userIdentities);
    expect(identity!.email).toBe('new@example.com');
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('links a new provider to the existing user when the email is verified on both sides', async () => {
    const first = await signInWithIdentity(db, google);

    const second = await signInWithIdentity(db, github);

    expect(second.id).toBe(first.id);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(userIdentities)).toHaveLength(2);
  });

  it('compares emails without regard to upper and lower case', async () => {
    const first = await signInWithIdentity(db, google);

    const second = await signInWithIdentity(db, { ...github, email: 'ANN@Example.COM' });

    expect(second.id).toBe(first.id);
  });

  it('does NOT link when the new provider has not verified the email (account pre-hijacking)', async () => {
    await signInWithIdentity(db, google);

    expect(await refusedWith({ ...github, emailVerified: false })).toBe('email_in_use');
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(userIdentities)).toHaveLength(1);
  });

  it('does NOT link to an account whose email was never verified (a copied legacy identity)', async () => {
    const [legacy] = await db
      .insert(users)
      .values({ email: 'ann@example.com', name: 'Ann' })
      .returning();
    await db.insert(userIdentities).values({
      userId: legacy!.id,
      provider: 'google',
      providerId: 'old',
      email: 'ann@example.com',
      emailVerified: false,
    });

    expect(await refusedWith(github)).toBe('email_in_use');
  });

  it('never links when two users already share the email (legacy data)', async () => {
    const a = await signInWithIdentity(db, google);
    const [b] = await db
      .insert(users)
      .values({ email: 'ann@example.com', name: 'Other Ann' })
      .returning();
    await db.insert(userIdentities).values({
      userId: b!.id,
      provider: 'microsoft',
      providerId: 'ms-1',
      email: 'ann@example.com',
      emailVerified: true,
    });

    expect(await refusedWith(github)).toBe('email_in_use');
    expect(a.id).not.toBe(b!.id);
  });

  it('creates a separate user for a different email', async () => {
    const first = await signInWithIdentity(db, google);

    const second = await signInWithIdentity(db, { ...github, email: 'other@example.com' });

    expect(second.id).not.toBe(first.id);
  });

  it('lets a signed-in identity whose email is no longer verified keep signing in', async () => {
    const first = await signInWithIdentity(db, google);

    const again = await signInWithIdentity(db, { ...google, emailVerified: false });

    expect(again.id).toBe(first.id);
    const [identity] = await db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, first.id));
    expect(identity!.emailVerified).toBe(false);
  });
});
