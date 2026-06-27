import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Small helper so other files call query(...) instead of pool.query(...)
export function query(text, params) {
  return pool.query(text, params);
}