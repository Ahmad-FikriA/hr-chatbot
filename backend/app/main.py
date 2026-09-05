import os
import re
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Clean up NO_PROXY if it contains IPv6 tokens that crash httpx url parsing
for _k in ["NO_PROXY", "no_proxy"]:
    if _k in os.environ:
        os.environ[_k] = ",".join([_p for _p in os.environ[_k].split(",") if not _p.strip().startswith(":")])

# Load env variables from the root .env file
dotenv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv(dotenv_path)

from fastapi import FastAPI, HTTPException, status, Depends, Request, Response, BackgroundTasks, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import tempfile
import shutil

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
from app.loaders import load_all_documents, load_single_document, get_preview_text, extract_equipment_context, SUPPORTED_EXTENSIONS

# 1. Configuration & Directories
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
CHAT_MODEL = os.getenv("CHAT_MODEL", "llama-3.3-70b-versatile")
LLM_API_KEY = os.getenv("GROQ_API_KEY") or os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY") or ""

DEFAULT_KNOWLEDGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "knowledge"))
KNOWLEDGE_DIR = os.getenv("KNOWLEDGE_DIR", DEFAULT_KNOWLEDGE_DIR)
MIN_SCORE = 0.20
TOP_K = int(os.getenv("TOP_K", "8"))

# Model prompts
SYSTEM_PROMPT = """You are a helpful HR assistant for a company's internal knowledge base.
Your job is to answer employee questions about company policies, benefits, leave entitlements, remote work rules, and any data or documents provided (including spreadsheets, datasets, and CSVs).
Answer using the information found in the provided context. When asked to summarize, list, or analyze data from uploaded files (such as employee details, positions, departments, or metrics), provide complete and structured answers based on all records present in the context.
Reply in the SAME language as the user's question (English or Bahasa Indonesia).
If the context contains both languages, prioritise the one the user used.
If the answer is completely absent from the context, clearly state you don't have that information and suggest contacting HR.
When citing information, mention the document or dataset name (e.g. "Leave Policy", "Benefits").
Be friendly, organized, and concise. Do not output internal reasoning steps.

Context:
{context}"""

ESCALATION_MESSAGE = (
    "This is a sensitive topic best handled directly by an HR team member. Please reach out to HR or your direct manager for personal guidance.\n\n"
    "Ini adalah topik yang sebaiknya ditangani langsung oleh tim HR. Silakan hubungi HR atau manajer langsung Anda untuk panduan lebih lanjut."
)

NO_ANSWER_MESSAGE = (
    "I couldn't find an answer to that in the company knowledge base or any uploaded documents. Please contact HR directly or check the official company handbook.\n\n"
    "Saya tidak menemukan jawaban atas hal tersebut di basis pengetahuan perusahaan atau dokumen yang diunggah. Silakan hubungi HR secara langsung atau periksa panduan perusahaan resmi."
)


