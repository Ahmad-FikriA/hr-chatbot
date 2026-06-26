import { readdir, readFile } from 'fs/promises';
import { join, dirname} from 'path'
import { fileURLToPath } from 'url';
import { embed } from './embed.js';

// Path plumbing: ES modules don't have a built-in "current folder", so we
// derive it from this file's URL, then point at the ../knowledge directory.
const KNOWLEDGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');

export async function ingest(store) {
  // Get all .md files in the knowledge folder.
  const files = (await readdir(KNOWLEDGE_DIR)).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const content = await readFile(join(KNOWLEDGE_DIR, file), 'utf8');

    // Split into paragraphs on blank lines, trim whitespace, drop empties.
    const chunks = content.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);

    // YOUR PART: for each chunk, embed it and add it to the store.
    for (let i = 0; i < chunks.length; i++) {
      const vector = await embed(chunks[i]);
      store.add({ id: `${file}#${i}`, vector, text: chunks[i], source: file })
    }
  }

  console.log(`Ingested ${store.size()} chunks from ${files.length} docs`);
}