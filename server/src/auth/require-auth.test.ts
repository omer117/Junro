import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../errors.js';
import { requireAuth } from './require-auth.js';

describe('requireAuth', () => {
  const app = express();
  app.get('/private', requireAuth, (_req, res) => void res.json({ secret: 1 }));
  app.use(errorHandler);

  it('stops anonymous requests with a 401', async () => {
    const res = await request(app).get('/private');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'unauthenticated', message: 'Sign in required' },
    });
  });
});
