import type { Db } from '../db/client.js';
import { signInWithIdentity } from './identities.js';
import { googleIdentity, type GoogleProfile } from './providers.js';
import type { User } from './types.js';

export type { GoogleProfile };

/** A Google profile to a Junro user (kept for tests and for anything that signs in directly). */
export async function verifyGoogleProfile(db: Db, profile: GoogleProfile): Promise<User> {
  return signInWithIdentity(db, googleIdentity(profile));
}
