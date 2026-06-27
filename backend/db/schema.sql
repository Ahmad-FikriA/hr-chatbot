CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,           -- auto-incrementing id
  email         text UNIQUE NOT NULL,         -- no two users share an email
  password_hash text NOT NULL,               -- bcrypt hash, never the raw password
  name          text,
  role          text NOT NULL DEFAULT 'employee',  -- 'employee' | 'hr_admin' (future)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          serial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users(id),  -- which user (foreign key)
  role        text NOT NULL CHECK (role IN ('user','bot')),  -- only these two values allowed
  text        text NOT NULL,
  status      text,                                -- answered | escalated | no_answer
  sources     jsonb,                               -- the cited files, as JSON
  created_at  timestamptz NOT NULL DEFAULT now()
);