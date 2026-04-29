import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { hybridSearch, hybridSearchDiversifiedByProductModel } from '../retrieval/hybrid';
import { rerank } from '../retrieval/rerank';
import { findMentionedProductModels } from '../retrieval/productModelMentions';

const router = Router();

const BodySchema = z.object({
  query: z.string().min(1),
  k: z.coerce.number().int().min(1).max(100).optional(),
  topN: z.coerce.number().int().min(1).max(20).optional(),
  filters: z
    .object({
      product_model: z.string().min(1).optional(),
      doc_type: z.string().min(1).optional(),
      crop: z.string().min(1).optional(),
      region: z.string().min(1).optional(),
      lang: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      source: z.string().min(1).optional(),
    })
    .optional(),
});

router.post('/search', async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
  }

  const { query, filters, k, topN } = parsed.data;
  const mentionedModels =
    filters?.product_model ? [] : await findMentionedProductModels(query, { maxMentions: 4 });
  const candidates =
    mentionedModels.length >= 2
      ? await hybridSearchDiversifiedByProductModel(query, mentionedModels, filters ?? {}, k ?? 20)
      : await hybridSearch(query, filters ?? {}, k ?? 20);
  const reranked = await rerank(query, candidates, topN ?? 5);

  res.json({
    query,
    k: k ?? 20,
    topN: topN ?? 5,
    filters: filters ?? {},
    mentionedModels,
    candidates,
    reranked,
  });
});

export default router;

