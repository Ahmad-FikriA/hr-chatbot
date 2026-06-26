import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import healthRouter from './routes/health.js';
import { VectorStore } from './rag/vectorStore.js';
import { ingest } from './rag/ingest.js';
import { createChatRouter } from './routes/chat.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);

// Startup is async: load the knowledge base into the vector store BEFORE we
// start accepting requests, so the first question doesn't race the ingestion.
async function start() {
  const store = new VectorStore();
  console.log('Ingesting knowledge base...');
  await ingest(store);

  app.use('/api/chat', createChatRouter(store));

  app.listen(config.PORT, () => {
    console.log(`backend running on http://localhost:${config.PORT}`);
  });
}

start();
