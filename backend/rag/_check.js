
import { VectorStore } from './vectorStore.js';
import { ingest } from './ingest.js';
import { answerQuestion } from './generate.js';

const store = new VectorStore();
await ingest(store);

const sensitive = await answerQuestion(store, 'Can I sue my manager for harassment?');
console.log('SENSITIVE →', sensitive.status, '|', sensitive.answer.slice(0, 50));

const unknown = await answerQuestion(store, 'What is the meaning of life?');
console.log('UNKNOWN   →', unknown.status, '|', unknown.answer.slice(0, 50));

const normal = await answerQuestion(store, 'How many vacation days do I get?');
console.log('NORMAL    →', normal.status, '|', normal.answer.slice(0, 50));

console.assert(sensitive.status === 'escalated', 'should escalate');
console.assert(unknown.status === 'no_answer', 'should refuse unknown');
console.assert(normal.status === 'answered', 'should answer normal');
console.log('Task 2 passed');