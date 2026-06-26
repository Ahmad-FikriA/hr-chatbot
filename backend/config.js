import 'dotenv/config';

// Central config. Model ids and tunables live here, never hard-coded in logic,
// so the bot's behavior is changed in one place.
export const config = {
  PORT: process.env.PORT || 3000,

  // LLM provider. Any OpenAI-compatible API works — just change these three.
  // Default: Groq (free, fast, reliable limits). To use OpenRouter instead, set
  // LLM_BASE_URL=https://openrouter.ai/api/v1 and CHAT_MODEL in .env.
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
  LLM_API_KEY: process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || '',
  CHAT_MODEL: process.env.CHAT_MODEL || 'llama-3.3-70b-versatile',

  // How many knowledge-base chunks to retrieve per question.
  TOP_K: Number(process.env.TOP_K) || 3,
  MIN_SCORE: Number(process.env.MIN_SCORE) || 0.3,
};
