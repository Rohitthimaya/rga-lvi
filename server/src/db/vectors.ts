import { pool } from './client';
import type { NodeRecord } from './nodes';

export interface VectorInsert {
  node_id: string;
  summary: string;
  embedding: number[];
  source: string;
  page: number;
  type: string;
  product_model: string | null;
  doc_type: string | null;
  crop: string | null;
  region: string | null;
  lang: string;
}

/**
 * Bulk insert vectors (summary + embedding + BM25 index).
 * The search_vector tsvector is computed in SQL from summary + node content.
 */
export async function insertVectors(items: VectorInsert[]): Promise<number> {
  if (items.length === 0) return 0;

  const values: any[] = [];
  const placeholders: string[] = [];

  items.forEach((item, i) => {
    const base = i * 11;
    // Format vector as pgvector literal: '[0.1,0.2,...]'
    const vectorLiteral = `[${item.embedding.join(',')}]`;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}::vector, $${base + 4}, ` +
        `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, ` +
        `to_tsvector('english', $${base + 3}))` // we'll restructure — see below
    );
    // Actually we need search_vector from summary, not from vector. Rebuild:
  });

  // Rewrite with correct parameter indexing
  values.length = 0;
  placeholders.length = 0;

  items.forEach((item, i) => {
    const base = i * 11;
    const vectorLiteral = `[${item.embedding.join(',')}]`;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}::vector, ` +
        `$${base + 4}, $${base + 5}, $${base + 6}, ` +
        `$${base + 7}, $${base + 8}, $${base + 9}, ` +
        `$${base + 10}, $${base + 11}, ` +
        `to_tsvector('english', $${base + 2}))`
    );
    values.push(
      item.node_id,      // $1
      item.summary,      // $2
      vectorLiteral,     // $3 (cast to vector)
      item.source,       // $4
      item.page,         // $5
      item.type,         // $6
      item.product_model,// $7
      item.doc_type,     // $8
      item.crop,         // $9
      item.region,       // $10
      item.lang          // $11
    );
  });

  const query = `
    INSERT INTO vectors (
      node_id, summary, embedding,
      source, page, type,
      product_model, doc_type, crop, region, lang,
      search_vector
    )
    VALUES ${placeholders.join(', ')}
  `;

  const result = await pool.query(query, values);
  return result.rowCount ?? 0;
}

/**
 * Delete vectors for a file — used for re-ingest. Cascades via node_id.
 */
export async function deleteVectorsByFileId(fileId: string): Promise<number> {
  const result = await pool.query(
    `DELETE FROM vectors 
     WHERE node_id IN (SELECT id FROM nodes WHERE file_id = $1)`,
    [fileId]
  );
  return result.rowCount ?? 0;
}

/**
 * Build vector insert records from nodes + their summaries + their embeddings.
 */
export function buildVectorInserts(
  nodes: NodeRecord[],
  summaries: string[],
  embeddings: number[][]
): VectorInsert[] {
  if (nodes.length !== summaries.length || nodes.length !== embeddings.length) {
    throw new Error(
      `Length mismatch: nodes=${nodes.length}, summaries=${summaries.length}, embeddings=${embeddings.length}`
    );
  }
  return nodes.map((node, i) => ({
    node_id: node.id,
    summary: summaries[i],
    embedding: embeddings[i],
    source: node.source,
    page: node.page,
    type: node.type,
    product_model: node.product_model,
    doc_type: node.doc_type,
    crop: node.crop,
    region: node.region,
    lang: node.lang,
  }));
}