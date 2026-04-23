import { VoyageAIClient } from 'voyageai';
import { config } from '../config';

const client = new VoyageAIClient({
  apiKey: config.VOYAGE_API_KEY,
});

const MODEL = 'voyage-3';
const BATCH_SIZE = 128;

/**
 * Embed a batch of texts. Voyage accepts up to 128 per call.
 * Use input_type='document' for content being indexed.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embed({
      input: batch,
      model: MODEL,
      inputType: 'document',
    });

    if (!response.data) {
      throw new Error('Voyage returned no embedding data');
    }

    for (const item of response.data) {
      if (!item.embedding) {
        throw new Error('Voyage returned an item without an embedding');
      }
      allVectors.push(item.embedding);
    }
  }

  return allVectors;
}

/**
 * Embed a single query string. Uses input_type='query' which optimizes
 * for asymmetric search (query ≠ document phrasing).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const response = await client.embed({
    input: [text],
    model: MODEL,
    inputType: 'query',
  });

  if (!response.data || response.data.length === 0) {
    throw new Error('Voyage returned no embedding data');
  }
  const embedding = response.data[0].embedding;
  if (!embedding) {
    throw new Error('Voyage returned an item without an embedding');
  }
  return embedding;
}