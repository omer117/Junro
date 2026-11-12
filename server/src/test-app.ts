import request from 'supertest';
import { findOrCreateUser } from './auth/users.js';
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

/** Creates a user in the database and returns a supertest agent that is signed in as them. */
export async function signInAs(db: Db, app: Express, name = 'Ann') {
  const user = await findOrCreateUser(db, {
    provider: 'google',
    providerId: `g-${name}`,
    email: `${name.toLowerCase()}@example.com`,
    name,
  });
  const agent = request.agent(app);
  await agent.post(`/__login/${user.id}`).expect(204);
  return { agent, user };
}
