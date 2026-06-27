import {pool } from './pool.js';
import fs from 'fs';

const sql = fs.readFileSync('backend/db/schema.sql', 'utf8');

async function migrate() {
    console.log('Running database migration...');
    await pool.query(sql);
    console.log('Migration completed successfully.');
    process.exit(0);
}

migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
