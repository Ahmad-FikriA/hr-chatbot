# Phase 1 — Database + Auth Design

**Date:** 2026-06-27
**Status:** Approved direction; to be turned into an implementation plan.
**Builds on:** the working RAG bot ([2026-06-26 RAG design](2026-06-26-hr-rag-bot-design.md)).

## 1. Purpose

Turn ResBot from a stateless single-user demo into the foundation of a real system:
**persist application data in a database** and **put the chat behind login**. This also doubles as a
guided introduction to **Docker** and **SQL/auth fundamentals**.

Scope is deliberately narrow: **users, auth, and message persistence**. The knowledge-base vector
store stays in-memory (it re-embeds on startup, which is fine at this size). Conversation grouping,
multi-turn memory, and an admin dashboard are later phases.

## 2. Learning split

- **User builds, Claude guides** (the parts worth learning): `docker-compose.yml`, the SQL
  `schema.sql`, the `pg` data-access functions, bcrypt hashing, JWT sign/verify, the auth routes,
  and the `requireAuth` middleware.
- **Claude builds**: the Login/Register UI + AuthContext + auth gating, and the `server.js` wiring.

## 3. Architecture

```
  Browser                          Express backend                 Docker (OrbStack)
 ┌───────────────┐                ┌──────────────────────┐        ┌──────────────┐
 │ Login/Register│──/api/auth/*──▶│ Auth routes          │        │ Postgres 18  │
 │   (Claude)    │  (sets cookie) │  register/login/me   │──SQL──▶│ (container)  │
 │ Chat (gated)  │──/api/chat────▶│ requireAuth ▶ RAG    │        │ users,       │
 └───────────────┘  (cookie sent) └──────────────────────┘        │ messages     │
                                                                  └──────────────┘
```

## 4. Database (Docker)

Postgres 18 runs as a **container** via `docker-compose.yml`, with a named volume so data
survives restarts.

> ⚠️ **Port collision:** the user already runs Postgres 18 **natively** (default `5432`). To avoid
> silently connecting to the wrong instance, the container maps **host `5433` → container `5432`**,
> and the app connects to `5433`.

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_USER: resbot
      POSTGRES_PASSWORD: resbot_dev
      POSTGRES_DB: resbot
    ports:
      - "5433:5432"          # host 5433 -> container 5432 (avoids native pg on 5432)
    volumes:
      - resbot_pgdata:/var/lib/postgresql/data
volumes:
  resbot_pgdata:
```

**Env (added to `.env` and `.env.example`):**
```
DATABASE_URL=postgres://resbot:resbot_dev@localhost:5433/resbot
JWT_SECRET=            # required; backend throws on startup if unset
```

**Which-Postgres verification:** after `docker compose up -d`, confirm with `docker compose ps`
(container is `Up`) and that tables exist in the *container* (`docker compose exec db psql -U resbot
-d resbot -c '\dt'`) — not the native instance.

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text,
  role          text NOT NULL DEFAULT 'employee',   -- 'employee' | 'hr_admin'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          serial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('user','bot')),
  text        text NOT NULL,
  status      text,                                  -- answered | escalated | no_answer
  sources     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Lives in `backend/db/schema.sql`; applied by an idempotent runner via `npm run db:migrate`.

## 6. Authentication

### Token & cookie

- JWT signed with `JWT_SECRET` (payload: `{ sub: userId, role }`), ~7-day expiry.
- Returned as an **httpOnly cookie**. Exact attributes (these are the make-or-break bit behind the
  Vite proxy):
  - `httpOnly: true`
  - `sameSite: 'lax'`
  - `secure: false` in development (plain HTTP — a `Secure` cookie would be silently dropped),
    `true` in production
  - **no `Domain` attribute** (host-only cookie, so the proxy forwards it correctly)
  - `maxAge`: 7 days

### Endpoints (`backend/routes/auth.js`)

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/api/auth/register` | Validate email + password (min length); 409 if email exists; bcrypt-hash; insert; set cookie; return `{ id, email, name, role }` |
| POST | `/api/auth/login` | Find by email; bcrypt-compare; 401 if wrong; sign JWT; set cookie; return user |
| POST | `/api/auth/logout` | Clear the cookie |
| GET | `/api/auth/me` | `requireAuth`; return the current user |

### `requireAuth` middleware (`backend/middleware/requireAuth.js`)

Reads the cookie, verifies the JWT, attaches `req.user = { id, role }`; responds `401` if the
cookie is missing or invalid. Guards `GET /api/auth/me` and `POST /api/chat`.

### Helpers

