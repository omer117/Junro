import { createDb } from '../db/client.js';
import { seedAirports } from './seed.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');

const { db, pool } = createDb(url);
try {
  const count = await seedAirports(db);
  console.log(`Airports loaded: ${count}`);
} finally {
  await pool.end();
}
