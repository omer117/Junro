import { eq } from 'drizzle-orm';
import { Passport } from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import type { GoogleConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { verifyGoogleProfile } from './users.js';

export type PassportInstance = InstanceType<typeof Passport>;

/**
 * Builds a Passport instance. The session only stores the user id; on every request the
 * user is loaded again from the database. A new provider is one more `passport.use(...)`
 * here plus a route in routes.ts.
 */
export function createPassport(db: Db, google: GoogleConfig | undefined): PassportInstance {
  const passport = new Passport();

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id: string, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      // `false` means "this session is no longer valid" (user deleted), not an error.
      done(null, user ?? false);
    } catch {
      done(null, false);
    }
  });

  if (google) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: google.clientId,
          clientSecret: google.clientSecret,
          callbackURL: google.callbackUrl,
        },
        (_accessToken, _refreshToken, profile, done) => {
          verifyGoogleProfile(db, profile).then(
            (user) => done(null, user),
            (error) => done(error),
          );
        },
      ),
    );
  }

  return passport;
}
