# HR RAG Bot — Milestone 0 + 1 Implementation Plan

> **Learning plan.** Milestone 0 (foundation) is built by Claude. Milestone 1 (the RAG core)
> is built by **you, the user**, with Claude guiding. Each M1 task gives you: the **concept**,
> **what to build**, **how to verify**, and a **reference implementation** — try writing it
> yourself first, then compare. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working RAG pipeline so `POST /api/chat` answers HR questions grounded in the
markdown policy docs in `backend/knowledge/`.

**Architecture:** HR docs are chunked, embedded locally with transformers.js, and stored as vectors
in memory. Per question we embed the question, find the most similar chunks by cosine similarity,
put them in a prompt, and ask an OpenRouter chat model to answer using only that context.

**Tech Stack:** Node 20+, Express 5, `@huggingface/transformers` (local embeddings),
OpenRouter (chat, OpenAI-compatible HTTP), ES modules.

## Global Constraints

- ES modules only (`"type": "module"` is already set). Use `import`, not `require`.
- Backend lives under `backend/`; frontend stays under `src/`.
- The model call is config-driven: model ids live in `backend/config.js`, never hard-coded in logic.
- Embeddings go through a single `embed()` function so the provider is swappable.
- Secrets (`OPENROUTER_API_KEY`, `JWT_SECRET`, `PORT`) live in `.env`, never committed.
- No vector database — in-memory store only for this milestone.

---

## Milestone 0 — Foundation (Claude builds)

### Task 0: Project foundation

**Files:**
- Modify: `package.json` (fix syntax, add deps + scripts)
- Create: `backend/config.js`, `backend/routes/health.js`
- Modify: `backend/server.js` (moved/expanded from `src/server.js`)
- Create/modify: `.env`, `.gitignore`

**Interfaces:**
- Produces: `config` object exporting `{ PORT, OPENROUTER_API_KEY, CHAT_MODEL, TOP_K }`.
- Produces: a running Express app on `PORT` with `GET /api/health` → `{ status: 'ok' }`.

- [ ] **Step 1: Fix the `package.json` comma bug** (missing comma after the `start` script line) and add dependencies: `@huggingface/transformers`. Add scripts `"dev:server": "nodemon backend/server.js"` and `"start:server": "node backend/server.js"`.
- [ ] **Step 2: Move `src/server.js` → `backend/server.js`** and wire in `config.js` + the health route.
- [ ] **Step 3: Create `backend/config.js`** reading env via `dotenv`, exporting `PORT` (default 3000), `OPENROUTER_API_KEY`, `CHAT_MODEL` (default `meta-llama/llama-3.3-70b-instruct:free`), `TOP_K` (default 3).
- [ ] **Step 4: Add `.env`** keys `OPENROUTER_API_KEY=`, `PORT=3000`; ensure `.gitignore` excludes `.env` and `node_modules`.
- [ ] **Step 5: Install + verify.** Run `npm install`, then `npm run dev:server`, then `curl localhost:3000/api/health` → expect `{"status":"ok"}`.

---

## Milestone 1 — RAG core (You build, Claude guides)

> For each task: read the **Concept**, attempt **Build it yourself**, run **Verify**, then open the
> **Reference** to compare. Ask Claude anything at any point.

### Task 1: Vector store + cosine similarity

**Concept:** An embedding is a list of numbers (a vector) representing meaning. Two texts with
similar meaning have vectors pointing in a similar direction. **Cosine similarity** measures the
angle between two vectors: `1.0` = identical direction, `0` = unrelated. Our "database" is just an
array of `{ id, vector, text, source }`, and "search" is: compute cosine similarity of the query
vector against every stored vector, sort, take the top K.

**Files:** Create `backend/rag/vectorStore.js`

**Interfaces — Produces:**
- `cosineSimilarity(a: number[], b: number[]): number`
- `class VectorStore` with `add({ id, vector, text, source })`, `search(queryVector, k): Array<{ id, text, source, score }>`, and `size(): number`

- [ ] **Step 1: Write a verification script first** at `backend/rag/_check.js` that imports `cosineSimilarity` and asserts `cosineSimilarity([1,0],[1,0]) === 1` and `cosineSimilarity([1,0],[0,1]) === 0`.
- [ ] **Step 2: Build `cosineSimilarity` yourself.** Formula: `dot(a,b) / (magnitude(a) * magnitude(b))` where `dot = Σ aᵢ·bᵢ` and `magnitude(v) = √(Σ vᵢ²)`.
- [ ] **Step 3: Build the `VectorStore` class** — internal array, `add` pushes, `search` maps each item to `{ ...item, score: cosineSimilarity(queryVector, item.vector) }`, sorts by score descending, returns first `k`.
- [ ] **Step 4: Verify.** Run `node backend/rag/_check.js` → both asserts pass with no error thrown.
- [ ] **Step 5: Reference** (compare after your attempt):

