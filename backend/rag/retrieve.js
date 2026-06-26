import { embed } from "./embed.js";

export async function retrieve(store, question, k) {
    // TODO 1: embed the question
    const queryVector = await embed(question)

    return store.search(queryVector,k)
}