import { VoyageAIClient } from 'voyageai';
import { config } from '../config';
import { retryWithBackoff } from '../lib/retry';

const client = new VoyageAIClient({
  apiKey: config.VOYAGE_API_KEY,
});

const MODEL = 'voyage-3';
const MAX_BATCH_SIZE = 128;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDocumentBatchSize(): number {
  return Math.min(config.VOYAGE_EMBED_BATCH_SIZE, MAX_BATCH_SIZE);
}

function formatProgress(done: number, total: number): string {
  return `${done}/${total}`;
}

/**
 * Embed a batch of texts. Voyage accepts up to 128 per call.
 * Use input_type='document' for content being indexed.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allVectors: number[][] = [];
  const batchSize = getDocumentBatchSize();

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    if (i > 0 && config.VOYAGE_EMBED_DELAY_MS > 0) {
      console.log(`  Voyage throttle: waiting ${Math.round(config.VOYAGE_EMBED_DELAY_MS / 1000)}s`);
      await sleep(config.VOYAGE_EMBED_DELAY_MS);
    }

    console.log(
      `  Voyage embedding batch ${formatProgress(Math.min(i + batch.length, texts.length), texts.length)}`
    );
    const response = await retryWithBackoff(
      () =>
        client.embed({
          input: batch,
          model: MODEL,
          inputType: 'document',
        }),
      {
        maxAttempts: config.VOYAGE_EMBED_MAX_ATTEMPTS,
        baseDelayMs: Math.max(config.VOYAGE_EMBED_DELAY_MS, 1000),
        maxDelayMs: Math.max(config.VOYAGE_EMBED_DELAY_MS, 30000),
        onRetry: (attempt, _err, delay) => {
          console.log(`  Voyage embed retry #${attempt} after ${Math.round(delay)}ms`);
        },
      }
    );

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
  const response = await retryWithBackoff(
    () =>
      client.embed({
        input: [text],
        model: MODEL,
        inputType: 'query',
      }),
    {
      maxAttempts: config.VOYAGE_EMBED_MAX_ATTEMPTS,
      onRetry: (attempt, _err, delay) => {
        console.log(`  Voyage query retry #${attempt} after ${Math.round(delay)}ms`);
      },
    }
  );

  if (!response.data || response.data.length === 0) {
    throw new Error('Voyage returned no embedding data');
  }
  const embedding = response.data[0].embedding;
  if (!embedding) {
    throw new Error('Voyage returned an item without an embedding');
  }
  return embedding;
}