import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/client';

const router = Router();

const ListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get('/queries', async (req: Request, res: Response) => {
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten().fieldErrors });
  }

  const limit = parsed.data.limit ?? 50;
  const r = await pool.query(
    `
      SELECT id, query, rewritten_query, retrieved_node_ids, answer,
             feedback, feedback_note, trace_id, created_at
      FROM queries
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  res.json({ queries: r.rows });
});

export default router;

