import { query } from './pool.js';

export async function saveMessage({ userId, role, text, status, sources }) {
  await query(
    `INSERT INTO messages (user_id, role, text, status, sources)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, role, text, status ?? null, JSON.stringify(sources ?? [])],
  );
}