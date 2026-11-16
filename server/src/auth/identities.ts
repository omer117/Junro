import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { userIdentities, users } from '../db/schema.js';
import type { User } from './types.js';

/** What a provider tells us about the person who just signed in. */
export interface ProviderIdentity {
  /** 'google' | 'github' | 'microsoft' */
  provider: string;
  /** The account's id at that provider. */
  providerId: string;
  email: string;
  /** True only when the provider itself checked that the person owns this email. */
  emailVerified: boolean;
  name: string;
}

export type RefusalReason = 'email_in_use' | 'identity_in_use' | 'no_verified_email';

/** Signing in was refused on purpose. The browser is told why, as a code and nothing else. */
export class SignInRefused extends Error {
  constructor(readonly reason: RefusalReason) {
    super(`Sign-in refused: ${reason}`);
    this.name = 'SignInRefused';
  }
}

/**
 * Signs a provider identity in, and finds or makes the Junro user for it. One transaction.
 *
 * 1. The identity is known: that is the user. Its email is refreshed; the user's name and email
 *    are not overwritten by whichever provider was used last.
 * 2. New identity, verified email, and exactly one user already has a VERIFIED identity with the
 *    same email: add it to that user, so one person keeps one set of trips.
 * 3. New identity, but the email is already used by an account and either side is unverified (or
 *    several users share it): refuse. Linking on an unverified email would let someone register
 *    another person's email at a provider that does not check it, and take over their account
 *    ("account pre-hijacking"). The person can connect the provider from Settings instead.
 * 4. Otherwise: a new user with this as its first identity.
 */
export async function signInWithIdentity(db: Db, identity: ProviderIdentity): Promise<User> {
  return db.transaction(async (tx) => {
    const [known] = await tx
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.provider, identity.provider),
          eq(userIdentities.providerId, identity.providerId),
        ),
      );
    if (known) {
      await tx
        .update(userIdentities)
        .set({ email: identity.email, emailVerified: identity.emailVerified })
        .where(eq(userIdentities.id, known.id));
      const [user] = await tx.select().from(users).where(eq(users.id, known.userId));
      return user!;
    }

    const sameEmail = await tx
      .select()
      .from(userIdentities)
      .where(sql`lower(${userIdentities.email}) = lower(${identity.email})`);

    if (sameEmail.length > 0) {
      const owners = new Set(sameEmail.map((i) => i.userId));
      const allVerified = sameEmail.every((i) => i.emailVerified);
      if (identity.emailVerified && allVerified && owners.size === 1) {
        const [userId] = owners;
        await insertIdentity(tx, userId!, identity);
        const [user] = await tx.select().from(users).where(eq(users.id, userId!));
        return user!;
      }
      throw new SignInRefused('email_in_use');
    }

    const [user] = await tx
      .insert(users)
      .values({ email: identity.email, name: identity.name })
      .returning();
    await insertIdentity(tx, user!.id, identity);
    return user!;
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function insertIdentity(tx: Tx, userId: string, identity: ProviderIdentity): Promise<void> {
  await tx.insert(userIdentities).values({
    userId,
    provider: identity.provider,
    providerId: identity.providerId,
    email: identity.email,
    emailVerified: identity.emailVerified,
  });
}

/**
 * Explicit linking from Settings: the signed-in user asked to connect this provider, so it is
 * attached to them whatever its email says. An identity that already belongs to ANOTHER user is
 * refused: merging two accounts that both have trips is out of scope.
 */
export async function linkIdentity(
  db: Db,
  userId: string,
  identity: ProviderIdentity,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [known] = await tx
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.provider, identity.provider),
          eq(userIdentities.providerId, identity.providerId),
        ),
      );
    if (known && known.userId !== userId) throw new SignInRefused('identity_in_use');
    if (known) {
      await tx
        .update(userIdentities)
        .set({ email: identity.email, emailVerified: identity.emailVerified })
        .where(eq(userIdentities.id, known.id));
      return;
    }
    await insertIdentity(tx, userId, identity);
  });
}

/** A user's sign-in methods, for Settings. The provider's own account id is not shared. */
export async function listIdentities(db: Db, userId: string) {
  return db
    .select({
      id: userIdentities.id,
      provider: userIdentities.provider,
      email: userIdentities.email,
      createdAt: userIdentities.createdAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .orderBy(asc(userIdentities.createdAt), asc(userIdentities.id));
}

/** Removes one of the user's own identities. Returns false when it is not theirs. Never the last. */
export async function removeIdentity(
  db: Db,
  userId: string,
  identityId: string,
): Promise<'removed' | 'not_found' | 'last_identity'> {
  return db.transaction(async (tx) => {
    const mine = await tx.select().from(userIdentities).where(eq(userIdentities.userId, userId));
    if (!mine.some((i) => i.id === identityId)) return 'not_found';
    if (mine.length <= 1) return 'last_identity';
    await tx.delete(userIdentities).where(eq(userIdentities.id, identityId));
    return 'removed';
  });
}
