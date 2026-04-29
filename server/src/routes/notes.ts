import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/client';

const router = Router();

const CreateNoteSchema = z.object({
  session_id: z.string().min(1),
  note_text: z.string().min(1),
  crop: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  image_url: z.string().min(1).optional(),
});

router.post('/notes', async (req: Request, res: Response) => {
  const parsed = CreateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
  }

  const { session_id, note_text, crop, region, image_url } = parsed.data;
  const result = await pool.query<{ id: string; created_at: Date }>(
    `
      INSERT INTO farmer_notes (session_id, note_text, crop, region, image_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at
    `,
    [session_id, note_text, crop ?? null, region ?? null, image_url ?? null]
  );

  res.status(201).json(result.rows[0]);
});

router.get('/notes/:session_id', async (req: Request, res: Response) => {
  const sessionId = req.params.session_id;
  if (!sessionId) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  const result = await pool.query(
    `
      SELECT id, session_id, note_text, crop, region, image_url, created_at
      FROM farmer_notes
      WHERE session_id = $1
      ORDER BY created_at DESC
    `,
    [sessionId]
  );

  res.json({ notes: result.rows });
});

export default router;
