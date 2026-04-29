import { pool } from './client';

export async function insertFarmerQueryLog(params: {
  session_id?: string | null;
  query: string;
  crop_detected?: string | null;
  region_detected?: string | null;
  had_image?: boolean;
  had_voice?: boolean;
  answer_verified?: boolean | null;
  chunks_used?: number;
  response_ms?: number;
}): Promise<{ id: string }> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO farmer_queries (
        session_id, query, crop_detected, region_detected,
        had_image, had_voice, answer_verified, chunks_used, response_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      params.session_id ?? null,
      params.query,
      params.crop_detected ?? null,
      params.region_detected ?? null,
      params.had_image ?? false,
      params.had_voice ?? false,
      params.answer_verified ?? null,
      params.chunks_used ?? 0,
      params.response_ms ?? 0,
    ]
  );

  return result.rows[0];
}
