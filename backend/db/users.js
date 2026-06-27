import {query} from './pool.js';


export async function createUser({ email, passwordHash, name }) {
    const res = await query(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *',
        [email, passwordHash, name]
    );
    return res.rows[0];
}

export async function findUserByEmail(email) {
    const res = await query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0];
}

export async function findUserById(id) {
    const res = await query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0];
}