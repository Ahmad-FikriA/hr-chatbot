import { appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'chat.log');

// Appends one interaction to backend/logs/chat.log as a single JSON line
// (JSON Lines format: append-only, one complete record per line).
export async function logChat({ question, status, sources, answer }) {
  const entry = { time: new Date().toISOString(), question, status, sources, answer };
  await appendFile(LOG_FILE, JSON.stringify(entry) + '\n');
}
