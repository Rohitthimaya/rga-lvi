import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getLangfuseClient, isLangfuseEnabled } from '../observability/langfuse';
import { getQueryTraceId, updateFeedback } from '../db/queries';

const router = Router();

const BodySchema = z.object({
  queryId: z.string().uuid(),
  feedback: z.enum(['up', 'down']),
  note: z.string().optional(),
});

router.post('/feedback', async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
  }

  const { queryId, feedback, note } = parsed.data;
  await updateFeedback({ queryId, feedback, note: note ?? null });

  if (isLangfuseEnabled()) {
    const traceId = await getQueryTraceId(queryId);
    const langfuse = getLangfuseClient();
    if (traceId && langfuse) {
      langfuse.score.create({
        traceId,
        name: 'user-feedback',
        value: feedback === 'up' ? 1 : 0,
        comment: note,
      });
    }
  }

  res.json({ ok: true });
});

export default router;

