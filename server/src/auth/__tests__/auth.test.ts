import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../db/client.js';
import { userIdentities } from '../../db/schema.js';
import { resetDb, testDatabaseUrl } from '../../db/test-db.js';
import { createTestApp } from '../../test-app.js';
import { signInWithIdentity } from '../identities.js';
import { verifyGoogleProfile } from '../users.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

describe('verifyGoogleProfile', () => {
  it('turns a Google profile into a Junro user', async () => {
    const user = await verifyGoogleProfile(db, {
      id: 'google-123',
      displayName: 'Ann Lee',
      emails: [{ value: 'ann@example.com', verified: true }],
    });

    expect(user).toMatchObject({ email: 'ann@example.com', name: 'Ann Lee' });
    const [identity] = await db.select().from(userIdentities);
    expect(identity).toMatchObject({
      userId: user.id,
      provider: 'google',
      providerId: 'google-123',
      emailVerified: true,
    });
  });

  it.each([[undefined], [false], ['false']])(
    'does not treat the email as verified when Google says %s',
    async (verified) => {
      await verifyGoogleProfile(db, {
        id: 'g-2',
        displayName: 'Ann',
        emails: [{ value: 'ann@example.com', verified }],
      });

      const [identity] = await db.select().from(userIdentities);
      expect(identity!.emailVerified).toBe(false);
    },
  );

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
    const user = await signInWithIdentity(db, {
      provider: 'google',
      providerId: 'g-1',
      email: 'a@x.com',
      emailVerified: true,
      name: 'Ann',
    });
    const agent = request.agent(createTestApp(db));
    await agent.post(`/__login/${user.id}`).expect(204);

    const res = await agent.get('/auth/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, email: 'a@x.com', name: 'Ann' });
  });

  it('POST /auth/logout ends the session', async () => {
    const user = await signInWithIdentity(db, {
      provider: 'google',
      providerId: 'g-1',
      email: 'a@x.com',
      emailVerified: true,
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
    const user = await signInWithIdentity(db, {
      provider: 'google',
      providerId: 'g-1',
      email: 'a@x.com',
      emailVerified: true,
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
