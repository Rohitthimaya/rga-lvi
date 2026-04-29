import { pool } from '../db/client';
import { embedQuery } from '../ingestion/embedder';

export type HybridSearchFilters = Partial<{
  product_model: string;
  doc_type: string;
  crop: string;
  region: string;
  lang: string;
  type: string;
  source: string;
}>;

export type HybridSearchResult = {
  node_id: string;
  summary: string;
  source: string;
  page: number;
  type: string;
  product_model: string | null;
  doc_type: string | null;
  crop: string | null;
  region: string | null;
  lang: string;
  rrf_score: number;
  dense_rank: number | null;
  bm25_rank: number | null;
};

type CandidateRow = Omit<HybridSearchResult, 'rrf_score' | 'dense_rank' | 'bm25_rank'> & {
  is_strict?: boolean;
};

function buildFilterWhereClause(
  filters: HybridSearchFilters | undefined,
  startParamIndex: number,
  tableAlias = ''
): { sql: string; params: any[] } {
  const params: any[] = [];
  const clauses: string[] = [];
  let idx = startParamIndex;
  const col = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name);

  const add = (col: string, value: unknown) => {
    if (typeof value !== 'string' || value.trim() === '') return;
    params.push(value.trim());
    clauses.push(`${col} = $${idx++}`);
  };

  add(col('product_model'), filters?.product_model);
  add(col('doc_type'), filters?.doc_type);
  add(col('crop'), filters?.crop);
  if (typeof filters?.region === 'string' && filters.region.trim() !== '') {
    params.push(filters.region.trim());
    clauses.push(`(${col('region')} = $${idx} OR ${col('region')} = 'all')`);
    idx++;
  }
  add(col('lang'), filters?.lang);
  add(col('type'), filters?.type);
  add(col('source'), filters?.source);

  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export async function hybridSearch(
  query: string,
  filters: HybridSearchFilters = {},
  k = 20,
  opts: { candidatesPerMode?: number; rrfK?: number } = {}
): Promise<HybridSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const candidatesPerMode = opts.candidatesPerMode ?? 50;
  const rrfK = opts.rrfK ?? 60;

  const denseWhere = buildFilterWhereClause(filters, 2, 'v');
  const bm25Where = buildFilterWhereClause(filters, 2, 'v');

  const denseSql = `
    SELECT
      v.node_id, v.summary, v.source, v.page, v.type, v.product_model, v.doc_type, v.crop, v.region, v.lang
    FROM vectors v
    WHERE 1=1
      ${denseWhere.sql}
      AND EXISTS (
        SELECT 1 FROM corpus_registry cr
        WHERE cr.crop = v.crop AND cr.status = 'active'
      )
    ORDER BY embedding <=> $1::vector
    LIMIT $${denseWhere.params.length + 2}
  `;

  const bm25Sql = `
    WITH q AS (
      SELECT
        websearch_to_tsquery('english', $1) AS strict_tsq,
        (
          SELECT to_tsquery(
            'english',
            string_agg(quote_literal(lexeme) || ':*', ' | ')
          )
          FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
        ) AS any_tsq,
        (
          SELECT to_tsquery(
            'english',
            string_agg(quote_literal(lexeme) || ':*', ' | ')
          )
          FROM unnest(tsvector_to_array(to_tsvector('english', $1))) AS lexeme
          WHERE lexeme ~ '[0-9]' AND lexeme ~ '[a-z]'
        ) AS anchor_tsq
    )
    SELECT
      v.node_id, v.summary, v.source, v.page, v.type, v.product_model, v.doc_type, v.crop, v.region, v.lang,
      (q.strict_tsq IS NOT NULL AND v.search_vector @@ q.strict_tsq) AS is_strict
    FROM vectors v, q
    WHERE 1=1
      ${bm25Where.sql}
      AND EXISTS (
        SELECT 1 FROM corpus_registry cr
        WHERE cr.crop = v.crop AND cr.status = 'active'
      )
      AND q.any_tsq IS NOT NULL
      AND (
        (q.strict_tsq IS NOT NULL AND v.search_vector @@ q.strict_tsq)
        OR v.search_vector @@ q.any_tsq
      )
      AND (q.anchor_tsq IS NULL OR v.search_vector @@ q.anchor_tsq)
    ORDER BY
      CASE
        WHEN q.strict_tsq IS NOT NULL AND v.search_vector @@ q.strict_tsq
          THEN 1.0 + ts_rank_cd(v.search_vector, q.strict_tsq)
        ELSE ts_rank_cd(v.search_vector, q.any_tsq)
      END DESC
    LIMIT $${bm25Where.params.length + 2}
  `;

  // Run BM25 even if dense embedding fails, and vice versa.
  const bm25Promise = pool
    .query<CandidateRow>(bm25Sql, [trimmed, ...bm25Where.params, candidatesPerMode])
    .then((r) => r.rows)
    .catch(() => []);

  const densePromise = (async () => {
    try {
      const queryEmbedding = await embedQuery(trimmed);
      const vectorLiteral = `[${queryEmbedding.join(',')}]`;
      const res = await pool.query<CandidateRow>(denseSql, [
        vectorLiteral,
        ...denseWhere.params,
        candidatesPerMode,
      ]);
      return res.rows;
    } catch {
      return [];
    }
  })();

  const [denseRows, bm25Rows] = await Promise.all([densePromise, bm25Promise]);
  if (denseRows.length === 0 && bm25Rows.length === 0) return [];

  const denseRankById = new Map<string, number>();
  denseRows.forEach((r, i) => denseRankById.set(r.node_id, i + 1));

  const bm25RankById = new Map<string, number>();
  const strictBm25 = new Set<string>();
  bm25Rows.forEach((r, i) => {
    bm25RankById.set(r.node_id, i + 1);
    if (r.is_strict) strictBm25.add(r.node_id);
  });

  const merged = new Map<string, HybridSearchResult>();
  const upsert = (row: CandidateRow) => {
    if (!merged.has(row.node_id)) {
      merged.set(row.node_id, {
        node_id: row.node_id,
        summary: row.summary,
        source: row.source,
        page: row.page,
        type: row.type,
        product_model: row.product_model ?? null,
        doc_type: row.doc_type ?? null,
        crop: row.crop ?? null,
        region: row.region ?? null,
        lang: row.lang,
        rrf_score: 0,
        dense_rank: null,
        bm25_rank: null,
      });
    }
  };

  denseRows.forEach(upsert);
  bm25Rows.forEach(upsert);

  for (const [nodeId, item] of merged) {
    const dr = denseRankById.get(nodeId);
    const br = bm25RankById.get(nodeId);
    item.dense_rank = dr ?? null;
    item.bm25_rank = br ?? null;
    item.rrf_score = (dr ? 1 / (rrfK + dr) : 0) + (br ? 1 / (rrfK + br) : 0);
  }

  const all = [...merged.values()];
  const strict = all
    .filter((r) => strictBm25.has(r.node_id))
    .sort((a, b) => (a.bm25_rank ?? 1e9) - (b.bm25_rank ?? 1e9));
  const nonStrict = all.filter((r) => !strictBm25.has(r.node_id)).sort((a, b) => b.rrf_score - a.rrf_score);

  return [...strict, ...nonStrict].slice(0, k);
}

