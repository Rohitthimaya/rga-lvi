import { pool } from './client';

export type QueryFeedback = 'up' | 'down';

export async function insertQueryLog(params: {
  query: string;
  rewritten_query?: string | null;
  retrieved_node_ids: string[];
  reranked_node_ids: string[];
  answer: string;
  trace_id?: string | null;
}): Promise<{ id: string }> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO queries (query, rewritten_query, retrieved_node_ids, answer, trace_id)
      VALUES ($1, $2, $3::uuid[], $4, $5)
      RETURNING id
    `,
    [params.query, params.rewritten_query ?? null, params.reranked_node_ids, params.answer, params.trace_id ?? null]
  );
  return result.rows[0];
}

export async function updateFeedback(params: {
  queryId: string;
  feedback: QueryFeedback;
  note?: string | null;
}): Promise<void> {
  await pool.query(
    `
      UPDATE queries
      SET feedback = $2,
          feedback_note = $3
      WHERE id = $1
    `,
    [params.queryId, params.feedback, params.note ?? null]
  );
}

export async function getQueryTraceId(queryId: string): Promise<string | null> {
  const r = await pool.query<{ trace_id: string | null }>(`SELECT trace_id FROM queries WHERE id = $1`, [
    queryId,
  ]);
  return r.rows[0]?.trace_id ?? null;
}