def scrub_reasoning_traces(raw: str) -> str:
    """Strip chain-of-thought reasoning that some LLMs leak into their output.

    Handles the following patterns seen across common reasoning-capable models:

    1. XML-style tags:   <think>…</think>  (DeepSeek-R1, Qwen3, etc.)
    2. Arrow separator:  ⟹ … (some OpenRouter models write thinking before ⟹)
    3. Numbered / bulleted step headers the model uses for its thinking process,
       e.g. " Analyze User Input:", " Identify the Core Task:", etc.
    4. Delimiter words before the real answer:
       "Draft:", "Final answer:", "Response:", "Answer:"
    5. Leading/trailing quotation marks left after splitting.
    """
    text = raw

    # 1. Strip <think>…</think> blocks (including nested newlines)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)

    # 2. Arrow separator — keep only the part after the last ⟹
    if "⟹" in text:
        text = text.split("⟹")[-1]

    # 3. Numbered/bulleted reasoning step headers followed by body text.
    #    Pattern: optional whitespace + emoji/bullet/number + known heading word + colon
    #    These appear at the START of lines; strip entire lines that look like reasoning headers.
    REASONING_STEP_PATTERN = re.compile(
        r"^[\s\u200b]*(?:\d+\.|\*|-|[✅▶️📌🔍➡️⚠️])?[\s]*"
        r"(?:Analyze|Identify|Scan|Formulate|Formulating|Draft|Check|Let'?s?\s+draft|"
        r"Thinking|Thought|Step\s+\d+|Chain.of.thought|Note|Summary|Plan|Review|"
        r"Core Task|User Input|Context|Constraints|All good)[^\n]*",
        re.IGNORECASE | re.MULTILINE,
    )
    # Only apply if the text looks like it contains a reasoning trace
    if REASONING_STEP_PATTERN.search(text):
        text = REASONING_STEP_PATTERN.sub("", text)

    # 4. Delimiter words — keep only the part after the last occurrence
    for delimiter in ("Final answer:", "Final Answer:", "Response:", "Answer:", "Draft:"):
        if delimiter in text:
            text = text.split(delimiter)[-1]

    # 5. Clean up artefacts: stray triple-backtick fences, excess blank lines, quotes
    text = re.sub(r"```[a-z]*\n?", "", text)       # leftover code-fence markers
    text = re.sub(r"\n{3,}", "\n\n", text)          # collapse runs of blank lines
    text = text.strip().strip('"').strip("'").strip()

    return text



print("Initializing Hugging Face embeddings model...")
embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
vector_store = None

# Per-user upload state (in-memory, cleared on restart)
# Key: user_id (int) -> FAISS vector store for that user's uploads
user_vector_stores: dict[int, object] = {}

# Temp directory for storing uploaded files (cleared on restart)
UPLOAD_BASE_DIR = os.path.join(tempfile.gettempdir(), "hr-chatbot-uploads")
os.makedirs(UPLOAD_BASE_DIR, exist_ok=True)

# Allowed upload extensions (text-extractable types)
UPLOAD_ALLOWED_EXTENSIONS = {".md", ".pdf", ".xlsx", ".csv", ".pptx"}
MAX_UPLOAD_SIZE_MB = 20

def load_and_split_documents(knowledge_dir: str) -> list[Document]:
    if not os.path.exists(knowledge_dir):
        raise FileNotFoundError(f"Knowledge directory not found at {knowledge_dir}")
        
    print(f"Loading documents from {knowledge_dir}...")
    documents = load_all_documents(knowledge_dir)
    print(f"Loaded {len(documents)} raw document sections.")
        
    # Separate tabular documents (which are already structured by row batches) from text/markdown/pdf
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=200)
    raw_chunks = []
    for doc in documents:
        ftype = doc.metadata.get("file_type", "")
        if ftype in ("csv", "xlsx", "xls"):
            raw_chunks.append(doc)
        else:
            raw_chunks.extend(text_splitter.split_documents([doc]))
    
    # Context-enrich each chunk with document & equipment tags
    enriched_chunks = []
    for chunk in raw_chunks:
        fname = chunk.metadata.get("filename") or os.path.basename(chunk.metadata.get("source", ""))
        equip = chunk.metadata.get("equipment", "")
        header = f"[{fname}" + (f" | {equip}" if equip else "") + "]\n"
        if not chunk.page_content.startswith("["):
            chunk.page_content = header + chunk.page_content
        enriched_chunks.append(chunk)
        
    return enriched_chunks

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

# 6.5. Document Preview & Raw File Serving Endpoints

def resolve_safe_knowledge_path(filepath: str) -> str:
    """Resolve and validate that a requested filepath is inside KNOWLEDGE_DIR."""
    # Strip leading slashes to prevent absolute path escapes
    clean_path = filepath.lstrip("/\\")
    full_path = os.path.abspath(os.path.join(KNOWLEDGE_DIR, clean_path))
    # Append os.sep to the prefix so e.g. /knowledge2/... can't pass the check
    safe_root = os.path.abspath(KNOWLEDGE_DIR) + os.sep
    if not full_path.startswith(safe_root) and full_path != os.path.abspath(KNOWLEDGE_DIR):
        raise HTTPException(status_code=400, detail="Invalid document path")
    return full_path