function mergeRoundRobinUnique<T>(
  lists: T[][],
  getId: (item: T) => string,
  limit: number
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const indices = new Array(lists.length).fill(0);

  while (out.length < limit) {
    let progressed = false;
    for (let i = 0; i < lists.length && out.length < limit; i++) {
      const list = lists[i];
      let idx = indices[i];
      while (idx < list.length) {
        const item = list[idx++];
        const id = getId(item);
        if (!seen.has(id)) {
          out.push(item);
          seen.add(id);
          progressed = true;
          break;
        }
      }
      indices[i] = idx;
    }
    if (!progressed) break;
  }

  return out;
}

/**
 * Diversified retrieval for queries mentioning multiple products.
 * Pulls some candidates per product_model and merges them (round-robin),
 * then tops up with the global hybridSearch results.
 */
export async function hybridSearchDiversifiedByProductModel(
  query: string,
  productModels: string[],
  filters: HybridSearchFilters = {},
  k = 20,
  opts: {
    perProductK?: number;
    candidatesPerMode?: number;
    rrfK?: number;
  } = {}
): Promise<HybridSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (productModels.length <= 1) return hybridSearch(trimmed, filters, k, opts);

  // If the caller already forced a single product_model, don't diversify.
  if (filters.product_model) return hybridSearch(trimmed, filters, k, opts);

  const perProductK = Math.max(3, opts.perProductK ?? Math.ceil(k / Math.min(productModels.length, 4)));

  const perProductPromises = productModels.map((pm) =>
    hybridSearch(trimmed, { ...filters, product_model: pm }, Math.min(perProductK, k), {
      candidatesPerMode: opts.candidatesPerMode,
      rrfK: opts.rrfK,
    })
  );

  const globalPromise = hybridSearch(trimmed, filters, k, {
    candidatesPerMode: opts.candidatesPerMode,
    rrfK: opts.rrfK,
  });

  const [perProductLists, global] = await Promise.all([
    Promise.all(perProductPromises),
    globalPromise,
  ]);

  const merged = mergeRoundRobinUnique<HybridSearchResult>(
    perProductLists,
    (r) => r.node_id,
    k
  );

  if (merged.length >= k) return merged.slice(0, k);

  const out = [...merged];
  const seen = new Set(out.map((r) => r.node_id));
  for (const g of global) {
    if (out.length >= k) break;
    if (seen.has(g.node_id)) continue;
    out.push(g);
    seen.add(g.node_id);
  }

  return out.slice(0, k);
}

