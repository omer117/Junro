import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp } from '../test-app.js';
import { findOrCreateUser, verifyGoogleProfile } from './users.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

describe('findOrCreateUser', () => {
  const identity = { provider: 'google', providerId: 'g-1', email: 'a@x.com', name: 'Ann' };

  it('creates the user the first time', async () => {
    const user = await findOrCreateUser(db, identity);

    expect(user).toMatchObject(identity);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('returns the same user the second time and refreshes name and email', async () => {
    const first = await findOrCreateUser(db, identity);
    const second = await findOrCreateUser(db, { ...identity, email: 'new@x.com', name: 'Anna' });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ email: 'new@x.com', name: 'Anna' });
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('keeps users of different providers apart', async () => {
    const google = await findOrCreateUser(db, identity);
    const facebook = await findOrCreateUser(db, { ...identity, provider: 'facebook' });

    expect(facebook.id).not.toBe(google.id);
  });
});

describe('verifyGoogleProfile', () => {
  it('turns a Google profile into a Junro user', async () => {
    const user = await verifyGoogleProfile(db, {
      id: 'google-123',
      displayName: 'Ann Lee',
      emails: [{ value: 'ann@example.com' }],
    });

    expect(user).toMatchObject({
      provider: 'google',
      providerId: 'google-123',
      email: 'ann@example.com',
      name: 'Ann Lee',
    });
  });

  it('rejects a profile without an email', async () => {
    await expect(
      verifyGoogleProfile(db, { id: 'g', displayName: 'No Mail', emails: [] }),
    ).rejects.toThrow(/email/i);
  });
});

describe('session routes', () => {
  it('GET /auth/me is 401 when nobody is signed in', async () => {
    const res = await request(createTestApp(db)).get('/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('GET /auth/me returns the signed-in user, and only safe fields', async () => {
    const user = await findOrCreateUser(db, {
      provider: 'google',
      providerId: 'g-1',
      email: 'a@x.com',
      name: 'Ann',
    });
    const agent = request.agent(createTestApp(db));
    await agent.post(`/__login/${user.id}`).expect(204);

    const res = await agent.get('/auth/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, email: 'a@x.com', name: 'Ann' });
  });

  it('POST /auth/logout ends the session', async () => {
    const user = await findOrCreateUser(db, {
      provider: 'google',
      providerId: 'g-1',
      email: 'a@x.com',
      name: 'Ann',
    });
    const agent = request.agent(createTestApp(db));
    await agent.post(`/__login/${user.id}`).expect(204);

    await agent.post('/auth/logout').expect(204);

    await agent.get('/auth/me').expect(401);
  });

  it('a session for a user that no longer exists is treated as signed out', async () => {
    const agent = request.agent(createTestApp(db));
    await agent.post('/__login/00000000-0000-0000-0000-000000000000').expect(204);

    await agent.get('/auth/me').expect(401);
  });

  it('the session cookie is httpOnly and SameSite=Lax', async () => {
    const user = await findOrCreateUser(db, {
      provider: 'google',
      providerId: 'g-1',
      email: 'a@x.com',
      name: 'Ann',
    });
    const res = await request(createTestApp(db)).post(`/__login/${user.id}`);
    const cookie = String(res.headers['set-cookie']);

    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe('Google sign-in', () => {
  it('redirects to Google when configured', async () => {
    const app = createTestApp(db, {
      google: {
        clientId: 'client-id-123',
        clientSecret: 'secret',
        callbackUrl: 'http://localhost:3000/auth/google/callback',
      },
    });
    const res = await request(app).get('/auth/google');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.host).toBe('accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('client-id-123');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/google/callback',
    );
  });

  it('answers 503 when Google sign-in is not configured', async () => {
    const res = await request(createTestApp(db)).get('/auth/google');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('auth_not_configured');
  });
});