@app.get("/api/docs")
async def list_docs(user: dict = Depends(get_current_user)):
    try:
        if not os.path.exists(KNOWLEDGE_DIR):
            return []

        doc_items = []
        for root, _, files in os.walk(KNOWLEDGE_DIR):
            for f in sorted(files):
                if f.startswith(".") or f.startswith("~$"):
                    continue
                ext = os.path.splitext(f)[1].lower()
                if ext in SUPPORTED_EXTENSIONS:
                    abs_p = os.path.join(root, f)
                    rel_p = os.path.relpath(abs_p, KNOWLEDGE_DIR)
                    equipment = extract_equipment_context(rel_p) or "General Documents"
                    doc_items.append({
                        "filename": rel_p,
                        "name": f,
                        "file_type": ext.lstrip("."),
                        "equipment": equipment
                    })
        return doc_items
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list documents: {e}")

@app.get("/api/docs/{filepath:path}")
async def get_doc(filepath: str, user: dict = Depends(get_current_user)):
    """Return preview text and metadata for a document.

    Resolves from the global knowledge base first; falls back to the
    current user's personal upload directory.
    """
    # 1. Try knowledge base
    full_path: str | None = None
    try:
        candidate = resolve_safe_knowledge_path(filepath)
        if os.path.exists(candidate):
            full_path = candidate
    except HTTPException:
        pass

    # 2. Fall back to user uploads
    if full_path is None:
        user_id = int(user["id"])
        user_dir = get_user_upload_dir(user_id)
        safe_name = os.path.basename(filepath)
        upload_candidate = os.path.join(user_dir, safe_name)
        if os.path.exists(upload_candidate):
            full_path = upload_candidate

    if full_path is None:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        preview = get_preview_text(full_path, filepath)
        ext = os.path.splitext(full_path)[1].lower().lstrip(".")
        total_pages = 1
        if ext == "pdf":
            try:
                import pymupdf as fitz
                doc_fitz = fitz.open(full_path)
                total_pages = len(doc_fitz)
                doc_fitz.close()
            except Exception:
                total_pages = 1

        return {
            "filename": filepath,
            "name": os.path.basename(full_path),
            "file_type": ext,
            "total_pages": total_pages,
            "content": preview,
            "equipment": extract_equipment_context(filepath) or "General"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read document preview: {e}")

@app.get("/api/pdf-page/{filepath:path}")
async def get_pdf_page(filepath: str, page: int = 1, dpi: int = 150, user: dict = Depends(get_current_user)):
    """Render and stream a specific page of a PDF as a high-resolution PNG image.

    Resolves the file from the global knowledge base first; if not found there,
    falls back to the current user's personal upload directory.
    """
    if not filepath.lower().endswith(".pdf"):
        raise HTTPException(status_code=404, detail="PDF not found")

    # 1. Try the global knowledge base
    full_path: str | None = None
    try:
        candidate = resolve_safe_knowledge_path(filepath)
        if os.path.exists(candidate):
            full_path = candidate
    except HTTPException:
        pass

    # 2. Fall back to the user's personal upload directory
    if full_path is None:
        user_id = int(user["id"])
        user_dir = get_user_upload_dir(user_id)
        safe_name = os.path.basename(filepath)  # prevent path traversal
        upload_candidate = os.path.join(user_dir, safe_name)
        if os.path.exists(upload_candidate):
            full_path = upload_candidate

    if full_path is None:
        raise HTTPException(status_code=404, detail="PDF not found")

    try:
        import pymupdf as fitz
        doc = fitz.open(full_path)
        page_idx = max(0, min(page - 1, len(doc) - 1))
        pdf_page = doc[page_idx]
        pix = pdf_page.get_pixmap(dpi=min(dpi, 300))
        img_bytes = pix.tobytes("png")
        doc.close()
        return Response(content=img_bytes, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF page: {e}")

@app.get("/api/files/{filepath:path}")
async def get_raw_file(filepath: str, user: dict = Depends(get_current_user)):
    """Serve raw file for inline images or direct downloads.

    Resolves from the global knowledge base first; falls back to the
    current user's personal upload directory.
    """
    # 1. Try knowledge base
    full_path: str | None = None
    try:
        candidate = resolve_safe_knowledge_path(filepath)
        if os.path.exists(candidate):
            full_path = candidate
    except HTTPException:
        pass

    # 2. Fall back to user uploads
    if full_path is None:
        user_id = int(user["id"])
        user_dir = get_user_upload_dir(user_id)
        safe_name = os.path.basename(filepath)
        upload_candidate = os.path.join(user_dir, safe_name)
        if os.path.exists(upload_candidate):
            full_path = upload_candidate

    if full_path is None:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(full_path)


# 6.6. User Upload Endpoints

def get_user_upload_dir(user_id: int) -> str:
    """Return (and create) a per-user temp directory for uploaded files."""
    user_dir = os.path.join(UPLOAD_BASE_DIR, str(user_id))
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Accept a user-uploaded document, parse it, and add it to that user's personal vector store."""
    global user_vector_stores

    filename = file.filename or "upload"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in UPLOAD_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(UPLOAD_ALLOWED_EXTENSIONS))}"
        )

    # Read & size-check
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE_MB} MB.")

    user_id = int(user["id"])
    user_dir = get_user_upload_dir(user_id)
    save_path = os.path.join(user_dir, filename)

    # Write file to temp dir
    with open(save_path, "wb") as f:
        f.write(content)

    # Parse + chunk
    try:
        raw_docs = load_single_document(save_path, filename)
    except Exception as e:
        os.remove(save_path)
        raise HTTPException(status_code=422, detail=f"Failed to parse uploaded file: {e}")

    # Tabular datasets (CSV, Excel) are pre-batched into structured row chunks
    if ext in (".csv", ".xlsx", ".xls"):
        chunks = raw_docs
    else:
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=200)
        chunks = text_splitter.split_documents(raw_docs)

    # Enrich chunks with upload tag
    for chunk in chunks:
        fname = chunk.metadata.get("filename") or filename
        if not chunk.page_content.startswith("["):
            chunk.page_content = f"[{fname} | Uploaded by user]\n" + chunk.page_content

    if not chunks:
        os.remove(save_path)
        raise HTTPException(status_code=422, detail="No extractable text found in uploaded file.")

    # Add to (or create) this user's personal vector store
    if user_id in user_vector_stores:
        user_vector_stores[user_id].add_documents(chunks)
    else:
        user_vector_stores[user_id] = FAISS.from_documents(
            chunks, embeddings, distance_strategy=DistanceStrategy.MAX_INNER_PRODUCT
        )

    print(f"User {user_id} uploaded '{filename}' — {len(chunks)} chunks indexed.")
    return {
        "filename": filename,
        "file_type": ext.lstrip("."),
        "chunk_count": len(chunks),
        "size_bytes": len(content),
    }


