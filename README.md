# ResBot — Bilingual AI HR Assistant 🇮🇩 🇬🇧

ResBot (Resource Bot) is an AI-powered HR assistant that answers employee questions
from a company handbook using **RAG (Retrieval-Augmented Generation)**. It speaks both
**English and Bahasa Indonesia**, cites its sources, refuses to guess on sensitive topics,
and routes those to a human instead.

Built as a learning project to understand how production AI assistants actually work —
embeddings, vector search, grounded generation, and safety guardrails — end to end.

## Screenshots

The welcome screen, with bilingual suggested questions:

![ResBot welcome screen](docs/screenshot.png)

Answering with cited sources — and staying grounded: when asked to write Python code, it declines,
because that isn't in the HR handbook.

![ResBot answering questions with source citations](docs/screenshot2.png)

---

## What it does

- **Answers from a real knowledge base.** HR policies live in markdown; ResBot retrieves the
  relevant passages and answers from them — no made-up policies.
- **Bilingual.** Ask in English or Indonesian; it detects the language, retrieves from the
  matching content, and replies in kind.
- **Cites its sources.** Every answer shows which handbook document it came from.
- **Guardrails for sensitive topics.** Questions about harassment, legal action, termination,
  or mental health are *escalated to a human* — the bot never improvises on those.
- **Honest about gaps.** If nothing relevant is found, it says so (and doesn't call the LLM).
- **Audit logging.** Every interaction is logged as JSON Lines for HR review.

## How it works — the RAG pipeline

```
  Browser (React)              Express backend                Models
 ┌──────────────┐    POST     ┌─────────────────────┐      ┌────────────────────┐
 │   Chat UI    │──/api/chat─▶│  Guardrails (gate)  │      │ OpenRouter / Groq  │
 │ (source chips│             │  ┌───────────────┐  │ ───▶ │ chat (free model)  │
 │  + statuses) │             │  │  RAG pipeline │  │      ├────────────────────┤
 └──────────────┘             │  └───────────────┘  │ ───▶ │ transformers.js    │
                              │  Audit log (JSONL)  │      │ local embeddings   │
                              └─────────────────────┘      └────────────────────┘
                                        ▲
                            Bilingual HR handbook (.md)
```

1. **Ingest** (on startup): the handbook is split into chunks, each embedded into a vector, and
   held in an in-memory store.
2. **Guard:** sensitive questions are intercepted and escalated before any AI runs.
3. **Retrieve:** the question is embedded and compared (cosine similarity) against every chunk;
   the closest are selected. If even the best match is too weak, ResBot declines.
4. **Generate:** the retrieved passages + the question are sent to an LLM with strict instructions
   to answer *only* from that context and in the user's language.

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React 19 + TypeScript + Vite |
| Backend | Node.js + Express 5 (ES modules) |
| Embeddings | `@huggingface/transformers` — `paraphrase-multilingual-MiniLM-L12-v2`, runs locally |
| Vector store | In-memory array + hand-written cosine similarity |
| LLM | OpenAI-compatible API (OpenRouter / Groq), provider-agnostic via config |

## Getting started

**Prerequisites:** Node.js 20+, and a free API key from
[OpenRouter](https://openrouter.ai/keys) or [Groq](https://console.groq.com/keys).

```bash
# 1. Install
npm install

# 2. Configure — copy the example env and fill in ONE provider's key
cp .env.example .env
#    then edit .env: paste your Groq key into GROQ_API_KEY=
#    (or switch to the OpenRouter block in the file)

# 3. Run both processes (two terminals)
npm run dev:server   # backend API → http://localhost:3000
npm run dev          # frontend UI → http://localhost:5173
```

The defaults use **Groq** (`llama-3.3-70b-versatile`); set `GROQ_API_KEY` and you're ready. To use
OpenRouter instead, follow the commented block in `.env.example`. Switching providers is just a
`.env` change — no code edits.

Open **http://localhost:5173** and ask away — try the suggestion chips, or test a guardrail with
*"Can I sue my manager for harassment?"*

> The first backend start downloads the embedding model (~once, then cached).

## Project structure

```
backend/
├── server.js          # Express app; ingests the handbook on startup
├── config.js          # env + model config (provider-agnostic)
├── routes/chat.js     # POST /api/chat
├── rag/               # the RAG pipeline
│   ├── vectorStore.js # in-memory store + cosineSimilarity()
│   ├── embed.js       # local multilingual embeddings
│   ├── ingest.js      # chunk + embed the handbook
│   ├── retrieve.js    # similarity search
│   ├── generate.js    # grounded prompt + LLM call + confidence gate
│   └── guardrails.js  # sensitive-topic detection (EN + ID)
├── lib/
│   ├── openrouter.js  # OpenAI-compatible LLM client (retry + backoff)
│   └── logger.js      # JSON-Lines audit log
└── knowledge/         # bilingual HR handbook (markdown)
src/
├── pages/Chat.tsx     # chat screen
├── components/ChatMessage.tsx
└── api/client.ts      # typed API client
```

## Safety & design notes

- **The API key never reaches the browser** — it stays on the backend; the frontend only calls
  `/api/chat`.
- **Grounding over guessing:** the system prompt forbids answering outside the provided context,
  and a similarity threshold blocks low-confidence answers before they reach the LLM.
- **Provider-agnostic:** switching LLM providers is a `.env` change, not a code change.

## Roadmap

- [ ] JWT login to demonstrate authentication
- [ ] Rate limiting (`express-rate-limit`) before any public hosting
- [ ] Real vector database (pgvector / Chroma) to graduate from the in-memory store

## What I learned

See [`docs/LEARNINGS.md`](docs/LEARNINGS.md) for a write-up of the concepts behind this project.
