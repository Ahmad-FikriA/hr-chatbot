import os
import json
import asyncpg

class Database:
    def __init__(self):
        self.pool = None

    async def connect(self):
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise ValueError("DATABASE_URL is not set in environment")
        self.pool = await asyncpg.create_pool(database_url)

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def query(self, query_str, *args):
        async with self.pool.acquire() as connection:
            return await connection.fetch(query_str, *args)

    async def fetchrow(self, query_str, *args):
        async with self.pool.acquire() as connection:
            return await connection.fetchrow(query_str, *args)

    async def execute(self, query_str, *args):
        async with self.pool.acquire() as connection:
            return await connection.execute(query_str, *args)

db = Database()

# Database helper functions mapping to the original Express queries

async def create_user(email: str, password_hash: str, name: str | None) -> dict:
    row = await db.fetchrow(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *",
        email, password_hash, name
    )
    return dict(row)

async def find_user_by_email(email: str) -> dict | None:
    row = await db.fetchrow("SELECT * FROM users WHERE email = $1", email)
    return dict(row) if row else None

async def find_user_by_id(user_id: int) -> dict | None:
    row = await db.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    return dict(row) if row else None

async def save_message(user_id: int, role: str, text: str, status: str | None, sources: list) -> None:
    # sources is stored as JSONB, which is passed as a string or decoded json.
    # In asyncpg, JSON/JSONB can be automatically encoded or we can serialize it and pass the string.
    # To be safe and compliant, we pass the serialized JSON string.
    await db.execute(
        "INSERT INTO messages (user_id, role, text, status, sources) VALUES ($1, $2, $3, $4, $5)",
        user_id, role, text, status, json.dumps(sources)
    )
