# ResBot — Bilingual AI HR Assistant 🇮🇩 🇬🇧

ResBot (Resource Bot) is an AI-powered HR assistant that answers employee questions from a company knowledge base using **RAG (Retrieval-Augmented Generation)**. It speaks both **English and Bahasa Indonesia**, cites its sources, refuses to guess on sensitive topics (routing those to a human instead), and features a 3-pane responsive layout for browsing and previewing knowledge base files in real-time.

Built as a learning project to understand how production AI assistants actually work — embeddings, vector search, database-backed logging, JWT session authentication, multi-format document ingestion, and safety guardrails — end to end.

## Screenshots

The welcome screen, featuring a collapsible **Handbook Files** sidebar and bilingual suggested questions:

![ResBot welcome screen](docs/screenshot.png)

Answering with clickable source citations — which automatically open the policy document preview drawer on the right side of the screen:

![ResBot answering questions with source citations](docs/screenshot2.png)

---

## What it does

- **Answers from a real knowledge base.** HR policies live in markdown (and PDFs, spreadsheets, and more); ResBot retrieves the relevant passages and answers from them — no made-up policies.
- **Bilingual.** Ask in English or Indonesian; it detects the language, retrieves from the matching bilingual content, and replies in kind.
- **Multi-format document support.** The knowledge base supports `.md`, `.pdf`, `.xlsx`, `.pptx`, and image files (`.png`, `.jpg`). PDFs render page-by-page in a visual preview.
- **User file uploads.** Employees can upload their own documents (`.md`, `.pdf`, `.xlsx`, `.pptx`) to create a personal, session-scoped knowledge store that blends into their chat answers.
- **Collapsible Handbook & Preview Panel.** Browse policy documents in the left sidebar, or click on a source citation in a chat bubble to slide open a formatted document preview on the right.
- **Cites its sources.** Every answer shows which handbook document it came from, with clickable chips to open the preview.
- **Guardrails for sensitive topics.** Questions about harassment, legal action, termination, or mental health are *escalated to a human* — the bot never improvises on those.
- **Honest about gaps.** If nothing relevant is found above the similarity threshold, it says so (and doesn't call the LLM).
- **Audit logging in Postgres.** User registration, secure login, and every chat interaction are logged in a PostgreSQL database — with an automatic in-memory fallback for local development without Docker.

## How it works — the RAG pipeline

```
  Browser (React)                FastAPI Backend                 Database & Models
 ┌──────────────┐    POST     ┌─────────────────────┐      ┌──────────────────────────┐
 │   Chat UI    │──/api/chat─▶│  Guardrails (gate)  │      │ PostgreSQL (asyncpg)     │
 │ (3-pane with │             │  ┌───────────────┐  │ ───▶ │ User & Chat logs         │
 │  sidebar +   │             │  │  RAG pipeline │  │      │ (in-memory fallback)     │
 │   drawer)    │             │  └───────────────┘  │ ───▶ ├──────────────────────────┤
 │              │ POST /upload│  JWT Cookie Auth    │      │ HuggingFace Embeddings   │
 │  + Upload    │────────────▶│  User Vector Store  │      │ Local Vector Store (FAISS│
 └──────────────┘             └─────────────────────┘      ├──────────────────────────┤
                                         ▲                 │ OpenRouter / Groq API    │
                                         │                 │ LLM chat (e.g. Llama 3)  │
                             Bilingual HR knowledge base   └──────────────────────────┘
                       (.md, .pdf, .xlsx, .pptx, images)
```

1. **Ingest** (on startup): knowledge base documents are loaded by `loaders.py` (supporting `.md`, `.pdf`, `.xlsx`, `.pptx`, images), split into chunks, embedded into 384-dimensional vectors using local Hugging Face model `paraphrase-multilingual-MiniLM-L12-v2`, and loaded into an in-memory **FAISS** index.
2. **Authenticate:** cookies are validated via JWT cookie dependency extraction.
3. **Guard:** sensitive questions are intercepted and flagged for escalation.
4. **Retrieve:** the question is embedded and compared against both the global FAISS index and the user's personal upload index using cosine similarity. User uploads are prioritized. If the best match score is below the minimum threshold (`0.25`), the bot declines to answer.
5. **Generate:** the retrieved passages + the question are sent to the LLM (OpenRouter / Groq) with strict instructions to answer *only* from that context and in the user's language.
6. **Log:** every chat interaction is persisted asynchronously to PostgreSQL via a background task (or in-memory if the database is unavailable).

## Tech stack

| Layer | Choice |
|-------|--------|
| **Frontend** | React 19 + TypeScript + Vite + Vanilla CSS |
| **Backend** | Python 3.12+ + FastAPI + Uvicorn |
| **Database** | PostgreSQL (managed via Docker/OrbStack) + `asyncpg` (with in-memory fallback) |
| **Embeddings** | `sentence-transformers` — `paraphrase-multilingual-MiniLM-L12-v2`, runs locally |
| **Vector store** | FAISS index (via LangChain Community) using Cosine Similarity |
| **LLM** | OpenAI-compatible API via LangChain (OpenRouter / Groq), provider-agnostic |
| **Document parsing** | PyMuPDF (`fitz`) for PDFs, `openpyxl` for spreadsheets, `python-pptx` for presentations |

## Getting started

### Prerequisites
*   Node.js 20+
*   Python 3.12+ (managed easily using the `uv` tool)
*   Docker (e.g., OrbStack or Docker Desktop) running locally — or skip it and use the in-memory fallback
*   A free API key from [OpenRouter](https://openrouter.ai/keys) or [Groq](https://console.groq.com/keys)

### Setup Steps

```bash
# 1. Start the PostgreSQL database (optional — app runs with in-memory fallback without it)
docker compose up -d

# 2. Configure environment variables
cp .env.example .env
# Edit .env and paste your API keys and configuration, e.g.:
# LLM_BASE_URL=https://api.groq.com/openai/v1
# GROQ_API_KEY=your_key_here
# CHAT_MODEL=llama-3.3-70b-versatile

# 3. Setup and run Python Backend
cd backend
uv sync                     # Install backend python dependencies
uv run python migrate.py   # Run database migrations to create tables
uv run python main.py      # Start FastAPI backend → http://localhost:3000

# 4. Setup and run React Frontend (in a new terminal tab at root directory)
npm install
npm run dev                # Start Vite dev server → http://localhost:5173
```

Open **http://localhost:5173**, click **Register** to create an account, log in, and start chatting!

Try asking: *"Berapa hari cuti tahunan saya?"* or click on the suggested chips. Test a guardrail by asking *"Can you help me sue my manager?"* to see human routing in action. Try uploading a PDF or spreadsheet using the upload button in the sidebar!

## Project structure

```
backend/
├── app/
│   ├── main.py        # FastAPI endpoints, RAG chain, upload & document preview routes
│   ├── auth.py        # Password hashing (bcrypt) & JWT token helpers
│   ├── db.py          # PostgreSQL connection pool, DB ops & in-memory fallback
│   └── loaders.py     # Multi-format document loaders (md, pdf, xlsx, pptx, images)
├── db/
│   └── schema.sql     # Database schema (users & chat history)
├── knowledge/         # Bilingual HR handbook policy files (markdown + other formats)
├── tests/
│   └── test_main.py   # Pytest suite for offline API & guardrail verification
├── main.py            # Uvicorn entry point
└── migrate.py         # Database migrations execution runner
src/
├── auth/
│   └── AuthContext.tsx  # Context provider for auth registration, login, and session checks
├── api/
│   └── client.ts        # Client functions for chat, auth, document & upload requests
├── components/
│   ├── ChatMessage.tsx  # Message item renderer with clickable source chips
│   └── MarkdownView.tsx # Formatted markdown + PDF page preview renderer
├── pages/
│   ├── Chat.tsx         # 3-pane main chatbot, sidebar (with upload), and preview layout
│   ├── Login.tsx        # Sign in page
│   └── Register.tsx     # Sign up page
├── App.css              # Styles for chat layout, transitions, and document preview
└── App.tsx              # Main authentication gate routing
```

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register a new user account |
| `POST` | `/api/auth/login` | Log in and receive a session cookie |
| `POST` | `/api/auth/logout` | Clear the session cookie |
| `GET` | `/api/auth/me` | Get the currently authenticated user |
| `GET` | `/api/docs` | List all knowledge base documents |
| `GET` | `/api/docs/{filepath}` | Get document preview text & metadata |
| `GET` | `/api/pdf-page/{filepath}` | Render a specific PDF page as a PNG image |
| `GET` | `/api/files/{filepath}` | Serve raw file (inline images, downloads) |
| `POST` | `/api/upload` | Upload a personal document (`.md`, `.pdf`, `.xlsx`, `.pptx`) |
| `GET` | `/api/upload` | List the current user's uploaded documents |
| `DELETE` | `/api/upload/{filename}` | Remove an uploaded document |
| `POST` | `/api/chat` | Send a question and receive a RAG-powered answer |

## Safety & design notes

- **Secure Session Cookie:** Authentication tokens are stored inside HTTP-Only, SameSite-Lax cookies. The token never leaks to client JavaScript.
- **Vector search strategy:** By normalizing embeddings and configuring FAISS with `DistanceStrategy.MAX_INNER_PRODUCT`, we perform exact cosine similarity checks to enforce a reliable similarity threshold (`0.25`).
- **Per-user upload isolation:** Each user's uploaded documents are indexed in a separate FAISS vector store, kept entirely in memory for the session. User uploads are searched first and merged with global results, giving personal context higher priority.
- **Path traversal protection:** All document and upload endpoints resolve and validate paths against their respective root directories before serving files.
- **In-memory DB fallback:** If PostgreSQL is unavailable (e.g., Docker not running), the backend automatically switches to an ephemeral in-memory store — useful for quick demos without infrastructure.
- **Reasoning model output scrubbing:** Some LLMs leak their chain-of-thought into the response (XML `<think>` tags, `⟹` arrow separators, numbered step headers, etc.). The `scrub_reasoning_traces()` function strips all known patterns before the answer is returned to the client.
- **Offline testing:** Our pytest suite overrides the LLM dependency, allowing full API testing, guardrail verifications, and Indonesian/English prompt checks offline.

## Roadmap

- [x] JWT Login to demonstrate authentication and user-specific message histories
- [x] Real vector database integration (FAISS) to replace custom JS array loops
- [x] Multi-format document support (PDF, XLSX, PPTX, images) in the knowledge base
- [x] Per-user document upload with personal vector store and session isolation
- [x] PDF page-by-page visual rendering in the document preview drawer
- [x] Reasoning model output scrubbing (`<think>` tags, `⟹` separators, step headers)
- [ ] Add chat session histories list in the sidebar (multi-session chats)
- [ ] Deploying with HTTPS / Production server setup (Gunicorn + Uvicorn)

## Deploying as a Demo

### ❌ Why Vercel alone doesn't work for the backend

Vercel runs **serverless functions** — short-lived, stateless, with no persistent memory. This project's backend is incompatible with that model because:

| Requirement | Problem on Vercel |
|---|---|
| FAISS vector store | Built in-memory at startup. Rebuilt from scratch on every cold start (very slow). |
| HuggingFace embedding model | ~90MB model loaded at startup. Hits memory/timeout limits on serverless. |
| Uvicorn long-running process | Vercel functions time out at 10–60s; unsuitable for a persistent ASGI server. |

### ✅ Recommended free-tier stack

```
┌───────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  Vercel  (Free)   │────▶│  Railway / Render (Free) │────▶│  Neon (Free)    │
│  React frontend   │     │  FastAPI + FAISS backend  │     │  PostgreSQL DB  │
└───────────────────┘     └──────────────────────────┘     └─────────────────┘
```

- **Frontend → [Vercel](https://vercel.com):** `npm run build` output, set `VITE_API_URL` env var to your backend URL.
- **Backend → [Railway](https://railway.app) or [Render](https://render.com):** supports persistent Python processes, auto-detects `pyproject.toml`, free hobby tier.
- **Database → [Neon](https://neon.tech):** free serverless PostgreSQL, drop-in replacement — just update `DATABASE_URL`.

### 🔑 LLM API key limits

For a demo, **Groq** is the recommended provider:

| | Groq (Free) | OpenRouter (Free models) |
|---|---|---|
| Daily request limit | 14,400 req/day | ~20 req/min per model |
| Speed | Very fast (LPU hardware) | Slower, varies |
| Reliability | High | Free models can be pulled without notice |

### What to change before going live

1. **CORS:** Change `allow_origins` in `main.py` from `["http://localhost:5173"]` to your deployed frontend URL (or read it from an env var).
2. **Secure cookie:** The `secure=` flag on `set_cookie` should be `True` in production (currently tied to `NODE_ENV == "production"` — set that env var on Railway/Render).
3. **`DATABASE_URL`:** Point to Neon or Railway Postgres instead of `localhost:5433`.
4. **Frontend API URL:** In production the Vite proxy isn't active — the frontend must call the backend's deployed URL directly (set via `VITE_API_URL` and read in `client.ts`).

