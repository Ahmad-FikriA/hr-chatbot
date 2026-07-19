import os
import asyncio
import asyncpg
from dotenv import load_dotenv

# Load env variables from root folder
dotenv_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(dotenv_path)

DATABASE_URL = os.getenv("DATABASE_URL")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "db", "schema.sql")

async def migrate():
    print("Running database migration...")
    
    if not DATABASE_URL:
        print("Error: DATABASE_URL not set in environment.")
        return 1
        
    if not os.path.exists(SCHEMA_PATH):
        print(f"Error: Schema SQL not found at {SCHEMA_PATH}")
        return 1
        
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()
        
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        # Execute the schema.sql script
        await conn.execute(schema_sql)
        await conn.close()
        print("Migration completed successfully.")
        return 0
    except Exception as e:
        print(f"Migration failed: {e}")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(migrate())
    exit(exit_code)
