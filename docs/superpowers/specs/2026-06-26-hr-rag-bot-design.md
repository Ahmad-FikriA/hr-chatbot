# HR Platform + AI HR Bot — Design (Umbrella Spec)

**Date:** 2026-06-26
**Status:** Approved direction; Milestone 1 to be detailed in its own plan.

## 1. Purpose

Build a functional **HR Platform + AI-powered HR Bot MVP** matching the responsibilities in the
"CX Engineer Intern" job description: backend auth, REST APIs, a chat UI with login, a chatbot
wired to an HR knowledge base, guardrails for sensitive topics, logging, and documentation.

**Primary goal:** *learning + portfolio.* The bot answers HR questions using **RAG** (Retrieval-
Augmented Generation). Favor clarity and understanding over production polish; build incrementally.

## 2. Working split (who builds what)

The user is learning the **AI side** hands-on; Claude builds the frontend.

| Area | Built by | Mode |
|------|----------|------|
| RAG pipeline, prompting, guardrails (the "AI brain") | **User** | Claude **guides** — explains the concept, hands over the piece, reviews the user's code. Not a black box. |
| Frontend (login page, chat UI, styling) | **Claude** | Claude builds it. |
| Backend auth/plumbing | **Claude** scaffolds, well-commented | User reads to learn; Claude implements. |

## 3. Architecture

```
  Browser (React)              Express backend                Models
 ┌──────────────┐    POST     ┌─────────────────────┐      ┌────────────────────┐
 │  Login page  │──/api/auth─▶│  Auth (JWT)         │      │ OpenRouter (chat)  │
 │  Chat UI     │──/api/chat─▶│  ┌───────────────┐  │ ───▶ │ free model         │
 │  (Claude)    │             │  │  RAG pipeline │  │      ├────────────────────┤
 └──────────────┘             │  │  (User)       │  │ ───▶ │ transformers.js    │
                              │  └───────────────┘  │      │ local embeddings   │
                              │  Guardrails + logs  │      └────────────────────┘
                              └─────────────────────┘
                                        ▲
                              HR policy docs (.md files)
```

### The RAG pipeline (four steps — the core learning)

1. **Ingest** (once at startup): split HR docs into chunks → `embed()` each → store the vectors in memory.
2. **Retrieve** (per question): `embed()` the question → cosine-similarity vs stored vectors → top-k chunks.
3. **Augment**: build a prompt = system instructions + retrieved chunks + user question.
4. **Generate**: send to an OpenRouter chat model → return the grounded answer.

### Key decisions

- **Vector store:** in-memory (a JS array + a hand-written cosine-similarity function). No vector DB —
  for learning, every step stays visible and there's zero infra. Can graduate to a real vector DB later.
- **Embeddings:** local `transformers.js` (e.g. `all-MiniLM-L6-v2`) — $0, no key, and the user writes the
  embed call. Hidden behind one `embed()` function so OpenRouter embeddings are a one-line swap.
- **Generation:** OpenRouter **free** chat model (e.g. Llama 3.3 70B / DeepSeek), via the user's key.
  Wrapped in a small client so the model id is a single config value.
- **RAG steps are separate files** (ingest / embed / retrieve / generate / vectorStore) so each is
  independently understandable and testable — the teaching boundary *is* the file boundary.

## 4. Cost note

- Generation: **$0** on OpenRouter free models (rate-limited ~50 req/day, 1,000/day after a one-time $10 top-up).
- Embeddings: **$0** locally via transformers.js. (OpenRouter embeddings are cheap pay-as-you-go if swapped in.)

## 5. Build order (milestones)

Each milestone has an **executor** — this overrides the default "Claude implements everything" assumption
of the planning flow.

| # | Milestone | Executor | Notes |
|---|-----------|----------|-------|
| 0 | **Foundation** — fix `package.json` comma bug, split `backend/` from frontend `src/`, env/config, confirm frontend↔backend health check | **Claude** | Tiny prereq |
| 1 | **RAG bot core** — docs → embed → retrieve → generate → `POST /api/chat`, tested via a script (no UI/auth yet) | **User builds, Claude guides** | The heart + main learning. Gets its own detailed plan: each step = *concept → what you write → how we verify* |
| 2 | **Guardrails & grounding** — system prompt, "I don't know" behavior, sensitive-topic escalation, Q/A logging | **User builds, Claude guides** | JD's "guardrails for sensitive topics" |
| 3 | **Auth (JWT)** — login endpoint, simple user store, protect `/api/chat` | **Claude** scaffolds + explains | User reads to learn |
| 4 | **Frontend** — login page + chat UI wired to the API | **Claude** | User's delegated half |
| 5 | **Polish** — README, demo flow, portfolio write-up | Together | Portfolio-ready |

**We detail and build Milestone 1 first** (its own plan). Milestones 2–5 get their own short spec when reached.

## 6. Folder structure (target)

```
hr-chatbot/
├── backend/
│   ├── server.js              # Express entry (expanded from src/server.js)   [M0, Claude]
│   ├── config.js              # env loading + constants (model ids, top-k)    [M0, Claude]
│   ├── routes/
│   │   ├── health.js          # GET /api/health                              [M0, Claude]
│   │   ├── chat.js            # POST /api/chat -> RAG pipeline                [M1, User]
│   │   └── auth.js            # POST /api/auth/login (JWT)                    [M3, Claude]
│   ├── rag/
│   │   ├── vectorStore.js     # in-memory store + cosineSimilarity()         [M1, User]
│   │   ├── embed.js           # embed(text) -> vector (transformers.js)      [M1, User]
│   │   ├── ingest.js          # load knowledge/*.md -> chunk -> embed -> store [M1, User]
│   │   ├── retrieve.js        # retrieve(question) -> top-k chunks           [M1, User]
│   │   ├── generate.js        # build prompt + call chat model -> answer     [M1, User]
│   │   └── guardrails.js      # sensitive-topic checks + system prompt       [M2, User]
│   ├── knowledge/             # the HR knowledge base (sample policy docs)
│   │   ├── leave-policy.md
│   │   ├── benefits.md
│   │   └── code-of-conduct.md
│   ├── lib/
│   │   └── openrouter.js      # OpenRouter chat client wrapper               [M0, Claude]
│   ├── middleware/
│   │   └── auth.js            # JWT verify middleware                        [M3, Claude]
│   └── logs/
│       └── .gitkeep           # chat Q/A logs written here                   [M2]
├── src/                       # React frontend                               [M4, Claude]
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/
│   │   ├── Login.tsx
│   │   └── Chat.tsx
│   ├── components/
│   │   └── ChatMessage.tsx
│   └── api/
│       └── client.ts          # fetch wrapper for /api/*
├── docs/superpowers/specs/    # design docs + plans
├── .env                       # OPENROUTER_API_KEY, JWT_SECRET, PORT
└── package.json
```

## 7. Out of scope (YAGNI for the MVP)

- Real vector database, multi-tenant orgs, admin dashboard, conversation memory across sessions,
  SSO, real user database (a small in-memory/JSON user store is enough for M3), streaming responses.
  Each can be a follow-up once the MVP works.
