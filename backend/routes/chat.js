import { Router } from 'express'
import { answerQuestion } from '../rag/generate.js'
import { saveMessage } from '../db/messages.js'

export function createChatRouter(store) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { question } = req.body ?? {};

    // TODO 1: reject bad input. If `question` isn't a non-empty string,
    //   respond 400 with { error: 'question is required' } and return.
    //   Hint: if (typeof question !== 'string' || !question.trim()) { ... }
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    try {
      // TODO 2: get the answer and send it back as JSON.
      //   const result = await answerQuestion(store, question);
      //   res.json(result);
      const q = question.trim();
      const result = await answerQuestion(store, q);
      // Persist the exchange: one row for the question, one for the answer.
      await saveMessage({ userId: req.user.id, role: 'user', text: q });
      await saveMessage({ userId: req.user.id, role: 'bot', text: result.answer, status: result.status, sources: result.sources });
      return res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to answer question' });
    }
  });

  return router;
}