import express, { type Express } from 'express';
import session from 'express-session';
import { DEFAULT_QUOTA_CAPS, type GoogleConfig } from './config.js';
import type { Db } from './db/client.js';
import { authRoutes } from './auth/routes.js';
import { createPassport } from './auth/passport.js';
import { errorHandler, notFound } from './errors.js';
import { withUsageGuard } from './google/guarded.js';
import { createUsageGuard, type QuotaCaps } from './google/guard.js';
import type { MapsClient } from './google/types.js';
import { createRateLimiter } from './rate-limit.js';
import { placesRouter } from './routes/places.js';
import { daysRouter } from './routes/days.js';
import { stagesRouter } from './routes/stages.js';
import { stayDurationsRouter } from './routes/stay-durations.js';
import { tripsRouter } from './routes/trips.js';

export interface AppDeps {
  db: Db;
  sessionSecret: string;
  /** Where sessions are kept. Defaults to memory (fine for tests, not for production). */
  sessionStore?: session.Store;
  secureCookies?: boolean;
  google?: GoogleConfig;
  clientUrl?: string;
  /** Google (Places and Routes). Missing = no API key, and Google features answer 503. */
  maps?: MapsClient;
  quotaCaps?: QuotaCaps;
  /** Place searches allowed per user per minute. */
  searchRateLimit?: number;
  /** Lets tests mount extra routes after sign-in is set up and before the real routes. */
  beforeRoutes?: (app: Express) => void;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.use(
    session({
      name: 'junro.sid',
      secret: deps.sessionSecret,
      ...(deps.sessionStore ? { store: deps.sessionStore } : {}),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: deps.secureCookies ?? false,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // Routes only ever see Google through the usage guard.
  const guard = createUsageGuard({ db: deps.db, caps: deps.quotaCaps ?? DEFAULT_QUOTA_CAPS });
  const maps = deps.maps ? withUsageGuard(deps.maps, guard) : undefined;

  const passport = createPassport(deps.db, deps.google);
  app.use(passport.initialize());
  app.use(passport.session());

  deps.beforeRoutes?.(app);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    '/auth',
    authRoutes({
      passport,
      googleEnabled: deps.google !== undefined,
      clientUrl: deps.clientUrl ?? '/',
    }),
  );

  app.use('/trips', tripsRouter(deps.db));

  app.use(
    placesRouter({
      maps,
      searchLimiter: createRateLimiter({ limit: deps.searchRateLimit ?? 30, windowMs: 60_000 }),
    }),
  );
  app.use(daysRouter(deps.db));
  app.use(stagesRouter(deps.db));
  app.use(stayDurationsRouter(deps.db));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
