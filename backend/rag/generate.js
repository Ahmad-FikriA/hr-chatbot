import { config } from '../config.js';
import { retrieve } from './retrieve.js';
import { isSensitive, ESCALATION_MESSAGE } from './guardrails.js';
import { chat } from '../lib/openrouter.js';

const SYSTEM = `You are an HR assistant for an Indonesian company. Answer ONLY using the provided context.
Reply in the SAME language as the user's question (English or Bahasa Indonesia).
If the answer is not in the context, say you don't have that information and suggest contacting HR.
Be concise and do not invent policy details.`;

export async function answerQuestion(store, question) {
    if (isSensitive(question)) {
        return { 
            answer: ESCALATION_MESSAGE,
            sources: [],
            status: 'escalated'    
         };
    }
  // TODO 1: get the top chunks for this question
    const hits = await retrieve(store, question, config.TOP_K);

    if (hits.length === 0 || hits[0].score < config.MIN_SCORE) {
        return { 
            answer: "I don't have enough information to answer that. Please contact HR directly.\n\n" +
                    "Maaf, saya tidak memiliki informasi yang cukup untuk menjawab hal itu. Silakan hubungi HR secara langsung.",
            sources: [],
            status: 'no_answer'
         };
    }

  // TODO 2: glue the chunk texts into one "context" string the model can read.
  //   Label each with its source so the model sees where it came from:
    const context = hits.map((h) => `[${h.source}]\n${h.text}`).join('\n\n');

  // TODO 3: call the model with a system message + a user message that
  //   contains the context AND the question, then read the reply:
    const answer = await chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ]);

  // Return the answer plus which files it drew from (for citations in the UI).
  
  return { answer, sources: [...new Set(hits.map((h) => h.source))], status: 'answered' };
}