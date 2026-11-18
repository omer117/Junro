import type { Strategy } from 'passport';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../db/client.js';
import { userIdentities, users } from '../../db/schema.js';
import { resetDb, testDatabaseUrl } from '../../db/test-db.js';
import { createTestApp } from '../../test-app.js';
import { SignInRefused, type ProviderIdentity } from '../identities.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const CLIENT = 'http://localhost:5173';

/** A stand-in for a provider's strategy; the identity comes in the query. See providers-routes. */
class StubStrategy {
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

const identity = (over: Partial<ProviderIdentity>) =>
  JSON.stringify({
    provider: 'google',
    providerId: 'g-1',
    email: 'ann@example.com',
    emailVerified: true,
    name: 'Ann',
    ...over,
  });
const github = (over: Partial<ProviderIdentity> = {}) =>
  identity({ provider: 'github', providerId: 'gh-1', ...over });

const app = () =>
  createTestApp(db, {
    clientUrl: CLIENT,
    authTestHooks: { strategies: { google: stub(), github: stub(), microsoft: stub() } },
  });

async function signedInAnn() {
  const agent = request.agent(app());
  await agent.get('/auth/google/callback').query({ identity: identity({}) });
  return agent;
}

describe('connecting another provider from Settings (?link=1)', () => {
  it('needs a signed-in user', async () => {
    const res = await request(app()).get('/auth/github').query({ link: '1' });

    expect(res.status).toBe(401);
  });

  it('attaches the identity to the signed-in user, whatever its email', async () => {
    const agent = await signedInAnn();
    const me = (await agent.get('/auth/me')).body;
    await agent.get('/auth/github').query({ link: '1' }); // remembers who is linking

    const res = await agent
      .get('/auth/github/callback')
      .query({ identity: github({ email: 'work@elsewhere.com' }) });

    expect(res.headers.location).toBe(`${CLIENT}/settings`);
    expect(await db.select().from(users)).toHaveLength(1);
    const identities = await db.select().from(userIdentities);
    expect(identities.map((i) => i.provider).sort()).toEqual(['github', 'google']);
    expect(identities.every((i) => i.userId === me.id)).toBe(true);
    expect((await agent.get('/auth/me')).body.id).toBe(me.id);
  });

  it('refuses an identity that already belongs to a different user (no merging)', async () => {
    const bob = request.agent(app());
    await bob
      .get('/auth/github/callback')
      .query({ identity: github({ email: 'bob@example.com', name: 'Bob' }) });
    const ann = await signedInAnn();
    await ann.get('/auth/github').query({ link: '1' });

    const res = await ann
      .get('/auth/github/callback')
      .query({ identity: github({ email: 'bob@example.com' }) });

    expect(res.headers.location).toBe(`${CLIENT}/settings?signin=failed&reason=identity_in_use`);
    expect(await db.select().from(users)).toHaveLength(2);
    expect(await db.select().from(userIdentities)).toHaveLength(2);
  });

  it('is used once: the next callback is an ordinary sign-in again', async () => {
    const agent = await signedInAnn();
    await agent.get('/auth/github').query({ link: '1' });
    await agent
      .get('/auth/github/callback')
      .query({ identity: github({ email: 'work@elsewhere.com' }) });

    await agent
      .get('/auth/github/callback')
      .query({ identity: github({ providerId: 'gh-2', email: 'new@example.com', name: 'New' }) });

    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('does nothing for someone who signed out in between', async () => {
    const agent = await signedInAnn();
    await agent.get('/auth/github').query({ link: '1' });
    await agent.post('/auth/logout').expect(204);

    const res = await agent.get('/auth/github/callback').query({ identity: github() });

    // The link request is gone with the session, so this is a normal sign-in (same verified email).
    expect(res.headers.location).toBe(CLIENT);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('says why when the provider refuses', async () => {
    const agent = await signedInAnn();
    await agent.get('/auth/github').query({ link: '1' });

    const res = await agent.get('/auth/github/callback').query({ refuse: 'no_verified_email' });

    expect(res.headers.location).toBe(`${CLIENT}/settings?signin=failed&reason=no_verified_email`);
  });
});

describe('GET /auth/identities and DELETE /auth/identities/:id', () => {
  it('lists my sign-in methods without ids of the provider', async () => {
    const agent = await signedInAnn();

    const res = await agent.get('/auth/identities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        provider: 'google',
        email: 'ann@example.com',
        createdAt: expect.any(String),
      },
    ]);
  });

  it('needs a signed-in user', async () => {
    expect((await request(app()).get('/auth/identities')).status).toBe(401);
    expect(
      (await request(app()).delete('/auth/identities/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(401);
  });

  it('removes one of several', async () => {
    const agent = await signedInAnn();
    await agent.get('/auth/github').query({ link: '1' });
    await agent.get('/auth/github/callback').query({ identity: github() });
    const list = (await agent.get('/auth/identities')).body as Array<{
      id: string;
      provider: string;
    }>;
    const gh = list.find((i) => i.provider === 'github')!;

    await agent.delete(`/auth/identities/${gh.id}`).expect(204);

    expect((await agent.get('/auth/identities')).body).toHaveLength(1);
  });

  it('refuses to remove the last one (the person would be locked out)', async () => {
    const agent = await signedInAnn();
    const [only] = (await agent.get('/auth/identities')).body as Array<{ id: string }>;

    const res = await agent.delete(`/auth/identities/${only!.id}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_identity');
    expect(await db.select().from(userIdentities)).toHaveLength(1);
  });

  it("cannot see or remove someone else's identity (404)", async () => {
    const bob = request.agent(app());
    await bob
      .get('/auth/github/callback')
      .query({ identity: github({ email: 'bob@example.com' }) });
    const [bobs] = await db.select().from(userIdentities);
    const ann = await signedInAnn();

    const res = await ann.delete(`/auth/identities/${bobs!.id}`);

    expect(res.status).toBe(404);
    expect(
      (await ann.get('/auth/identities')).body.map((i: { provider: string }) => i.provider),
    ).toEqual(['google']);
  });

  it('a malformed id is a 404', async () => {
    const agent = await signedInAnn();

    expect((await agent.delete('/auth/identities/nope')).status).toBe(404);
  });
});
