import { Router } from 'express'
import { answerQuestion } from '../rag/generate.js'
import { logChat } from '../lib/logger.js'


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
      const result = await answerQuestion(store, question.trim());
      await logChat({ question: question.trim(), ...result });
      return res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to answer question' });
    }
  });

  return router;
}