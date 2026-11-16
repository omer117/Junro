import { describe, expect, it } from 'vitest';
import { SignInRefused } from './identities.js';
import {
  githubIdentity,
  googleIdentity,
  MICROSOFT_CONSUMERS_TENANT,
  microsoftIdentity,
} from './providers.js';

const emailsResponse = (emails: unknown, ok = true) =>
  (async () => ({ ok, json: async () => emails })) as unknown as typeof fetch;

describe('githubIdentity', () => {
  const profile = { id: '42', displayName: 'Ann Dev', username: 'anndev' };

  it('uses the primary verified email from /user/emails, never the public profile email', async () => {
    const fetchImpl = emailsResponse([
      { email: 'public@example.com', primary: false, verified: true },
      { email: 'ann@example.com', primary: true, verified: true },
    ]);

    expect(await githubIdentity(profile, 'token', fetchImpl)).toEqual({
      provider: 'github',
      providerId: '42',
      email: 'ann@example.com',
      emailVerified: true,
      name: 'Ann Dev',
    });
  });

  it('asks GitHub with the access token and a User-Agent', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
      seen = { url, headers: init.headers };
      return { ok: true, json: async () => [{ email: 'a@x.com', primary: true, verified: true }] };
    }) as unknown as typeof fetch;

    await githubIdentity(profile, 'secret-token', fetchImpl);

    expect(seen!.url).toBe('https://api.github.com/user/emails');
    expect(seen!.headers.Authorization).toBe('Bearer secret-token');
    expect(seen!.headers['User-Agent']).toBeTruthy();
  });

  it('refuses when the primary email is not verified', async () => {
    const fetchImpl = emailsResponse([
      { email: 'ann@example.com', primary: true, verified: false },
    ]);

    await expect(githubIdentity(profile, 't', fetchImpl)).rejects.toMatchObject({
      reason: 'no_verified_email',
    });
  });

  it('refuses when there is no email at all, or GitHub does not answer', async () => {
    await expect(githubIdentity(profile, 't', emailsResponse([]))).rejects.toBeInstanceOf(
      SignInRefused,
    );
    await expect(githubIdentity(profile, 't', emailsResponse([], false))).rejects.toBeInstanceOf(
      SignInRefused,
    );
  });

  it('falls back to the username for the name', async () => {
    const fetchImpl = emailsResponse([{ email: 'a@x.com', primary: true, verified: true }]);

    const identity = await githubIdentity({ id: '1', username: 'anndev' }, 't', fetchImpl);

    expect(identity.name).toBe('anndev');
  });
});

describe('microsoftIdentity', () => {
  const personal = {
    sub: 'abc',
    email: 'ann@outlook.com',
    name: 'Ann',
    tid: MICROSOFT_CONSUMERS_TENANT,
  };

  it('maps the claims of a personal account to an identity with a verified email', () => {
    expect(microsoftIdentity(personal)).toEqual({
      provider: 'microsoft',
      providerId: 'abc',
      email: 'ann@outlook.com',
      emailVerified: true,
      name: 'Ann',
    });
  });

  it('refuses a work or school account (its email claim proves nothing)', () => {
    expect(() =>
      microsoftIdentity({ ...personal, tid: 'f8cdef31-a31e-4b4a-93e4-5f571e91255a' }),
    ).toThrow(SignInRefused);
  });

  it('refuses when there is no email', () => {
    expect(() => microsoftIdentity({ ...personal, email: undefined })).toThrow(SignInRefused);
  });

  it('falls back to the user name when there is no display name', () => {
    const identity = microsoftIdentity({
      ...personal,
      name: undefined,
      preferred_username: 'ann@outlook.com',
    });

    expect(identity.name).toBe('ann@outlook.com');
  });
});

describe('googleIdentity', () => {
  it('reads Google email_verified', () => {
    expect(
      googleIdentity({
        id: '1',
        displayName: 'Ann',
        emails: [{ value: 'a@x.com', verified: true }],
      }),
    ).toMatchObject({ provider: 'google', emailVerified: true });
    expect(
      googleIdentity({ id: '1', displayName: 'Ann', emails: [{ value: 'a@x.com' }] }),
    ).toMatchObject({ emailVerified: false });
  });
});