```javascript
// backend/rag/vectorStore.js
export function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export class VectorStore {
  #items = [];
  add(entry) { this.#items.push(entry); }
  size() { return this.#items.length; }
  search(queryVector, k) {
    return this.#items
      .map((item) => ({ id: item.id, text: item.text, source: item.source,
                        score: cosineSimilarity(queryVector, item.vector) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, k);
  }
}
```

### Task 2: Local embeddings

**Concept:** transformers.js downloads a small model (`all-MiniLM-L6-v2`, ~25MB, cached after first
run) and runs it in Node — no API, no cost. The `feature-extraction` pipeline turns text into a
384-number vector. `pooling: 'mean'` averages the per-word vectors into one sentence vector;
`normalize: true` scales it to length 1 (makes cosine similarity well-behaved).

**Files:** Create `backend/rag/embed.js`

**Interfaces — Produces:** `embed(text: string): Promise<number[]>` (a length-384 vector).

- [ ] **Step 1: Install the model lib** (done in Task 0 if you added it; else `npm install @huggingface/transformers`).
- [ ] **Step 2: Build `embed` yourself.** Lazily create the pipeline once (module-level cached variable), then call it with `{ pooling: 'mean', normalize: true }` and return the data as a plain array.
- [ ] **Step 3: Verify it captures meaning.** Add to `backend/rag/_check.js`: embed `"How many vacation days do I get?"`, `"What is the annual leave allowance?"`, and `"What is the office dress code?"`. Assert similarity(q1,q2) > similarity(q1,q3). Run `node backend/rag/_check.js`.
- [ ] **Step 4: Reference:**

```javascript
// backend/rag/embed.js
import { pipeline } from '@huggingface/transformers';

let extractor;
export async function embed(text) {
  extractor ??= await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
```

### Task 3: Ingest the knowledge base

**Concept:** Whole documents are too big and unfocused to retrieve well, so we **chunk** them into
smaller passages (here: by paragraph). Each chunk is embedded once at startup and stored. This is
the "load the library into memory" step.

**Files:** Create `backend/rag/ingest.js`

**Interfaces — Consumes:** `VectorStore`, `embed`. **Produces:** `ingest(store): Promise<void>` that
reads every `.md` in `backend/knowledge/`, splits on blank lines, embeds each chunk, and `add`s it.

- [ ] **Step 1: Build `ingest` yourself.** Use `fs/promises` `readdir` + `readFile`; split file text on `/\n\s*\n/`; trim, drop empties; for each chunk `await embed(chunk)` and `store.add({ id, vector, text: chunk, source: filename })`.
- [ ] **Step 2: Verify.** Temporarily call `ingest` in `_check.js` and log `store.size()` → expect a dozen-ish chunks across the 3 docs, no errors.
- [ ] **Step 3: Reference:**

```javascript
// backend/rag/ingest.js
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embed } from './embed.js';

const KNOWLEDGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');

export async function ingest(store) {
  const files = (await readdir(KNOWLEDGE_DIR)).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const content = await readFile(join(KNOWLEDGE_DIR, file), 'utf8');
    const chunks = content.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
    for (let i = 0; i < chunks.length; i++) {
      const vector = await embed(chunks[i]);
      store.add({ id: `${file}#${i}`, vector, text: chunks[i], source: file });
    }
  }
  console.log(`Ingested ${store.size()} chunks from ${files.length} docs`);
}
```

### Task 4: Retrieve

**Concept:** The "R" in RAG. Given a question, embed it with the *same* `embed()` and ask the store
for the top-K most similar chunks. These become the evidence we hand the LLM.

**Files:** Create `backend/rag/retrieve.js`

**Interfaces — Produces:** `retrieve(store, question, k): Promise<Array<{ text, source, score }>>`.

- [ ] **Step 1: Build `retrieve` yourself** — `embed(question)` → `store.search(vector, k)`.
- [ ] **Step 2: Verify relevance.** In `_check.js`, after ingest, `retrieve(store, "how many vacation days?", 3)` → top result's `source` should be `leave-policy.md`. Log the results with scores.
- [ ] **Step 3: Reference:**

```javascript
// backend/rag/retrieve.js
import { embed } from './embed.js';

