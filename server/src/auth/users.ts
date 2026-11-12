import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { User } from './types.js';

export interface ProviderIdentity {
  provider: string;
  providerId: string;
  email: string;
  name: string;
}

/** Finds the user for this provider identity, creating them on first sign-in. */
export async function findOrCreateUser(db: Db, identity: ProviderIdentity): Promise<User> {
  const [user] = await db
    .insert(users)
    .values(identity)
    .onConflictDoUpdate({
      target: [users.provider, users.providerId],
      set: { email: identity.email, name: identity.name },
    })
    .returning();
  return user!;
}

/** The part of a Google profile we use (passport-google-oauth20 gives us more). */
export interface GoogleProfile {
  id: string;
  displayName: string;
  emails?: Array<{ value: string }> | undefined;
}

export async function verifyGoogleProfile(db: Db, profile: GoogleProfile): Promise<User> {
  const email = profile.emails?.[0]?.value;
  if (!email) throw new Error('Google did not return an email address for this account');
  return findOrCreateUser(db, {
    provider: 'google',
    providerId: profile.id,
    email,
    name: profile.displayName,
  });
}
