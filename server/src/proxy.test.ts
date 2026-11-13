import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createDb } from './db/client.js';
import { testDatabaseUrl } from './db/test-db.js';
import { createTestApp } from './test-app.js';

const { db } = createDb(testDatabaseUrl);

describe('running behind a proxy (Vercel in front of the server)', () => {
  it('sets a Secure session cookie when the proxy says the browser used https', async () => {
    const app = createTestApp(db, { secureCookies: true });

    const res = await request(app).post('/__login/anyone').set('X-Forwarded-Proto', 'https');

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('junro.sid=');
    expect(cookie).toContain('Secure');
  });
});
