# Phase 1 — Database + Auth Implementation Plan

> **Learning plan.** Tasks tagged **[Claude]** are built for you (Docker, frontend, server wiring).
> Tasks tagged **[You]** are guided: each has the **concept**, **what to build**, **how to verify**,
> and a **reference** to compare against after you try. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist users + chat messages in a Postgres (Docker) database and put the chat behind
JWT cookie login.

**Architecture:** Postgres 18 runs in a container; the Express backend talks to it with raw SQL via
`pg`. Auth uses bcrypt + a JWT stored in an httpOnly cookie; `requireAuth` middleware guards the
chat. Each chat persists a user row and a bot row to a `messages` table.

**Tech Stack:** Docker (OrbStack), Postgres 18, `pg`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`,
React + TypeScript.

## Global Constraints

- ES modules; relative imports include `.js`.
- Postgres container maps **host 5433 → container 5432** (native Postgres uses 5432).
- `DATABASE_URL=postgres://resbot:resbot_dev@localhost:5433/resbot`; `JWT_SECRET` required (throw if unset).
- Cookie attributes: `httpOnly: true`, `sameSite: 'lax'`, `secure: false` in dev, **no `Domain`**, 7-day maxAge. Cookie name: `token`.
- Auth error codes: 400 invalid input, 401 bad credentials / missing cookie, 409 duplicate email.
- Run order: `docker compose up -d` → `npm run db:migrate` → `npm run dev:server` → `npm run dev`.

---

### Task 1: Docker Postgres + dependencies  **[Claude]**

**Files:** Create `docker-compose.yml`; modify `.env`, `.env.example`, `package.json`.

- [ ] **Step 1:** Create `docker-compose.yml` (postgres:18, `5433:5432`, named volume `resbot_pgdata`, user/pass/db = `resbot`/`resbot_dev`/`resbot`).
- [ ] **Step 2:** Add to `.env` and `.env.example`: `DATABASE_URL=postgres://resbot:resbot_dev@localhost:5433/resbot` and `JWT_SECRET=` (a long random string in `.env`; blank in `.env.example`).
- [ ] **Step 3:** Install deps: `npm install pg bcryptjs jsonwebtoken cookie-parser`. Add npm script `"db:migrate": "node backend/db/migrate.js"`.
- [ ] **Step 4: Verify.** `docker compose up -d`, then `docker compose ps` (db is `Up`), then `docker compose exec db psql -U resbot -d resbot -c '\dt'` → "Did not find any relations" (correct — no tables yet).

---

### Task 2: DB connection + schema + migration  **[You]**

**Concept:** A **connection pool** reuses a handful of DB connections instead of opening one per
query (faster, safer). The **schema** is the shape of your tables, written as SQL. A **migration**
is just "run the schema against the database" — we make it idempotent with `CREATE TABLE IF NOT
EXISTS` so it's safe to re-run.

**Files:** Create `backend/db/pool.js`, `backend/db/schema.sql`, `backend/db/migrate.js`

**Interfaces — Produces:** `pool` (a `pg` Pool) and `query(text, params)` from `pool.js`.

- [ ] **Step 1: Build `pool.js` yourself** — create a `pg` Pool from `process.env.DATABASE_URL`, export `pool` and a `query` helper.
- [ ] **Step 2: Write `schema.sql`** — the `users` and `messages` tables exactly as in the spec (§5).
- [ ] **Step 3: Build `migrate.js`** — read `schema.sql`, run it through the pool, log success, exit.
- [ ] **Step 4: Verify.** Run `npm run db:migrate` → logs success. Then `docker compose exec db psql -U resbot -d resbot -c '\dt'` → shows `users` and `messages`.
- [ ] **Step 5: Reference:**

```javascript
// backend/db/pool.js
import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export function query(text, params) {
  return pool.query(text, params);
}
```

```sql
-- backend/db/schema.sql
CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text,
  role          text NOT NULL DEFAULT 'employee',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          serial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('user','bot')),
  text        text NOT NULL,
  status      text,
  sources     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

```javascript
// backend/db/migrate.js
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

