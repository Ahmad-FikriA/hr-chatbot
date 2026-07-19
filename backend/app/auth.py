import os
import bcrypt
import jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load env variables from the root .env file
dotenv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv(dotenv_path)

# Load JWT secret from environment
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    # A fallback key for development if env is not loaded, but production should fail
    JWT_SECRET = "fallback-secret-key-change-in-production"

ALGORITHM = "HS256"
TOKEN_EXPIRY_DAYS = 7

# Password hashing functions
def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False

# JWT token functions
def sign_token(payload: dict) -> str:
    """Generate a JWT token with an expiration time."""
    to_encode = payload.copy()
    expire = datetime.utcnow() + timedelta(days=TOKEN_EXPIRY_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def verify_token(token: str) -> dict | None:
    """Verify a JWT token and return the payload."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None
