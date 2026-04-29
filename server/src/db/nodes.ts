import { pool } from './client';
import type { ChunkNode } from '../ingestion/chunker';
import type { NodeMetadata } from '../ingestion/metadata';

export interface NodeRecord {
  id: string;
  file_id: string;
  source: string;
  page: number;
  type: string;
  content: string;
  section: string | null;
  product_model: string | null;
  doc_type: string | null;
  has_safety_warning: boolean;
  has_torque_spec: boolean;
  crop: string | null;
  region: string | null;
  source_year: number | null;
  has_spray_advice: boolean;
  has_regulatory_info: boolean;
  corpus_version: string | null;
  figure_refs: string[] | null;
  lang: string;
  created_at: Date;
}

/**
 * Bulk insert nodes for a file. Returns the inserted rows (with generated IDs).
 * Uses a single SQL statement with multi-row VALUES for efficiency.
 */
export async function insertNodes(
  fileId: string,
  source: string,
  chunks: ChunkNode[],
  metadata: NodeMetadata[]
): Promise<NodeRecord[]> {
  if (chunks.length !== metadata.length) {
    throw new Error(
      `chunks.length (${chunks.length}) != metadata.length (${metadata.length})`
    );
  }
  if (chunks.length === 0) return [];

  const values: any[] = [];
  const placeholders: string[] = [];

  chunks.forEach((chunk, i) => {
    const m = metadata[i];
    const base = i * 17;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, ` +
        `$${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, ` +
        `$${base + 16}, $${base + 17})`
    );
    values.push(
      fileId,
      source,
      chunk.page,
      chunk.type,
      chunk.content,
      m.section,
      null,
      m.doc_type,
      false,
      false,
      m.crop,
      m.region,
      m.source_year,
      m.has_spray_advice,
      m.has_regulatory_info,
      m.corpus_version,
      chunk.figureRefs.length > 0 ? chunk.figureRefs : null
    );
  });

  const query = `
    INSERT INTO nodes (
      file_id, source, page, type, content,
      section, product_model, doc_type,
      has_safety_warning, has_torque_spec,
      crop, region, source_year,
      has_spray_advice, has_regulatory_info, corpus_version,
      figure_refs
    )
    VALUES ${placeholders.join(', ')}
    RETURNING *
  `;

  const result = await pool.query<NodeRecord>(query, values);
  return result.rows;
}

/**
 * Delete all nodes for a given file_id. Used when re-ingesting.
 */
export async function deleteNodesByFileId(fileId: string): Promise<number> {
  const result = await pool.query(`DELETE FROM nodes WHERE file_id = $1`, [fileId]);
  return result.rowCount ?? 0;
}

/**
 * Get all nodes for a file, ordered by page then insertion order.
 */
export async function getNodesByFileId(fileId: string): Promise<NodeRecord[]> {
  const result = await pool.query<NodeRecord>(
    `SELECT * FROM nodes WHERE file_id = $1 ORDER BY page, created_at`,
    [fileId]
  );
  return result.rows;
}

/**
 * Update a file's detected crop list based on what we found in nodes.
 */
export async function updateFileProductModels(fileId: string): Promise<void> {
  await pool.query(
    `UPDATE files 
     SET product_models = (
       SELECT array_agg(DISTINCT crop) 
       FROM nodes 
       WHERE file_id = $1 AND crop IS NOT NULL
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [fileId]
  );
}