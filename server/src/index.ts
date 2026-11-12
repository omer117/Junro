import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createHttpMapsClient } from './google/http-client.js';

const config = loadConfig(process.env);
const { db, pool } = createDb(config.databaseUrl);

const PgSessionStore = connectPgSimple(session);

const app = createApp({
  db,
  sessionSecret: config.sessionSecret,
  sessionStore: new PgSessionStore({ pool, createTableIfMissing: true }),
  secureCookies: config.secureCookies,
  ...(config.google ? { google: config.google } : {}),
  clientUrl: config.clientUrl,
  quotaCaps: config.quotaCaps,
  ...(config.googleApiKey ? { maps: createHttpMapsClient({ apiKey: config.googleApiKey }) } : {}),
});

app.listen(config.port, () => {
  console.log(`Junro server listening on port ${config.port}`);
});
