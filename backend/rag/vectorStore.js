export function cosineSimilarity(a, b) {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export class VectorStore {
  #items = [];

  add(entry) {
    this.#items.push(entry);
  }

  size() {
    return this.#items.length;
  }

  search(queryVector, k) {
    return this.#items
      .map((item) => ({
        id: item.id,
        text: item.text,
        source: item.source,
        score: cosineSimilarity(queryVector, item.vector)
      }))
      .sort((x, y) => y.score - x.score)
      .slice(0, k);
  }
}

