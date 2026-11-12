import express, { type Express } from 'express';
import session from 'express-session';
import type { GoogleConfig } from './config.js';
import type { Db } from './db/client.js';
import { authRoutes } from './auth/routes.js';
import { createPassport } from './auth/passport.js';
import { errorHandler, notFound } from './errors.js';

export interface AppDeps {
  db: Db;
  sessionSecret: string;
  /** Where sessions are kept. Defaults to memory (fine for tests, not for production). */
  sessionStore?: session.Store;
  secureCookies?: boolean;
  google?: GoogleConfig;
  clientUrl?: string;
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

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