const sql = await readFile(schemaPath, 'utf8');
await pool.query(sql);
console.log('Migration complete: tables created');
await pool.end();
```

---

### Task 3: Password + token helpers  **[You]**

**Concept:** Never store raw passwords. **bcrypt** turns a password into a one-way **hash**; you
can check a guess against the hash but can't reverse it. A **JWT** is a signed token: the server
signs `{ userId, role }` with a secret, hands it to the browser, and later trusts it because the
signature can't be forged without the secret. The secret living in an env var is what keeps it safe
— so we refuse to start without it.

**Files:** Create `backend/auth/password.js`, `backend/auth/tokens.js`

**Interfaces — Produces:**
- `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>`
- `signToken(payload): string`, `verifyToken(token): object`

- [ ] **Step 1: Build `password.js`** — `hashPassword` uses `bcrypt.hash(plain, 10)`; `verifyPassword` uses `bcrypt.compare`.
- [ ] **Step 2: Build `tokens.js`** — read `JWT_SECRET`; **throw immediately if it's missing**; `signToken` signs with a 7-day expiry; `verifyToken` verifies.
- [ ] **Step 3: Verify** with a throwaway script `backend/auth/_check.js`:

```javascript
import { hashPassword, verifyPassword } from './password.js';
import { signToken, verifyToken } from './tokens.js';
const h = await hashPassword('secret123');
console.assert(await verifyPassword('secret123', h) === true, 'correct pw should verify');
console.assert(await verifyPassword('wrong', h) === false, 'wrong pw should fail');
const t = signToken({ sub: 1, role: 'employee' });
console.assert(verifyToken(t).sub === 1, 'token round-trips');
console.log('Task 3 passed');
```
Run `node backend/auth/_check.js` → `Task 3 passed`. Then delete `_check.js`.

- [ ] **Step 4: Reference:**

```javascript
// backend/auth/password.js
import bcrypt from 'bcryptjs';
export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
```

```javascript
// backend/auth/tokens.js
import 'dotenv/config';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET is not set — refusing to start');

export const signToken = (payload) => jwt.sign(payload, SECRET, { expiresIn: '7d' });
export const verifyToken = (token) => jwt.verify(token, SECRET);
```

---

### Task 4: Users data access  **[You]**

**Concept:** Keep SQL in one place (a "data-access layer") so routes call `createUser(...)` instead
of writing SQL inline. `$1, $2` are **parameterized queries** — the driver safely substitutes
values, which is how you prevent SQL injection. `RETURNING` hands back the inserted row.

**Files:** Create `backend/db/users.js`

**Interfaces — Consumes:** `query` from `pool.js`. **Produces:**
- `createUser({ email, passwordHash, name }): Promise<User>`
- `findUserByEmail(email): Promise<User | null>`
- `findUserById(id): Promise<User | null>`
- `User = { id, email, password_hash, name, role, created_at }`

- [ ] **Step 1: Build the three functions yourself** using parameterized queries (`$1`…). Each returns `rows[0]` (or `null` for the finders when nothing matches).
- [ ] **Step 2: Verify** with `backend/db/_check.js`:

```javascript
import { createUser, findUserByEmail } from './users.js';
import { pool } from './pool.js';
const email = `t${Date.now()}@x.com`;
const u = await createUser({ email, passwordHash: 'h', name: 'Test' });
console.assert(u.id && u.role === 'employee', 'creates with default role');
console.assert((await findUserByEmail(email)).id === u.id, 'finds by email');
console.assert((await findUserByEmail('nope@x.com')) == null, 'missing → null');
console.log('Task 4 passed');
await pool.end();
```
Run `node backend/db/_check.js` → `Task 4 passed`. Delete `_check.js`.

- [ ] **Step 3: Reference:**

```javascript
// backend/db/users.js
import { query } from './pool.js';

export async function createUser({ email, passwordHash, name }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3) RETURNING *`,
    [email, passwordHash, name],
  );
  return rows[0];
}

export async function findUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}
```

---

### Task 5: `requireAuth` middleware  **[You]**

**Concept:** Express **middleware** is a function that runs before a route handler. `requireAuth`
reads the JWT from the cookie, verifies it, and either attaches `req.user` and calls `next()` (let
the request through) or responds `401`. Mounting it before a route is how you protect that route.

**Files:** Create `backend/middleware/requireAuth.js`

**Interfaces — Consumes:** `verifyToken`. **Produces:** `requireAuth(req, res, next)` that sets
`req.user = { id, role }`. (Reads `req.cookies.token` — cookie-parser is wired in Task 7.)

- [ ] **Step 1: Build it yourself** — get `req.cookies?.token`; if absent → `401`; `verifyToken` it inside a try/catch (invalid/expired → `401`); on success set `req.user = { id: payload.sub, role: payload.role }` and `next()`.
- [ ] **Step 2: Verify** — happens end-to-end in Task 7 (needs the server + cookie-parser).
- [ ] **Step 3: Reference:**

```javascript
// backend/middleware/requireAuth.js
import { verifyToken } from '../auth/tokens.js';

export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
```

---

### Task 6: Auth routes  **[You]**

**Concept:** The four endpoints that drive login. Register and login both **set the cookie** (so the
user is logged in immediately); the cookie attributes are what make it work behind the Vite proxy.
Note the security detail: on login, a wrong email and a wrong password return the **same** generic
401 — never reveal which one was wrong.

**Files:** Create `backend/routes/auth.js`

**Interfaces — Consumes:** `createUser`, `findUserByEmail`, `findUserById`, `hashPassword`,
`verifyPassword`, `signToken`, `requireAuth`. **Produces:** an Express `router` (default export)
with `POST /register`, `POST /login`, `POST /logout`, `GET /me`.

