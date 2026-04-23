import { pool } from '../db/client';

let cachedModels: string[] | null = null;
let cachedAtMs = 0;

const CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeModel(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function loadKnownProductModels(): Promise<string[]> {
  const now = Date.now();
  if (cachedModels && now - cachedAtMs < CACHE_TTL_MS) return cachedModels;

  const res = await pool.query<{ product_model: string }>(
    `
      SELECT DISTINCT product_model
      FROM vectors
      WHERE product_model IS NOT NULL AND product_model <> ''
    `
  );

  cachedModels = res.rows
    .map((r) => r.product_model)
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  cachedAtMs = now;
  return cachedModels;
}

/**
 * Return the set of indexed product models that are explicitly mentioned in the query.
 * Matching is normalization-based (case-insensitive, ignores hyphens/spaces).
 */
export async function findMentionedProductModels(
  query: string,
  opts: { maxMentions?: number } = {}
): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const maxMentions = opts.maxMentions ?? 5;
  const normalizedQuery = normalizeModel(trimmed);
  if (!normalizedQuery) return [];

  const models = await loadKnownProductModels();

  const hits: { model: string; idx: number }[] = [];
  for (const m of models) {
    const nm = normalizeModel(m);
    if (!nm) continue;
    const idx = normalizedQuery.indexOf(nm);
    if (idx >= 0) hits.push({ model: m, idx });
  }

  hits.sort((a, b) => a.idx - b.idx || a.model.localeCompare(b.model));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (seen.has(h.model)) continue;
    out.push(h.model);
    seen.add(h.model);
    if (out.length >= maxMentions) break;
  }

  return out;
}

