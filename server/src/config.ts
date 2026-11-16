import type { QuotaCaps } from './google/guard.js';

/** One sign-in provider's OAuth app: where it is registered and where it sends the person back. */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}
export type GoogleConfig = OAuthConfig;

export const DEFAULT_QUOTA_CAPS: QuotaCaps = {
  // Google's free monthly tiers are 10,000 (Essentials), 5,000 (Pro) and 1,000 (Enterprise)
  // calls per SKU. These defaults stay well below, so a bug can never cost money.
  autocomplete: 5000,
  placeDetails: 800,
  routeMatrix: 4000,
  computeRoutes: 4000,
  // Public transport is billed like the basic tier (10,000 free a month); these stay well below.
  transitMatrix: 3000,
  transitRoutes: 1500,
};

export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  /** Where the browser goes after sign-in. */
  clientUrl: string;
  secureCookies: boolean;
  google: GoogleConfig | undefined;
  github: OAuthConfig | undefined;
  /** Personal Microsoft accounts only. */
  microsoft: OAuthConfig | undefined;
  /** Server-side key for Places and Routes. Never sent to the browser. */
  googleApiKey: string | undefined;
  quotaCaps: QuotaCaps;
}

/** Reads settings from environment variables. Secrets live here and nowhere else. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
  };

  // Each provider is all-or-none: three settings, or none (then it is simply not offered).
  const oauth = (prefix: string): OAuthConfig | undefined => {
    const names = [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`, `${prefix}_CALLBACK_URL`];
    const set = names.filter((name) => env[name]);
    if (set.length !== 0 && set.length !== names.length) {
      throw new Error(`Set all of ${names.join(', ')} or none of them`);
    }
    return set.length === 0
      ? undefined
      : {
          clientId: required(names[0]!),
          clientSecret: required(names[1]!),
          callbackUrl: required(names[2]!),
        };
  };

  const cap = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number >= 0`);
    return Number(raw);
  };

  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    sessionSecret: required('SESSION_SECRET'),
    clientUrl: env.CLIENT_URL ?? 'http://localhost:5173',
    secureCookies: env.NODE_ENV === 'production',
    googleApiKey: env.GOOGLE_API_KEY || undefined,
    quotaCaps: {
      autocomplete: cap('GOOGLE_CAP_AUTOCOMPLETE', DEFAULT_QUOTA_CAPS.autocomplete),
      placeDetails: cap('GOOGLE_CAP_PLACE_DETAILS', DEFAULT_QUOTA_CAPS.placeDetails),
      routeMatrix: cap('GOOGLE_CAP_ROUTE_MATRIX', DEFAULT_QUOTA_CAPS.routeMatrix),
      computeRoutes: cap('GOOGLE_CAP_COMPUTE_ROUTES', DEFAULT_QUOTA_CAPS.computeRoutes),
      transitMatrix: cap('GOOGLE_CAP_TRANSIT_MATRIX', DEFAULT_QUOTA_CAPS.transitMatrix),
      transitRoutes: cap('GOOGLE_CAP_TRANSIT_ROUTES', DEFAULT_QUOTA_CAPS.transitRoutes),
    },
    google: oauth('GOOGLE'),
    github: oauth('GITHUB'),
    microsoft: oauth('MICROSOFT'),
  };
}
