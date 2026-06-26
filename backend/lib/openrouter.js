import { config } from '../config.js';

// Generic OpenAI-compatible chat client. Works with any provider (Groq,
// OpenRouter, OpenAI, ...) by changing LLM_BASE_URL / LLM_API_KEY in config.
export async function chat(messages, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: config.CHAT_MODEL, messages }),
    });

    // 429 = rate limited. Wait a bit and try again (unless we're out of retries).
    if (res.status === 429 && attempt < retries) {
      const waitMs = 2000 * 2 ** attempt;   // 2s, 4s, 8s — exponential backoff
      console.log(`Rate limited, retrying in ${waitMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;   // loop again
    }

    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);

    const data = await res.json();
    return data.choices[0].message.content;
  }
}