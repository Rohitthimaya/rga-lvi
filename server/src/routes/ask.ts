import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { hybridSearch, hybridSearchDiversifiedByProductModel } from '../retrieval/hybrid';
import { rerank } from '../retrieval/rerank';
import { fetchNodesForGeneration } from '../retrieval/fetchNodes';
import { streamAnswerToSSE } from '../generation/generateStream';
import { insertQueryLog } from '../db/queries';
import { insertFarmerQueryLog } from '../db/farmerQueries';
import { pool } from '../db/client';
import { isLangfuseEnabled } from '../observability/langfuse';
import { verifyAnswer } from '../generation/verifyAnswer';
import { findMentionedProductModels } from '../retrieval/productModelMentions';

const router = Router();

const BodySchema = z.object({
  query: z.string().min(1),
  crop: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  image_url: z.string().min(1).optional(),
  voice_url: z.string().min(1).optional(),
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

function sseHeaders(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // If behind proxies, disable buffering.
  res.setHeader('X-Accel-Buffering', 'no');
}

function isNonTechnicalSmallTalk(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  // Very short greetings / pleasantries.
  const compact = q.replace(/[^a-z0-9]+/g, ' ').trim();
  const words = compact.split(/\s+/).filter(Boolean);
  const joined = words.join(' ');

  const greetings = new Set([
    'hi',
    'hello',
    'hey',
    'yo',
    'sup',
    'good morning',
    'good afternoon',
    'good evening',
    'thanks',
    'thank you',
    'thx',
  ]);

  if (greetings.has(joined)) return true;
  if (words.length <= 2 && greetings.has(words[0] ?? '')) return true;

  // If it contains obvious agriculture intent, treat as a real question.
  const hasDigits = /[0-9]/.test(q);
  const hasQuestionMark = q.includes('?');
  const technicalHints = [
    'blueberry',
    'apple',
    'cherry',
    'grape',
    'raspberry',
    'strawberry',
    'cranberry',
    'peach',
    'pear',
    'disease',
    'pest',
    'spray',
    'pesticide',
    'fungicide',
    'fertilizer',
    'nutrient',
    'soil',
    'irrigation',
    'water',
    'leaf',
    'leaves',
    'fruit',
    'crop',
    'organic',
    'agristability',
    'agriinvest',
    'insurance',
  ];
  const hasTechHint = technicalHints.some((t) => q.includes(t));

  if (hasDigits || hasQuestionMark || hasTechHint) return false;

  // Short non-question messages that don't look technical.
  return words.length <= 6;
}

async function checkCorpusCoverage(
  query: string,
  db: Pool
): Promise<{ supported: boolean; crop: string | null; message?: string }> {
  const cropKeywords: Record<string, string[]> = {
    blueberry: ['blueberry', 'blueberries', 'highbush', 'lowbush'],
    apple: ['apple', 'apples', 'cider'],
    cherry: ['cherry', 'cherries'],
    grape: ['grape', 'grapes', 'vineyard', 'wine'],
    raspberry: ['raspberry', 'raspberries'],
    strawberry: ['strawberry', 'strawberries'],
    cranberry: ['cranberry', 'cranberries'],
    peach: ['peach', 'peaches', 'nectarine'],
    pear: ['pear', 'pears'],
  };

  const queryLower = query.toLowerCase();
  let detectedCrop: string | null = null;

  for (const [crop, keywords] of Object.entries(cropKeywords)) {
    if (keywords.some((kw) => queryLower.includes(kw))) {
      detectedCrop = crop;
      break;
    }
  }

  if (!detectedCrop) {
    return { supported: true, crop: null };
  }

  const result = await db.query('SELECT status FROM corpus_registry WHERE crop = $1', [detectedCrop]);

  if (!result.rows.length || result.rows[0].status !== 'active') {
    return {
      supported: false,
      crop: detectedCrop,
      message:
        `I don't have BC Ministry documents for ${detectedCrop} yet - we're adding more crops soon. ` +
        `I can currently help with blueberry, apple, cherry, grape, and general BC regulations. ` +
        `For ${detectedCrop} questions, contact AgriService BC at 1-888-221-7141.`,
    };
  }

  return { supported: true, crop: detectedCrop };
}

function getSessionId(req: Request): string | null {
  const header = req.header('x-session-id');
  if (header) return header;
  const cookie = req.header('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)session_id=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

router.post('/ask', async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
  }

  const { query, crop, region, image_url, voice_url } = parsed.data;
  const filters = {
    ...(parsed.data.filters ?? {}),
    ...(crop ? { crop } : {}),
    ...(region ? { region } : {}),
  };
  const sessionId = getSessionId(req);
  const hadImage = Boolean(image_url);
  const hadVoice = Boolean(voice_url);

  sseHeaders(res);
  res.write(`event: open\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  try {
    const t0 = Date.now();
    const startObservation = isLangfuseEnabled()
      ? (await import('@langfuse/tracing')).startObservation
      : null;

    const root = startObservation
      ? startObservation(
          'ask',
          {
            input: { query, filters: filters ?? {} },
            metadata: { endpoint: '/ask' },
          },
          { asType: 'chain' }
        )
      : null;

    if (isNonTechnicalSmallTalk(query)) {
      const answer =
        `Hello! I'm AICanGrow Bot, your BC agriculture advisor.\n\n` +
        `Ask me a crop, pest, disease, soil, irrigation, spray, or BC program question, ` +
        `and I'll answer with citations from BC Ministry documents.`;

      res.write(`event: retrieval_complete\ndata: ${JSON.stringify({ retrieved_count: 0, citations: [] })}\n\n`);
      res.write(`event: token\ndata: ${JSON.stringify({ text: answer })}\n\n`);

      root?.update({ output: { skipped_retrieval: true, reason: 'non_technical_smalltalk' } });
      root?.end();

      const row = await insertQueryLog({
        query,
        rewritten_query: null,
        retrieved_node_ids: [],
        reranked_node_ids: [],
        answer,
        trace_id: root?.traceId ?? null,
      });
      await insertFarmerQueryLog({
        session_id: sessionId,
        query,
        crop_detected: crop ?? null,
        region_detected: region ?? null,
        had_image: hadImage,
        had_voice: hadVoice,
        answer_verified: true,
        chunks_used: 0,
        response_ms: Date.now() - t0,
      });

      res.write(
        `event: done\ndata: ${JSON.stringify({
          queryId: row.id,
          traceId: root?.traceId ?? null,
          answer,
          verified: true,
          verify_reason: null,
          total_time_ms: Date.now() - t0,
        })}\n\n`
      );
      res.end();
      return;
    }

    const coverage = await checkCorpusCoverage(crop ? `${crop} ${query}` : query, pool);
    if (!coverage.supported) {
      const answer = coverage.message ?? 'This crop is not currently supported.';

      res.write(`event: retrieval_complete\ndata: ${JSON.stringify({ retrieved_count: 0, citations: [] })}\n\n`);
      res.write(`event: token\ndata: ${JSON.stringify({ text: answer })}\n\n`);

      root?.update({ output: { skipped_retrieval: true, reason: 'unsupported_crop', crop: coverage.crop } });
      root?.end();

      const row = await insertFarmerQueryLog({
        session_id: sessionId,
        query,
        crop_detected: coverage.crop,
        region_detected: region ?? null,
        had_image: hadImage,
        had_voice: hadVoice,
        answer_verified: true,
        chunks_used: 0,
        response_ms: Date.now() - t0,
      });

      res.write(
        `event: done\ndata: ${JSON.stringify({
          queryId: row.id,
          traceId: root?.traceId ?? null,
          answer,
          verified: true,
          verify_reason: null,
          total_time_ms: Date.now() - t0,
        })}\n\n`
      );
      res.end();
      return;
    }

    const retrievalObs = root?.startObservation(
      'retrieve',
      { input: { query, filters: filters ?? {}, k: 20 } },
      { asType: 'retriever' }
    );
    const mentionedModels =
      filters.product_model ? [] : await findMentionedProductModels(query, { maxMentions: 4 });
    const candidates =
      mentionedModels.length >= 2
        ? await hybridSearchDiversifiedByProductModel(query, mentionedModels, filters, 20)
        : await hybridSearch(query, filters, 20);
    retrievalObs?.update({
      output: {
        candidate_count: candidates.length,
        candidate_node_ids: candidates.map((c) => c.node_id),
        mentioned_models: mentionedModels,
      },
    });
    retrievalObs?.end();

    const rerankObs = root?.startObservation(
      'rerank',
      { input: { query, candidates: candidates.map((c) => c.node_id), topN: 5 } },
      { asType: 'tool' }
    );
    const reranked = await rerank(query, candidates, 5);
    rerankObs?.update({
      output: { reranked_node_ids: reranked.map((r) => r.node_id), scores: reranked.map((r) => r.relevance_score) },
    });
    rerankObs?.end();

    const nodeIds = reranked.map((r) => r.node_id);

    const fetchObs = root?.startObservation(
      'fetch_nodes',
      { input: { nodeIds } },
      { asType: 'tool' }
    );
    const nodes = await fetchNodesForGeneration(nodeIds);
    fetchObs?.update({ output: { fetched_count: nodes.length } });
    fetchObs?.end();

    const citations = nodes.map((n) => ({ source: n.source, page: n.page, section: n.section }));
    res.write(
      `event: retrieval_complete\ndata: ${JSON.stringify({ retrieved_count: nodes.length, citations })}\n\n`
    );

    const genObs = root?.startObservation(
      'generate',
      {
        model: 'claude-sonnet-4-6',
        input: [{ role: 'user', content: query }],
        metadata: { max_tokens: 1024, context_nodes: nodes.length },
      },
      { asType: 'generation' }
    );
    const { fullText, usage } = await streamAnswerToSSE({
      res,
      query,
      contextNodes: nodes,
      imageUrl: image_url,
      maxTokens: 1024,
    });
    genObs?.update({
      output: { answer: fullText },
      ...(usage
        ? {
            usageDetails: {
              input: usage.input_tokens,
              output: usage.output_tokens,
              total: usage.input_tokens + usage.output_tokens,
            },
          }
        : {}),
    });
    genObs?.end();

    const verifyObs = root?.startObservation(
      'verify',
      { input: { query, answer_preview: fullText.slice(0, 300) } },
      { asType: 'evaluator' }
    );
    const verify = await verifyAnswer({ query, answer: fullText, contextNodes: nodes });
    verifyObs?.update({ output: verify });
    verifyObs?.end();

    const verified = verify.verified;
    const verify_reason = verify.reason ?? null;

    root?.update({ output: { verified, verify_reason } });
    root?.end();

    const row = await insertQueryLog({
      query,
      rewritten_query: null,
      retrieved_node_ids: candidates.map((c) => c.node_id),
      reranked_node_ids: nodeIds,
      answer: fullText,
      trace_id: root?.traceId ?? null,
    });
    const farmerRow = await insertFarmerQueryLog({
      session_id: sessionId,
      query,
      crop_detected: coverage.crop ?? crop ?? filters.crop ?? null,
      region_detected: region ?? filters.region ?? null,
      had_image: hadImage,
      had_voice: hadVoice,
      answer_verified: verified,
      chunks_used: nodes.length,
      response_ms: Date.now() - t0,
    });

    res.write(
      `event: done\ndata: ${JSON.stringify({
        queryId: row.id,
        farmerQueryId: farmerRow.id,
        traceId: root?.traceId ?? null,
        answer: fullText,
        verified,
        verify_reason,
        total_time_ms: Date.now() - t0,
      })}\n\n`
    );
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

export default router;

