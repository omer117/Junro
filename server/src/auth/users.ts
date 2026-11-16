import type { Db } from '../db/client.js';
import { signInWithIdentity } from './identities.js';
import type { User } from './types.js';

/** The part of a Google profile we use (passport-google-oauth20 gives us more). */
export interface GoogleProfile {
  id: string;
  displayName: string;
  emails?: Array<{ value: string; verified?: boolean | string | undefined }> | undefined;
}

export async function verifyGoogleProfile(db: Db, profile: GoogleProfile): Promise<User> {
  const email = profile.emails?.[0];
  if (!email?.value) throw new Error('Google did not return an email address for this account');
  return signInWithIdentity(db, {
    provider: 'google',
    providerId: profile.id,
    email: email.value,
    // Google says whether it checked the address (`email_verified` in the ID token). Some library
    // versions pass it as a string.
    emailVerified: email.verified === true || email.verified === 'true',
    name: profile.displayName,
  });
}