- [ ] **Step 1: Build the four routes yourself.** Use the `COOKIE_OPTS` constant below. `register`: validate email + password (≥8 chars) → 400; duplicate email → 409; hash; create; set cookie; return public user. `login`: find; 401 if missing; verify; 401 if wrong; set cookie; return user. `logout`: `res.clearCookie('token')`. `me`: `requireAuth`, then `findUserById(req.user.id)`, return public fields.
- [ ] **Step 2: Verify** — end-to-end in Task 7.
- [ ] **Step 3: Reference:**

```javascript
// backend/routes/auth.js
import { Router } from 'express';
import { createUser, findUserByEmail, findUserById } from '../db/users.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/requireAuth.js';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Valid email and 8+ char password required' });
  }
  if (await findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });
  const user = await createUser({ email, passwordHash: await hashPassword(password), name });
  res.cookie('token', signToken({ sub: user.id, role: user.role }), COOKIE_OPTS);
  res.json(publicUser(user));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await findUserByEmail(email ?? '');
  if (!user || !(await verifyPassword(password ?? '', user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.cookie('token', signToken({ sub: user.id, role: user.role }), COOKIE_OPTS);
  res.json(publicUser(user));
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(publicUser(user));
});

export default router;
```

---

### Task 7: Wire the server + protect chat  **[Claude]**

**Files:** Modify `backend/server.js`.

- [ ] **Step 1:** Add `cookieParser()` middleware, mount `authRouter` at `/api/auth`, and protect chat: `app.use('/api/chat', requireAuth, createChatRouter(store))`.
- [ ] **Step 2: Verify failure + happy paths with curl** (cookie jar):
  - `register` new email → 200 + `Set-Cookie`; duplicate → 409; 5-char password → 400.
  - `login` wrong password → 401; correct → 200 + cookie.
  - `GET /api/auth/me` **without** cookie → 401; **with** cookie → 200.
  - `POST /api/chat` **without** cookie → 401; **with** cookie → 200.

---

### Task 8: Persist chat messages  **[You]**

**Concept:** Now that the chat knows *who* is asking (`req.user.id` from `requireAuth`), each
exchange is saved to the `messages` table — replacing the old file log. One question = two rows
(the user's question, the bot's reply). `sources` is stored as JSON.

**Files:** Create `backend/db/messages.js`; modify `backend/routes/chat.js`; delete `backend/lib/logger.js`.

**Interfaces — Produces:** `saveMessage({ userId, role, text, status, sources }): Promise<void>`.

- [ ] **Step 1: Build `messages.js` yourself** — an INSERT with parameterized values; store `sources` as `JSON.stringify(sources ?? [])`.
- [ ] **Step 2: Update `chat.js`** — remove the `logChat` import/call; after `answerQuestion`, save the user row then the bot row using `req.user.id`.
- [ ] **Step 3: Delete `backend/lib/logger.js`.**
- [ ] **Step 4: Verify.** Send a chat (logged in), then `docker compose exec db psql -U resbot -d resbot -c 'SELECT user_id, role, status FROM messages ORDER BY id DESC LIMIT 2;'` → a `user` row and a `bot` row with your user_id.
- [ ] **Step 5: Reference:**

```javascript
// backend/db/messages.js
import { query } from './pool.js';

export async function saveMessage({ userId, role, text, status, sources }) {
  await query(
    `INSERT INTO messages (user_id, role, text, status, sources)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, role, text, status ?? null, JSON.stringify(sources ?? [])],
  );
}
```

```javascript
// backend/routes/chat.js — handler body (inside the try)
const { question } = req.body ?? {};
if (typeof question !== 'string' || !question.trim()) {
  return res.status(400).json({ error: 'question is required' });
}
const q = question.trim();
const result = await answerQuestion(store, q);
await saveMessage({ userId: req.user.id, role: 'user', text: q });
await saveMessage({ userId: req.user.id, role: 'bot', text: result.answer, status: result.status, sources: result.sources });
return res.json(result);
```

---

### Task 9: Frontend — login, register, gating  **[Claude]**

**Files:** Create `src/pages/Login.tsx`, `src/pages/Register.tsx`, `src/auth/AuthContext.tsx`;
modify `src/App.tsx`, `src/api/client.ts`, `src/pages/Chat.tsx` (logout button).

- [ ] **Step 1:** `client.ts` — add `credentials: 'include'` to all calls; add `login`, `register`, `logout`, `getMe`.
- [ ] **Step 2:** `AuthContext.tsx` — on mount call `getMe()`; expose `{ user, loading, login, register, logout }`.
- [ ] **Step 3:** `Login.tsx` / `Register.tsx` — forms in the existing warm style; show server errors inline.
- [ ] **Step 4:** `App.tsx` — `AuthProvider` + gating: loading → spinner; no user → auth screens (toggle login/register); user → `Chat`. Add a logout button to the chat header.
- [ ] **Step 5: Verify in the BROWSER (not just curl):** register via the UI → land in chat; **refresh the page → still logged in** (proves the cookie persists behind the proxy); logout → back to login; a logged-out chat attempt redirects to login.

---

## Done when

The chat is reachable only after login, sessions survive a refresh, registration/login/logout work
in the browser, and every exchange is stored in the `messages` table tied to the user.
