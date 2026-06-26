# What I Learned Building ResBot — a Bilingual AI HR Assistant

> A first-person write-up of the concepts behind this project. Feel free to edit it into your
> own voice before posting. Two versions below: a **portfolio long-form** and a **short LinkedIn
> caption**.

---

## Long-form (portfolio / blog)

I set out to understand how AI assistants like the ones bolted onto every product actually work
under the hood — not by reading about them, but by building one. The result is **ResBot**, a
bilingual (English + Bahasa Indonesia) HR assistant that answers employee questions from a company
handbook. Here's what clicked along the way.

### 1. "AI that knows your documents" is just RAG — and RAG is simpler than it sounds

The magic phrase is **Retrieval-Augmented Generation**. It breaks into two halves I built
separately:

- **Retrieval** — find the relevant text. The trick is turning text into **embeddings**: lists of
  numbers (vectors) that capture *meaning*. Two sentences that mean the same thing produce vectors
  pointing in a similar direction, even with totally different words. I measured that "direction"
  with **cosine similarity**, which I implemented by hand. Searching the knowledge base is just:
  embed the question, score it against every stored chunk, take the closest.
- **Generation** — I feed those top chunks to a language model with strict instructions to answer
  *only* from them. That's it. The LLM never "knows" company policy; it just rephrases the
  passages I hand it.

The lightbulb moment: I asked about *"vacation days"* and it correctly pulled the *"annual leave"*
paragraph — different words, same meaning. That's retrieval by meaning, and it's the whole reason
RAG beats keyword search.

### 2. Grounding is what stops hallucination

Left alone, an LLM will confidently invent an HR policy. The fix isn't magic — it's the **prompt**.
A firm system instruction ("answer only from this context; if it's not here, say you don't know")
plus a **confidence threshold** (if even the best-matching chunk is too weak, don't even call the
model) means ResBot declines instead of making things up.

### 3. Guardrails are a product decision, not just code

Some questions shouldn't get an AI answer at all — harassment, legal threats, mental-health
crises. ResBot detects these (in both languages) and **escalates to a human** before any model
runs. Building this taught me that "what the bot refuses to do" is as important as what it answers.

### 4. Going bilingual taught me embeddings aren't one-size-fits-all

My first embedding model was English-only, so Indonesian questions matched poorly. Swapping to a
**multilingual** model — which maps both languages into the *same* vector space — fixed it
instantly: "Berapa hari cuti tahunan?" now lands on the same answer as "How many annual leave
days?". One model, two languages, shared meaning.

### 5. The unglamorous engineering is half the learning

- **Rate limits & retries:** free LLM tiers throttle you. I learned to handle `429`s with
  exponential backoff instead of crashing.
- **Provider-agnostic design:** I put the model behind one small function and config, so switching
  from OpenRouter to Groq became a one-line `.env` change, not a code rewrite.
- **Security reality check:** the API key lives on the backend and never touches the browser. The
  real risk of hosting isn't a stolen key — it's people burning your quota through an open
  endpoint. Login doesn't solve that; rate limiting and a free model do.
- **Debugging humility:** an "endpoint doesn't exist" error turned out to be an orphaned old server
  still holding the port. And ES modules really do need the `.js` in imports.

### The takeaway

RAG isn't a black box once you build each piece yourself: embeddings → similarity → retrieval →
grounded generation, wrapped in guardrails and logging. The hard part wasn't any single concept —
it was making them work together honestly: cite sources, admit ignorance, and hand off what it
shouldn't touch.

**Stack:** React + TypeScript, Node/Express, transformers.js (local multilingual embeddings),
an OpenAI-compatible LLM API, and an in-memory vector store I wrote myself.

---

## Short version (LinkedIn caption)

I just built **ResBot** — a bilingual (🇬🇧/🇮🇩) AI HR assistant — to actually understand how
"AI that knows your documents" works. Turns out it's **RAG**, and it's less magic than I thought:

🔹 Turn text into **embeddings** (vectors that capture meaning)
🔹 Find the closest matches with **cosine similarity** (built it by hand)
🔹 Feed those passages to an LLM with strict instructions to answer **only** from them

The bits that surprised me weren't the AI — they were the engineering around it:
✅ **Grounding** so it cites sources instead of hallucinating
✅ **Guardrails** that escalate sensitive topics (harassment, legal, mental health) to a human
✅ A **multilingual embedding model** so it answers in English *or* Bahasa Indonesia
✅ Handling rate limits, retries, and keeping the API key off the frontend

Biggest lesson: a good assistant is defined as much by what it *refuses* to answer as by what it
gets right.

Built with React, Node/Express, transformers.js, and a vector store I wrote from scratch.

#AI #RAG #MachineLearning #WebDevelopment #LLM #BuildInPublic

---

> _Optional, your call:_ if you value transparency, you might add a line noting you built this as a
> guided learning project with AI pair-programming — it's a genuine strength to show you can learn
> fast *and* work alongside AI tools.
