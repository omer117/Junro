import type { QuotaCaps } from './google/guard.js';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export const DEFAULT_QUOTA_CAPS: QuotaCaps = {
  // Google's free monthly tiers are 10,000 (Essentials), 5,000 (Pro) and 1,000 (Enterprise)
  // calls per SKU. These defaults stay well below, so a bug can never cost money.
  autocomplete: 5000,
  placeDetails: 800,
  routeMatrix: 4000,
  computeRoutes: 4000,
};

export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  /** Where the browser goes after sign-in. */
  clientUrl: string;
  secureCookies: boolean;
  google: GoogleConfig | undefined;
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

  const googleNames = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'] as const;
  const googleSet = googleNames.filter((name) => env[name]);
  if (googleSet.length !== 0 && googleSet.length !== googleNames.length) {
    throw new Error(`Set all of ${googleNames.join(', ')} or none of them`);
  }

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
    },
    google:
      googleSet.length === 0
        ? undefined
        : {
            clientId: required('GOOGLE_CLIENT_ID'),
            clientSecret: required('GOOGLE_CLIENT_SECRET'),
            callbackUrl: required('GOOGLE_CALLBACK_URL'),
          },
  };
}
