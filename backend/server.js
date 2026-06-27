import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';
import { VectorStore } from './rag/vectorStore.js';
import { ingest } from './rag/ingest.js';
import { createChatRouter } from './routes/chat.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());          // makes req.cookies available (needed by requireAuth)

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter); // register / login / logout / me

// Startup is async: load the knowledge base into the vector store BEFORE we
// start accepting requests, so the first question doesn't race the ingestion.
async function start() {
  const store = new VectorStore();
  console.log('Ingesting knowledge base...');
  await ingest(store);

  // Chat is now login-protected: requireAuth runs first, attaching req.user.
  app.use('/api/chat', requireAuth, createChatRouter(store));

  app.listen(config.PORT, () => {
    console.log(`backend running on http://localhost:${config.PORT}`);
  });
}

start();
