import { pool } from '../db/client';
import type { NodeRecord } from '../db/nodes';

export async function fetchNodesForGeneration(nodeIds: string[]): Promise<NodeRecord[]> {
  if (nodeIds.length === 0) return [];

  const result = await pool.query<NodeRecord>(
    `
      SELECT *
      FROM nodes
      WHERE id = ANY($1::uuid[])
      ORDER BY array_position($1::uuid[], id)
    `,
    [nodeIds]
  );

  return result.rows;
}