@app.get("/api/upload")
async def list_uploaded_docs(user: dict = Depends(get_current_user)):
    """List all files the current user has uploaded in this session."""
    user_id = int(user["id"])
    user_dir = get_user_upload_dir(user_id)

    items = []
    for fname in sorted(os.listdir(user_dir)):
        if fname.startswith("."):
            continue
        ext = os.path.splitext(fname)[1].lower().lstrip(".")
        fpath = os.path.join(user_dir, fname)
        items.append({
            "filename": fname,
            "name": fname,
            "file_type": ext,
            "equipment": "My Uploads",
            "size_bytes": os.path.getsize(fpath),
        })
    return items


@app.delete("/api/upload/{filename}")
async def delete_uploaded_doc(filename: str, user: dict = Depends(get_current_user)):
    """Remove an uploaded file and rebuild that user's personal vector store without it."""
    global user_vector_stores

    user_id = int(user["id"])
    user_dir = get_user_upload_dir(user_id)

    # Safety: prevent path traversal
    safe_name = os.path.basename(filename)
    file_path = os.path.join(user_dir, safe_name)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Uploaded file not found")

    os.remove(file_path)

    # Rebuild user's vector store from remaining files
    remaining = [
        f for f in os.listdir(user_dir)
        if not f.startswith(".") and os.path.splitext(f)[1].lower() in UPLOAD_ALLOWED_EXTENSIONS
    ]

    if remaining:
        all_chunks: list = []
        splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=200)
        for fname in remaining:
            try:
                docs = load_single_document(os.path.join(user_dir, fname), fname)
                raw_chunks = splitter.split_documents(docs)
                for chunk in raw_chunks:
                    if not chunk.page_content.startswith("["):
                        chunk.page_content = f"[{fname} | Uploaded by user]\n" + chunk.page_content
                all_chunks.extend(raw_chunks)
            except Exception as e:
                print(f"Warning: could not reload {fname} for user {user_id}: {e}")
        if all_chunks:
            user_vector_stores[user_id] = FAISS.from_documents(
                all_chunks, embeddings, distance_strategy=DistanceStrategy.MAX_INNER_PRODUCT
            )
        else:
            user_vector_stores.pop(user_id, None)
    else:
        user_vector_stores.pop(user_id, None)

    return {"ok": True, "filename": safe_name}

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

    user_id = int(user["id"])

    # Search global knowledge base
    global_hits = vector_store.similarity_search_with_score(question, k=TOP_K)

    # Search user's personal upload store (if they have one)
    user_hits = []
    if user_id in user_vector_stores:
        try:
            user_hits = user_vector_stores[user_id].similarity_search_with_score(question, k=TOP_K)
        except Exception as e:
            print(f"User vector store search failed for user {user_id}: {e}")

    # Merge hits: user uploads first (higher priority), then global — deduplicate by text content
    all_hits = user_hits + global_hits
    seen_contents: set[str] = set()
    merged_hits = []
    for doc, score in all_hits:
        content_key = doc.page_content.strip()
        if content_key not in seen_contents:
            seen_contents.add(content_key)
            merged_hits.append((doc, score))

    valid_hits = [hit for hit in merged_hits if hit[1] >= MIN_SCORE]

    if not valid_hits:
        background_tasks.add_task(persist_turn, user["id"], question, NO_ANSWER_MESSAGE, "no_answer", [])
        return {"answer": NO_ANSWER_MESSAGE, "sources": [], "status": "no_answer"}
        
    # Construct context string for LLM
    context_str = "\n\n".join([
        f"[{doc.metadata.get('source', 'document')}]\n{doc.page_content}"
        for doc, score in valid_hits
    ])
    
    # Extract unique source paths in order of occurrence
    sources = list(dict.fromkeys([
        doc.metadata.get("source", "document")
        for doc, score in valid_hits
    ]))
    
    # Invoke LLM via OpenRouter/Groq
    llm = ChatOpenAI(
        openai_api_base=LLM_BASE_URL,
        openai_api_key=LLM_API_KEY,
        model=CHAT_MODEL,
        temperature=0.0,
        max_tokens=768
    )
    
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "Context:\n{context}\n\nQuestion: {question}")
    ])
    
    chain = prompt_template | llm
    
    try:
        response = await chain.ainvoke({"context": context_str, "question": question})
        raw_answer = response.content
        if isinstance(raw_answer, list):
            raw_answer = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in raw_answer])
        
        # Scrub reasoning traces that some models leak into their output
        answer = scrub_reasoning_traces(str(raw_answer))
    except Exception as e:
        print(f"LLM generation failed: {e}")
        raise HTTPException(status_code=500, detail="LLM call failed")
        
    # Persist successfully generated turn in background
    background_tasks.add_task(persist_turn, user["id"], question, answer, "answered", sources)
    
    return {"answer": answer, "sources": sources, "status": "answered"}

