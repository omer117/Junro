import * as oidc from 'openid-client';
import type { Strategy } from 'passport';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { userIdentities, users } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp } from '../test-app.js';
import { SignInRefused, type ProviderIdentity } from './identities.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const CLIENT = 'http://localhost:5173';
const oauth = (name: string) => ({
  clientId: `${name}-id`,
  clientSecret: `${name}-secret`,
  callbackUrl: `http://localhost:3000/auth/${name}/callback`,
});

/**
 * A stand-in for a provider's strategy: the identity comes in the query (?identity=<json>), and
 * ?refuse=<reason> makes it fail the way a real one does when a rule says no.
 */
class StubStrategy {
  // Passport calls this on a copy of the strategy that has success/fail/error added to it.
  success!: (identity: ProviderIdentity) => void;
  fail!: () => void;
  error!: (error: Error) => void;

  authenticate(req: { query: Record<string, string> }) {
    if (req.query.refuse) return this.error(new SignInRefused(req.query.refuse as never));
    if (!req.query.identity) return this.fail();
    return this.success(JSON.parse(req.query.identity) as ProviderIdentity);
  }
}
const stub = () => new StubStrategy() as unknown as Strategy;

const identity = (over: Partial<ProviderIdentity> = {}): string =>
  JSON.stringify({
    provider: 'github',
    providerId: 'gh-1',
    email: 'ann@example.com',
    emailVerified: true,
    name: 'Ann',
    ...over,
  });

const appWithStubs = () =>
  createTestApp(db, {
    clientUrl: CLIENT,
    authTestHooks: { strategies: { google: stub(), github: stub() } },
  });

describe('GET /auth/providers', () => {
  it('lists only the providers that are configured', async () => {
    const none = await request(createTestApp(db)).get('/auth/providers');
    const some = await request(
      createTestApp(db, { google: oauth('google'), github: oauth('github') }),
    ).get('/auth/providers');

    expect(none.body).toEqual({ providers: [] });
    expect(some.body).toEqual({ providers: ['google', 'github'] });
  });

  it('is public (the landing page needs it before sign-in)', async () => {
    const res = await request(createTestApp(db, { google: oauth('google') })).get(
      '/auth/providers',
    );

    expect(res.status).toBe(200);
  });
});

describe('a provider that is not configured', () => {
  it.each(['google', 'github', 'microsoft'])(
    'answers 503 for /auth/%s and its callback',
    async (name) => {
      const app = createTestApp(db);

      expect((await request(app).get(`/auth/${name}`)).status).toBe(503);
      const callback = await request(app).get(`/auth/${name}/callback`);
      expect(callback.status).toBe(503);
      expect(callback.body.error.code).toBe('auth_not_configured');
    },
  );

  it('answers 404 for a provider that does not exist', async () => {
    expect((await request(createTestApp(db)).get('/auth/facebook')).status).toBe(404);
  });
});

describe('sending the person to the provider', () => {
  it('GitHub: authorize URL with the client id, the email scope and a state', async () => {
    const app = createTestApp(db, { github: oauth('github') });

    const res = await request(app).get('/auth/github');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.host).toBe('github.com');
    expect(location.searchParams.get('client_id')).toBe('github-id');
    expect(location.searchParams.get('scope')).toBe('user:email');
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('Google: also carries a state', async () => {
    const res = await request(createTestApp(db, { google: oauth('google') })).get('/auth/google');

    expect(new URL(res.headers.location!).searchParams.get('state')).toBeTruthy();
  });

  it('Microsoft: the personal-account (consumers) endpoint with PKCE', async () => {
    const configuration = new oidc.Configuration(
      {
        issuer: 'https://login.microsoftonline.com/consumers/v2.0',
        authorization_endpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
        token_endpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
        code_challenge_methods_supported: ['S256'],
      },
      'microsoft-id',
      'microsoft-secret',
    );
    const app = createTestApp(db, {
      microsoft: oauth('microsoft'),
      authTestHooks: { microsoftConfiguration: configuration },
    });

    const res = await request(app).get('/auth/microsoft');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.host).toBe('login.microsoftonline.com');
    expect(location.pathname).toContain('/consumers/');
    expect(location.searchParams.get('client_id')).toBe('microsoft-id');
    expect(location.searchParams.get('scope')).toBe('openid profile email');
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('coming back from a provider', () => {
  it('signs the person in and sends them to the app', async () => {
    const agent = request.agent(appWithStubs());

    const res = await agent.get('/auth/github/callback').query({ identity: identity() });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(CLIENT);
    expect((await agent.get('/auth/me')).body).toMatchObject({ email: 'ann@example.com' });
  });

  it('is the same person when GitHub comes back with the same verified email as Google', async () => {
    const agent = request.agent(appWithStubs());
    await agent
      .get('/auth/google/callback')
      .query({ identity: identity({ provider: 'google', providerId: 'g-1' }) });
    const first = (await agent.get('/auth/me')).body.id;
    await agent.post('/auth/logout');

    await agent.get('/auth/github/callback').query({ identity: identity() });

    expect((await agent.get('/auth/me')).body.id).toBe(first);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(userIdentities)).toHaveLength(2);
  });

  it('refuses to link an unverified email and says why in the redirect', async () => {
    const agent = request.agent(appWithStubs());
    await agent
      .get('/auth/google/callback')
      .query({ identity: identity({ provider: 'google', providerId: 'g-1' }) });
    await agent.post('/auth/logout');

    const res = await agent
      .get('/auth/github/callback')
      .query({ identity: identity({ emailVerified: false }) });

    expect(res.headers.location).toBe(`${CLIENT}/?signin=failed&reason=email_in_use`);
    await agent.get('/auth/me').expect(401);
    expect(await db.select().from(userIdentities)).toHaveLength(1);
  });

  it('passes on the reason when the strategy itself refuses (no verified email)', async () => {
    const res = await request(appWithStubs())
      .get('/auth/github/callback')
      .query({ refuse: 'no_verified_email' });

    expect(res.headers.location).toBe(`${CLIENT}/?signin=failed&reason=no_verified_email`);
  });

  it('says "cancelled" when the person said no at the provider', async () => {
    const res = await request(appWithStubs())
      .get('/auth/github/callback')
      .query({ error: 'access_denied' });

    expect(res.headers.location).toBe(`${CLIENT}/?signin=failed&reason=cancelled`);
  });

  it('fails without a reason when the provider gave nothing usable', async () => {
    const res = await request(appWithStubs()).get('/auth/github/callback');

    expect(res.headers.location).toBe(`${CLIENT}/?signin=failed`);
  });
});
