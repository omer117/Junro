import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app.js';
import { HttpError, errorHandler, notFound } from './errors.js';
import { validateBody } from './validate.js';

describe('app', () => {
  it('GET /health answers ok', async () => {
    const res = await request(createApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown routes get a JSON 404', async () => {
    const res = await request(createApp()).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Route not found' } });
  });
});

describe('error handling', () => {
  const appWith = (setup: (app: express.Express) => void) => {
    const app = express();
    app.use(express.json());
    setup(app);
    app.use(notFound);
    app.use(errorHandler);
    return app;
  };

  it('turns an HttpError into its status and code', async () => {
    const app = appWith((a) =>
      a.get('/x', () => {
        throw new HttpError(403, 'forbidden', 'Not yours');
      }),
    );
    const res = await request(app).get('/x');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'forbidden', message: 'Not yours' } });
  });

  it('hides details of unexpected errors', async () => {
    const app = appWith((a) =>
      a.get('/x', () => {
        throw new Error('database password is hunter2');
      }),
    );
    const res = await request(app).get('/x');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'internal', message: 'Something went wrong' } });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('reports malformed JSON as a 400', async () => {
    const app = appWith((a) => a.post('/x', (_req, res) => void res.json({})));
    const res = await request(app).post('/x').set('Content-Type', 'application/json').send('{oops');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });
});

describe('validateBody', () => {
  const schema = z.object({ name: z.string().min(1), days: z.number().int().positive() });
  const app = express();
  app.use(express.json());
  app.post('/trips', validateBody(schema), (req, res) => void res.status(201).json(req.body));
  app.use(errorHandler);

  it('passes a valid body through', async () => {
    const res = await request(app).post('/trips').send({ name: 'Japan', days: 3 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'Japan', days: 3 });
  });

  it('rejects an invalid body with the list of problems', async () => {
    const res = await request(app).post('/trips').send({ name: '', days: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'days',
      'name',
    ]);
  });

  it('strips fields that are not in the schema', async () => {
    const res = await request(app).post('/trips').send({ name: 'Japan', days: 3, admin: true });

    expect(res.body).toEqual({ name: 'Japan', days: 3 });
  });
});
