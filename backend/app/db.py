import os
import json
import asyncpg

class Database:
    def __init__(self):
        self.pool = None
        self.use_fallback = False
        # In-memory storage when Postgres is offline
        self._users = {}
        self._next_user_id = 1
        self._messages = []

    async def connect(self):
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            print("DATABASE_URL not found. Using in-memory fallback store.")
            self.use_fallback = True
            return

        try:
            self.pool = await asyncpg.create_pool(database_url, timeout=3.0)
            self.use_fallback = False
        except Exception as e:
            print(f"Postgres not reachable ({e}). Switching to in-memory fallback mode.")
            self.use_fallback = True

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def query(self, query_str, *args):
        if self.use_fallback or not self.pool:
            return []
        async with self.pool.acquire() as connection:
            return await connection.fetch(query_str, *args)

    async def fetchrow(self, query_str, *args):
        if self.use_fallback or not self.pool:
            return None
        async with self.pool.acquire() as connection:
            return await connection.fetchrow(query_str, *args)

    async def execute(self, query_str, *args):
        if self.use_fallback or not self.pool:
            return "OK"
        async with self.pool.acquire() as connection:
            return await connection.execute(query_str, *args)

db = Database()

# Database helper functions with fallback support

async def create_user(email: str, password_hash: str, name: str | None) -> dict:
    if db.use_fallback or not db.pool:
        user_id = db._next_user_id
        db._next_user_id += 1
        user = {
            "id": user_id,
            "email": email,
            "password_hash": password_hash,
            "name": name,
            "role": "employee"
        }
        db._users[email.lower()] = user
        return user

    row = await db.fetchrow(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *",
        email, password_hash, name
    )
    return dict(row)

async def find_user_by_email(email: str) -> dict | None:
    if db.use_fallback or not db.pool:
        return db._users.get(email.lower())

    row = await db.fetchrow("SELECT * FROM users WHERE email = $1", email)
    return dict(row) if row else None

async def find_user_by_id(user_id: int) -> dict | None:
    if db.use_fallback or not db.pool:
        for u in db._users.values():
            if u["id"] == user_id:
                return u
        return None

    row = await db.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    return dict(row) if row else None

async def save_message(user_id: int, role: str, text: str, status: str | None, sources: list) -> None:
    if db.use_fallback or not db.pool:
        db._messages.append({
            "user_id": user_id,
            "role": role,
            "text": text,
            "status": status,
            "sources": sources
        })
        return

    await db.execute(
        "INSERT INTO messages (user_id, role, text, status, sources) VALUES ($1, $2, $3, $4, $5)",
        user_id, role, text, status, json.dumps(sources)
    )

