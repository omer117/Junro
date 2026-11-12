import type { Express } from 'express';
import type { Db } from './db/client.js';
import { createApp, type AppDeps } from './app.js';

/**
 * An app for tests. Adds `POST /__login/:userId`, which signs that user in without
 * going through Google (a real Google login cannot run in an automated test).
 */
export function createTestApp(db: Db, overrides: Partial<AppDeps> = {}): Express {
  return createApp({
    db,
    sessionSecret: 'test-secret',
    beforeRoutes: (app) => {
      app.post('/__login/:userId', (req, res, next) => {
        req.login({ id: String(req.params.userId) } as Express.User, (err) =>
          err ? next(err) : res.sendStatus(204),
        );
      });
    },
    ...overrides,
  });
}
