import { pipeline } from '@huggingface/transformers'

let extractor;

export async function embed(text) {
  // `??=` means "if extractor is empty, set it up; otherwise leave it".
  // Multilingual model: maps English AND Indonesian into the same vector space,
  // so a question in either language matches the right handbook chunk.
  extractor ??= await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');

  // Run the model. `await` because it takes a moment.
  const output = await extractor(text, { pooling: 'mean', normalize: true });

  // `output.data` is a special typed array; turn it into a plain number[].
  return Array.from(output.data);
}