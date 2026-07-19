import os
import uvicorn
from dotenv import load_dotenv

# Load env variables from the parent directory (.env)
dotenv_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(dotenv_path)

if __name__ == "__main__":
    # Standard port is 3000 (which matches the React frontend's default target)
    port = int(os.getenv("PORT", 3000))
    print(f"Starting uvicorn server on port {port}...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
