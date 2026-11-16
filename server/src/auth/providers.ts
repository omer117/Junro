import { SignInRefused, type ProviderIdentity } from './identities.js';

export const PROVIDERS = ['google', 'github', 'microsoft'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const isProvider = (value: string): value is ProviderName =>
  (PROVIDERS as readonly string[]).includes(value);

/** The part of a Google profile we use (passport-google-oauth20 gives us more). */
export interface GoogleProfile {
  id: string;
  displayName: string;
  emails?: Array<{ value: string; verified?: boolean | string | undefined }> | undefined;
}

/** Google says whether it checked the address (`email_verified` in the ID token). */
export function googleIdentity(profile: GoogleProfile): ProviderIdentity {
  const email = profile.emails?.[0];
  if (!email?.value) throw new Error('Google did not return an email address for this account');
  return {
    provider: 'google',
    providerId: profile.id,
    email: email.value,
    // Some library versions pass the flag as a string.
    emailVerified: email.verified === true || email.verified === 'true',
    name: profile.displayName,
  };
}

export interface GithubProfile {
  id: string;
  displayName?: string | undefined;
  username?: string | undefined;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * GitHub's profile email is whatever the person typed in public settings: it can be unverified or
 * not theirs. The trustworthy source is `GET /user/emails`, and only the PRIMARY and VERIFIED one
 * counts. Without one we refuse: there is nothing safe to link on.
 */
export async function githubIdentity(
  profile: GithubProfile,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderIdentity> {
  const response = await fetchImpl('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      // GitHub rejects API calls without a User-Agent.
      'User-Agent': 'junro-server',
    },
  });
  if (!response.ok) throw new SignInRefused('no_verified_email');

  const emails = (await response.json()) as GithubEmail[];
  const primary = emails.find((e) => e.primary && e.verified);
  if (!primary) throw new SignInRefused('no_verified_email');

  return {
    provider: 'github',
    providerId: profile.id,
    email: primary.email,
    emailVerified: true,
    name: profile.displayName || profile.username || primary.email,
  };
}

/** Microsoft's tenant id for personal accounts (outlook.com, hotmail.com, live.com). */
export const MICROSOFT_CONSUMERS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export interface MicrosoftClaims {
  sub: string;
  email?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  tid?: unknown;
}

/**
 * Personal Microsoft accounts only. For those the email is the account's own sign-in address,
 * checked by Microsoft. A work or school account can have an `email` claim set by a tenant admin
 * and that proves nothing about ownership (the 2023 "nOAuth" problem), so those are refused.
 */
export function microsoftIdentity(claims: MicrosoftClaims): ProviderIdentity {
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  if (claims.tid !== MICROSOFT_CONSUMERS_TENANT || !email) {
    throw new SignInRefused('no_verified_email');
  }
  const name =
    typeof claims.name === 'string' && claims.name
      ? claims.name
      : typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : email;
  return { provider: 'microsoft', providerId: claims.sub, email, emailVerified: true, name };
}
