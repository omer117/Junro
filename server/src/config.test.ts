import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://x', SESSION_SECRET: 'a-long-random-secret' };

describe('loadConfig', () => {
  it('reads the required values and defaults the rest', () => {
    const config = loadConfig(base);

    expect(config).toMatchObject({
      databaseUrl: 'postgres://x',
      sessionSecret: 'a-long-random-secret',
      port: 3000,
      clientUrl: 'http://localhost:5173',
      secureCookies: false,
      google: undefined,
    });
  });

  it.each(['DATABASE_URL', 'SESSION_SECRET'])('fails when %s is missing', (name) => {
    const env: Record<string, string> = { ...base };
    delete env[name];

    expect(() => loadConfig(env)).toThrow(name);
  });

  it('turns on Google sign-in when all three Google values are set', () => {
    const config = loadConfig({
      ...base,
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    });

    expect(config.google).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost:3000/auth/google/callback',
    });
  });

  it('fails when only some of the Google values are set', () => {
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE/);
  });

  it('uses secure cookies in production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).secureCookies).toBe(true);
  });

  describe('Google API access', () => {
    it('has no API key by default, and caps well below the free tiers', () => {
      const config = loadConfig(base);

      expect(config.googleApiKey).toBeUndefined();
      expect(config.quotaCaps).toEqual({
        autocomplete: 5000,
        placeDetails: 800,
        routeMatrix: 4000,
        computeRoutes: 4000,
        transitMatrix: 3000,
        transitRoutes: 1500,
      });
    });

    it('reads the API key and lets each cap be changed', () => {
      const config = loadConfig({
        ...base,
        GOOGLE_API_KEY: 'key-123',
        GOOGLE_CAP_PLACE_DETAILS: '50',
        GOOGLE_CAP_AUTOCOMPLETE: '0',
      });

      expect(config.googleApiKey).toBe('key-123');
      expect(config.quotaCaps.placeDetails).toBe(50);
      expect(config.quotaCaps.autocomplete).toBe(0);
    });

    it.each(['abc', '-5', '1.5', ''])('rejects the cap value %j', (value) => {
      expect(() => loadConfig({ ...base, GOOGLE_CAP_ROUTE_MATRIX: value })).toThrow(
        /GOOGLE_CAP_ROUTE_MATRIX/,
      );
    });
  });
});
