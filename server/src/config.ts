export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  /** Where the browser goes after sign-in. */
  clientUrl: string;
  secureCookies: boolean;
  google: GoogleConfig | undefined;
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

  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    sessionSecret: required('SESSION_SECRET'),
    clientUrl: env.CLIENT_URL ?? 'http://localhost:5173',
    secureCookies: env.NODE_ENV === 'production',
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
