import os
import re
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load env variables from the root .env file
dotenv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv(dotenv_path)

from fastapi import FastAPI, HTTPException, status, Depends, Request, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import LangChain components
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_community.vectorstores.utils import DistanceStrategy
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.documents import Document

# Import custom modules
from app.db import (
    db,
    create_user,
    find_user_by_email,
    find_user_by_id,
    save_message
)
from app.auth import (
    hash_password,
    verify_password,
    sign_token,
    verify_token
)

# 1. Configuration & Directories
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
CHAT_MODEL = os.getenv("CHAT_MODEL", "google/gemma-2-9b-it:free")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

KNOWLEDGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "knowledge"))
MIN_SCORE = 0.30  # Matches Express MIN_SCORE of 0.3
TOP_K = 3

# Model prompts
SYSTEM_PROMPT = """You are an HR assistant for an Indonesian company. Answer ONLY using the provided context.
Reply in the SAME language as the user's question (English or Bahasa Indonesia).
If the answer is not in the context, say you don't have that information and suggest contacting HR.
Be concise and do not invent policy details.

Context:
{context}"""

ESCALATION_MESSAGE = (
    "This is something best handled by a person directly. Please reach out to HR at "
    "hr@company.example or use the confidential reporting form on the HR portal.\n\n"
    "Hal ini sebaiknya ditangani langsung oleh staf HR. Silakan hubungi HR di "
    "hr@company.example atau gunakan formulir pelaporan rahasia di portal HR."
)

NO_ANSWER_MESSAGE = (
    "I don't have enough information to answer that. Please contact HR directly.\n\n"
    "Maaf, saya tidak memiliki informasi yang cukup untuk menjawab hal itu. Silakan hubungi HR secara langsung."
)

# 2. Local Vector Store & Embeddings Ingestion
print("Initializing Hugging Face embeddings model...")
embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
vector_store = None

def load_and_split_documents(knowledge_dir: str) -> list[Document]:
    if not os.path.exists(knowledge_dir):
        raise FileNotFoundError(f"Knowledge directory not found at {knowledge_dir}")
        
    documents = []
    files = [f for f in os.listdir(knowledge_dir) if f.endswith(".md")]
    for file in files:
        file_path = os.path.join(knowledge_dir, file)
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            documents.append(Document(page_content=content, metadata={"source": file}))
            
    # Split using paragraph/character split rules
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    return text_splitter.split_documents(documents)

# Lifespan manager to handle db connection & ingestion
@asynccontextmanager
async def lifespan(app: FastAPI):
    global vector_store
    
    # Startup: Connect to DB
    print("Connecting to database...")
    try:
        await db.connect()
        print("Database connected successfully.")
    except Exception as e:
        print(f"Warning: Database connection failed (make sure Docker/Postgres is running): {e}")

    # Startup: Ingest knowledge base
    print("Ingesting company handbook...")
    try:
        chunks = load_and_split_documents(KNOWLEDGE_DIR)
        # Use MAX_INNER_PRODUCT distance strategy for exact Cosine Similarity with normalized vectors
        vector_store = FAISS.from_documents(chunks, embeddings, distance_strategy=DistanceStrategy.MAX_INNER_PRODUCT)
        print(f"Ingested {len(chunks)} passages from {KNOWLEDGE_DIR}")
    except Exception as e:
        print(f"Error during handbook ingestion: {e}")
        
    yield
    
    # Shutdown: Close DB pool
    print("Disconnecting from database...")
    await db.disconnect()

# 3. Create FastAPI Instance
app = FastAPI(title="ResBot RAG API", lifespan=lifespan)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # React Dev server port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper to format public user JSON
def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name"),
        "role": user["role"]
    }

# 4. Dependency: Require Auth (Cookie-based JWT)
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        
    payload = verify_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        
    # Check database for user existence
    # Note: If database is down during development, we can mock user if desired,
    # but here we require a valid DB user.
    try:
        user = await find_user_by_id(int(payload["sub"]))
    except Exception as e:
        print(f"Auth database lookup failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database error during auth")
        
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user

# 5. Pydantic Models for Input Validation
class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str | None = None

class LoginRequest(BaseModel):
    email: str
    password: str

class ChatRequest(BaseModel):
    question: str

# 6. Authentication Endpoints

@app.post("/api/auth/register")
async def register(request: RegisterRequest, response: Response):
    email = request.email.strip()
    password = request.password
    name = request.name.strip() if request.name else None
    
    if "@" not in email or len(password) < 8:
        raise HTTPException(status_code=400, detail="Valid email and 8+ char password required")
        
    try:
        existing = await find_user_by_email(email)
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
            
        hashed = hash_password(password)
        user = await create_user(email, hashed, name)
        
        # Set authentication cookie
        token = sign_token({"sub": str(user["id"]), "role": user["role"]})
        response.set_cookie(
            key="token",
            value=token,
            httponly=True,
            samesite="lax",
            secure=os.getenv("NODE_ENV") == "production",
            max_age=7 * 24 * 60 * 60  # 7 days
        )
        return public_user(user)
    except HTTPException:
        raise
    except Exception as e:
        print(f"Registration failed: {e}")
        raise HTTPException(status_code=500, detail="Registration failed due to server error")