export async function retrieve(store, question, k) {
  const queryVector = await embed(question);
  return store.search(queryVector, k);
}
```

### Task 5: Generate (augment + LLM call)

**Concept:** The "AG" in RAG. We build a prompt = system instructions + retrieved chunks + the
question, then call an OpenRouter chat model. The instructions tell the model to answer **only**
from the provided context and to say it doesn't know otherwise — this grounding is what stops the
bot from making things up (and is the seed of M2's guardrails).

**Files:** Create `backend/lib/openrouter.js` and `backend/rag/generate.js`

**Interfaces:**
- `openrouter.js` Produces: `chat(messages: Array<{role, content}>): Promise<string>`
- `generate.js` Consumes: `retrieve`, `chat`. Produces: `answerQuestion(store, question): Promise<{ answer, sources }>`

- [ ] **Step 1: Build the OpenRouter client yourself.** `POST https://openrouter.ai/api/v1/chat/completions` with header `Authorization: Bearer ${OPENROUTER_API_KEY}`, body `{ model: CHAT_MODEL, messages }`. Return `data.choices[0].message.content`. Use the built-in `fetch`.
- [ ] **Step 2: Build `answerQuestion` yourself.** Call `retrieve` (k = `TOP_K`), join chunk texts into a `context` string, build a system message (answer only from context; if not present, say you don't know) + a user message containing the context and the question, call `chat`, return `{ answer, sources: [...unique source filenames...] }`.
- [ ] **Step 3: Verify end to end.** In `_check.js`: ingest, then `answerQuestion(store, "How many days of annual leave do I get?")` → answer mentions **12 days**; `sources` includes `leave-policy.md`. (Needs a real `OPENROUTER_API_KEY` in `.env`.)
- [ ] **Step 4: Reference:**

```javascript
// backend/lib/openrouter.js
import { config } from '../config.js';

export async function chat(messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: config.CHAT_MODEL, messages }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}
```

```javascript
// backend/rag/generate.js
import { config } from '../config.js';
import { retrieve } from './retrieve.js';
import { chat } from '../lib/openrouter.js';

const SYSTEM = `You are an HR assistant. Answer ONLY using the provided context.
If the answer is not in the context, say you don't have that information and suggest contacting HR.
Be concise and do not invent policy details.`;

export async function answerQuestion(store, question) {
  const hits = await retrieve(store, question, config.TOP_K);
  const context = hits.map((h) => `[${h.source}]\n${h.text}`).join('\n\n');
  const answer = await chat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
  ]);
  return { answer, sources: [...new Set(hits.map((h) => h.source))] };
}
```

### Task 6: Wire the `/api/chat` endpoint

**Concept:** Expose the pipeline over HTTP. Ingest runs **once at server startup** (so the model
loads and vectors are ready), and each request just retrieves + generates.

**Files:** Create `backend/routes/chat.js`; modify `backend/server.js`

**Interfaces — Produces:** `POST /api/chat` taking `{ question }` → `{ answer, sources }`.

- [ ] **Step 1: Build the route yourself.** A factory `createChatRouter(store)` returning an Express router with `POST /` that validates `question` is a non-empty string (else 400), calls `answerQuestion(store, question)`, returns the result, and 500s on error.
- [ ] **Step 2: In `server.js`,** create the store, `await ingest(store)` before `app.listen`, and mount `app.use('/api/chat', createChatRouter(store))`.
- [ ] **Step 3: Verify.** Start the server, then:
  `curl -s -X POST localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"question":"How many sick days do I get?"}'`
  → JSON answer mentioning **14 days**, `sources` includes `leave-policy.md`.
- [ ] **Step 4: Reference:**

```javascript
// backend/routes/chat.js
import { Router } from 'express';
import { answerQuestion } from '../rag/generate.js';

export function createChatRouter(store) {
  const router = Router();
  router.post('/', async (req, res) => {
    const { question } = req.body ?? {};
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }
    try {
      res.json(await answerQuestion(store, question));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to answer question' });
    }
  });
  return router;
}
```

- [ ] **Step 5: Clean up** the temporary `backend/rag/_check.js`.

---

## Done when

`POST /api/chat` returns grounded, source-cited answers to HR questions from the knowledge base,
the server ingests on startup, and you can explain each of the four RAG steps in your own words.

**Next milestone:** M2 — guardrails (sensitive-topic escalation, stronger "I don't know" behavior,
Q/A logging), which builds directly on `generate.js`.
