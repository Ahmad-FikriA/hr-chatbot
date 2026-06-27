import { Router } from 'express'
import { answerQuestion } from '../rag/generate.js'
import { saveMessage } from '../db/messages.js'

export function createChatRouter(store) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { question } = req.body ?? {};

    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    try {
      await saveMessage({
        userId: req.user.id,
        role: 'user',
        text: question.trim(),
      });
      const result = await answerQuestion(store, question.trim());
      await saveMessage({
        userId: req.user.id,
        role: 'bot',
        text: result.answer,
        status: result.status,
        sources: result.sources,
      });
      return res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to answer question' });
    }
  });

  return router;
}