@app.post("/api/auth/login")
async def login(request: LoginRequest, response: Response):
    email = request.email.strip()
    password = request.password
    
    try:
        user = await find_user_by_email(email)
        if not user or not verify_password(password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
            
        # Set auth cookie
        token = sign_token({"sub": str(user["id"]), "role": user["role"]})
        response.set_cookie(
            key="token",
            value=token,
            httponly=True,
            samesite="lax",
            secure=os.getenv("NODE_ENV") == "production",
            max_age=7 * 24 * 60 * 60  # 7 days
        )
        return public_user(user)
    except HTTPException:
        raise
    except Exception as e:
        print(f"Login failed: {e}")
        raise HTTPException(status_code=500, detail="Login failed due to server error")

@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("token", samesite="lax", httponly=True)
    return {"ok": True}

@app.get("/api/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return public_user(current_user)

# 6.5. Document Preview Endpoints

@app.get("/api/docs")
async def list_docs(user: dict = Depends(get_current_user)):
    try:
        files = [f for f in os.listdir(KNOWLEDGE_DIR) if f.endswith(".md")]
        return sorted(files)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list documents: {e}")

@app.get("/api/docs/{filename}")
async def get_doc(filename: str, user: dict = Depends(get_current_user)):
    # Security: Prevent directory traversal by cleaning filename
    safe_name = os.path.basename(filename)
    if safe_name != filename or not filename.endswith(".md"):
        raise HTTPException(status_code=400, detail="Invalid filename")
        
    file_path = os.path.join(KNOWLEDGE_DIR, safe_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document not found")
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"filename": safe_name, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read document: {e}")

# 7. RAG & Chat Pipeline Endpoints

async def persist_turn(user_id: int, question: str, answer: str, status: str, sources: list):
    """Persist conversation in background without delaying HTTP response."""
    try:
        await save_message(user_id, "user", question, None, [])
        await save_message(user_id, "bot", answer, status, sources)
    except Exception as e:
        print(f"Failed to persist chat turn to database: {e}")

@app.post("/api/chat")
async def chat(request: ChatRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")
        
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="question must be 2000 characters or fewer")
        
    # Guardrail Check (Regex matching sensitive topics)
    sensitive_patterns = [
        r"harass|bully|discriminat|pelecehan|perundungan|diskriminasi",
        r"lawsuit|sue|legal action|attorney|lawyer|tuntut|gugat|pengacara|somasi",
        r"fired|terminat|wrongful dismissal|laid off|dipecat|pemecatan|diberhentikan|\bphk\b",
        r"depress|suicid|self.?harm|mental health crisis|depresi|bunuh diri|melukai diri",
        r"assault|abuse|violence|kekerasan|penganiayaan|pelecehan seksual"
    ]
    
    is_sensitive = any(re.search(pat, question, re.IGNORECASE) for pat in sensitive_patterns)
    if is_sensitive:
        background_tasks.add_task(persist_turn, user["id"], question, ESCALATION_MESSAGE, "escalated", [])
        return {"answer": ESCALATION_MESSAGE, "sources": [], "status": "escalated"}
        
    # Search Vector Store
    if vector_store is None:
        raise HTTPException(status_code=500, detail="Vector store not initialized")
        
    # similarity_search_with_score returns (doc, similarity_score).
    # Since we use MAX_INNER_PRODUCT, score represents cosine similarity.
    hits = vector_store.similarity_search_with_score(question, k=TOP_K)
    
    valid_hits = [hit for hit in hits if hit[1] >= MIN_SCORE]
    
    if not valid_hits:
        background_tasks.add_task(persist_turn, user["id"], question, NO_ANSWER_MESSAGE, "no_answer", [])
        return {"answer": NO_ANSWER_MESSAGE, "sources": [], "status": "no_answer"}
        
    # Construct context string for LLM
    context_str = "\n\n".join([
        f"[{os.path.basename(doc.metadata['source'])}]\n{doc.page_content}"
        for doc, score in valid_hits
    ])
    
    sources = list(set([
        os.path.basename(doc.metadata['source'])
        for doc, score in valid_hits
    ]))
    
    # Invoke LLM via OpenRouter/Groq
    llm = ChatOpenAI(
        openai_api_base=LLM_BASE_URL,
        openai_api_key=OPENROUTER_API_KEY,
        model=CHAT_MODEL,
        temperature=0.0,
        max_tokens=512
    )
    
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "Context:\n{context}\n\nQuestion: {question}")
    ])
    
    chain = prompt_template | llm
    
    try:
        response = await chain.ainvoke({"context": context_str, "question": question})
        answer = response.content
    except Exception as e:
        print(f"LLM generation failed: {e}")
        raise HTTPException(status_code=500, detail="LLM call failed")
        
    # Persist successfully generated turn in background
    background_tasks.add_task(persist_turn, user["id"], question, answer, "answered", sources)
    
    return {"answer": answer, "sources": sources, "status": "answered"}
