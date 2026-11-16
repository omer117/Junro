import { eq } from 'drizzle-orm';
import * as oidc from 'openid-client';
import { Strategy as MicrosoftStrategy } from 'openid-client/passport';
import { Passport, type Strategy } from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import type { StateStore } from 'passport-oauth2';
import type { OAuthConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { ProviderIdentity } from './identities.js';
import {
  githubIdentity,
  googleIdentity,
  microsoftIdentity,
  type ProviderName,
} from './providers.js';

/**
 * `store: true` makes passport-oauth2 keep a random `state` in the session and check it on the way
 * back, so another site cannot forge a callback (also for "connect" in Settings). The runtime takes
 * `true`; the type definitions only list a store object, hence the cast.
 */
const SESSION_STATE = true as unknown as StateStore;

export type PassportInstance = InstanceType<typeof Passport>;

export interface PassportOptions {
  google?: OAuthConfig | undefined;
  github?: OAuthConfig | undefined;
  microsoft?: OAuthConfig | undefined;
  /** Tests: a ready-made Microsoft configuration, so nothing is fetched from Microsoft. */
  microsoftConfiguration?: oidc.Configuration | undefined;
  /** Tests: stand-ins for a provider's strategy (the real ones talk to the provider). */
  strategies?: Partial<Record<ProviderName, Strategy>> | undefined;
}

/** `done(null, identity)`: here the "user" of a strategy is the identity the provider vouched for. */
type Done = (error: unknown, identity?: ProviderIdentity) => void;
const finish = (done: Done, work: Promise<ProviderIdentity>) =>
  work.then(
    (identity) => done(null, identity),
    (error: unknown) => done(error),
  );

/**
 * Builds a Passport instance. The session only stores the user id; on every request the user is
 * loaded again from the database.
 *
 * A strategy here never touches the database: it only turns what the provider says into a
 * `ProviderIdentity`. The routes decide what to do with it (sign in, or link to the signed-in
 * user), which keeps all the account rules in one place (identities.ts).
 *
 * Google and GitHub are plain OAuth 2.0 (with `state` against forged callbacks). Microsoft is
 * OpenID Connect through openid-client: it uses PKCE (the code verifier lives in the session, so a
 * forged callback fails) and validates the ID token (signature, issuer, audience). Its configuration is discovered over the network on first use, so it is prepared lazily.
 */
export function createPassport(db: Db, options: PassportOptions) {
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

  const { google, github, microsoft, strategies } = options;

  if (strategies?.google) passport.use('google', strategies.google);
  else if (google) {
    passport.use(
      'google',
      new GoogleStrategy(
        {
          clientID: google.clientId,
          clientSecret: google.clientSecret,
          callbackURL: google.callbackUrl,
          store: SESSION_STATE,
        },
        (_accessToken, _refreshToken, profile, done) =>
          void finish(
            done as Done,
            Promise.resolve().then(() => googleIdentity(profile)),
          ),
      ),
    );
  }

  if (strategies?.github) passport.use('github', strategies.github);
  else if (github) {
    passport.use(
      'github',
      new GitHubStrategy(
        {
          clientID: github.clientId,
          clientSecret: github.clientSecret,
          callbackURL: github.callbackUrl,
          scope: ['user:email'],
          store: SESSION_STATE,
        },
        (
          accessToken: string,
          _refreshToken: string,
          profile: { id: string; displayName?: string; username?: string },
          done: Done,
        ) => void finish(done, githubIdentity(profile, accessToken)),
      ),
    );
  }

  let microsoftReady: Promise<void> | undefined;
  const prepareMicrosoft = (): Promise<void> => {
    if (strategies?.microsoft) {
      passport.use('microsoft', strategies.microsoft);
      return Promise.resolve();
    }
    if (!microsoft) return Promise.resolve();
    microsoftReady ??= (async () => {
      // Personal Microsoft accounts only: the `consumers` tenant.
      const config =
        options.microsoftConfiguration ??
        (await oidc.discovery(
          new URL('https://login.microsoftonline.com/consumers/v2.0'),
          microsoft.clientId,
          microsoft.clientSecret,
        ));
      passport.use(
        'microsoft',
        new MicrosoftStrategy(
          {
            config,
            scope: 'openid profile email',
            callbackURL: microsoft.callbackUrl,
            name: 'microsoft',
          },
          (tokens, verified) =>
            void finish(
              verified as Done,
              Promise.resolve().then(() => microsoftIdentity(tokens.claims()!)),
            ),
        ),
      );
    })().catch((error: unknown) => {
      microsoftReady = undefined; // try again next time (Microsoft may have been unreachable)
      throw error;
    });
    return microsoftReady;
  };

  /** Call before using a provider: Microsoft needs its configuration fetched first. */
  const prepare = (provider: ProviderName): Promise<void> =>
    provider === 'microsoft' ? prepareMicrosoft() : Promise.resolve();

  return { passport, prepare };
}
