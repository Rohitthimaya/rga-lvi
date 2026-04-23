import { CohereClient } from 'cohere-ai';
import { config } from '../config';
import type { HybridSearchResult } from './hybrid';

export type RerankedResult = HybridSearchResult & { relevance_score: number };

const DEFAULT_MODEL = 'rerank-english-v3.0';

export async function rerank(
  query: string,
  candidates: HybridSearchResult[],
  topN = 5,
  opts: { model?: string } = {}
): Promise<RerankedResult[]> {
  const trimmed = query.trim();
  if (!trimmed || candidates.length === 0) return [];

  if (!config.COHERE_API_KEY) {
    return candidates.slice(0, topN).map((c) => ({ ...c, relevance_score: 0 }));
  }

  const cohere = new CohereClient({ token: config.COHERE_API_KEY });
  const res = await cohere.rerank({
    model: opts.model ?? DEFAULT_MODEL,
    query: trimmed,
    documents: candidates.map((c) => c.summary),
    topN: Math.min(topN, candidates.length),
  });

  return (res.results ?? []).map((r) => ({
    ...candidates[r.index],
    relevance_score: r.relevanceScore,
  }));
}