- `backend/auth/password.js` — `hashPassword` / `verifyPassword` (bcryptjs).
- `backend/auth/tokens.js` — `signToken` / `verifyToken` (jsonwebtoken). **Throws at import/startup
  if `JWT_SECRET` is unset** rather than signing with `undefined`.

## 7. Chat route changes

`POST /api/chat` now:
1. Runs **`requireAuth` first** (so `req.user.id` is available).
2. Calls `answerQuestion` as before.
3. **Replaces `logChat`** by writing **two rows** to `messages` via `backend/db/messages.js`:
   the user's question (`role:'user'`) and the bot's reply (`role:'bot'`, with `status` + `sources`),
   both tagged with `req.user.id`.

The file logger (`backend/lib/logger.js`) is retired.

## 8. Frontend (Claude builds)

- `src/pages/Login.tsx`, `src/pages/Register.tsx` — forms matching the existing warm design.
- `src/auth/AuthContext.tsx` — calls `GET /api/auth/me` on load; exposes `user`, `login`,
  `register`, `logout`.
- **Gating** in `App.tsx`: no user → auth screens (toggle between login/register); user → the chat,
  with a **logout button** added to the chat header.
- `src/api/client.ts` — all `fetch` calls use `credentials: 'include'`; a `401` clears auth state
  and shows the login screen.
- No router dependency (3 screens, conditional render).

## 9. File structure (added/changed)

```
docker-compose.yml                    [new]  Postgres 18 container          (user, guided)
backend/
├── db/
│   ├── pool.js          [new]  pg Pool from DATABASE_URL                    (user)
│   ├── schema.sql       [new]  users + messages tables                     (user)
│   ├── migrate.js       [new]  runs schema.sql (npm run db:migrate)        (user)
│   ├── users.js         [new]  createUser / findUserByEmail (raw SQL)      (user)
│   └── messages.js      [new]  saveMessage (raw SQL) — replaces logChat    (user)
├── auth/
│   ├── password.js      [new]  bcryptjs hash/verify                        (user)
│   └── tokens.js        [new]  jwt sign/verify (+ JWT_SECRET guard)        (user)
├── middleware/
│   └── requireAuth.js   [new]  cookie -> verify -> req.user                (user)
├── routes/
│   ├── auth.js          [new]  register/login/logout/me                    (user)
│   └── chat.js          [mod]  requireAuth + persist messages              (user)
├── lib/logger.js        [del]  retired (replaced by messages table)
└── server.js            [mod]  cookie-parser, mount auth, protect chat     (Claude)
src/
├── pages/Login.tsx      [new]                                              (Claude)
├── pages/Register.tsx   [new]                                              (Claude)
├── auth/AuthContext.tsx [new]                                              (Claude)
├── App.tsx              [mod]  auth gating                                 (Claude)
└── api/client.ts        [mod]  credentials: 'include'                      (Claude)
```

## 10. How to run (explicit ordering)

Container Postgres takes a few seconds to accept connections, so the steps are sequenced (not
auto-migrate-on-boot):

```bash
docker compose up -d      # 1. start Postgres (wait until 'docker compose ps' shows healthy/up)
npm run db:migrate        # 2. create tables
npm run dev:server        # 3. backend  (terminal A)
npm run dev               # 4. frontend (terminal B)
```

## 11. Error handling

- **DB:** fail fast on startup with a clear message if the pool can't connect or `JWT_SECRET` is unset.
- **Auth:** `400` invalid input, `401` bad credentials / missing-invalid cookie, `409` duplicate email,
  `500` unexpected. Never leak whether an email exists on *login* (generic "invalid credentials").
- **Frontend:** inline form errors; a `401` from any call drops to the login screen.

## 12. Verification (must include failure cases)

Because the user hand-builds the security code, verification checks are the safety net — happy path
is not enough:

- **Register:** new email → 200 + cookie; **duplicate email → 409**; short password → 400.
- **Login:** correct password → 200 + cookie; **wrong password → 401**; unknown email → 401.
- **Protected:** `GET /api/auth/me` and `POST /api/chat` **without a cookie → 401**; with cookie → 200.
- **Cookie path (browser, not just curl):** log in via the actual UI, refresh the page, confirm you
  stay logged in. (curl will show `Set-Cookie` even when the browser would drop it — so this check
  must be done in the browser.)
- **Persistence:** after a chat, the `messages` table has the user + bot rows tied to the user id.

## 13. New dependencies

Backend: `pg`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`. Frontend: none.

## 14. Out of scope (later phases)

Conversation grouping + history sidebar, multi-turn memory, admin dashboard, password reset, email
verification, refresh tokens, rate limiting, automated test suite, deployment.
