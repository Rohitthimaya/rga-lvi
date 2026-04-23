import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { hybridSearch, hybridSearchDiversifiedByProductModel } from '../retrieval/hybrid';
import { rerank } from '../retrieval/rerank';
import { fetchNodesForGeneration } from '../retrieval/fetchNodes';
import { streamAnswerToSSE } from '../generation/generateStream';
import { insertQueryLog } from '../db/queries';
import { isLangfuseEnabled } from '../observability/langfuse';
import { verifyAnswer } from '../generation/verifyAnswer';
import { findMentionedProductModels } from '../retrieval/productModelMentions';

const router = Router();

const BodySchema = z.object({
  query: z.string().min(1),
  filters: z
    .object({
      product_model: z.string().min(1).optional(),
      doc_type: z.string().min(1).optional(),
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

  // If it contains obvious technical intent, treat as a real question.
  const hasDigits = /[0-9]/.test(q);
  const hasQuestionMark = q.includes('?');
  const technicalHints = [
    'install',
    'installation',
    'mount',
    'setup',
    'configure',
    'configuration',
    'troubleshoot',
    'troubleshooting',
    'error',
    'alarm',
    'fault',
    'led',
    'indicator',
    'torque',
    'spec',
    'specification',
    'wiring',
    'power',
    'voltage',
    'reset',
    'factory',
    'box contents',
    'what comes in',
    'contents',
  ];
  const hasTechHint = technicalHints.some((t) => q.includes(t));

  if (hasDigits || hasQuestionMark || hasTechHint) return false;

  // Short non-question messages that don't look technical.
  return words.length <= 6;
}

router.post('/ask', async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten().fieldErrors });
  }

  const { query, filters } = parsed.data;

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
        `Hello! I’m your R2 Gaming / LVI technical assistant.\n\n` +
        `Ask me an installation or troubleshooting question (include the product model if you can), ` +
        `and I’ll answer with citations from the manuals.`;

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
      filters?.product_model ? [] : await findMentionedProductModels(query, { maxMentions: 4 });
    const candidates =
      mentionedModels.length >= 2
        ? await hybridSearchDiversifiedByProductModel(query, mentionedModels, filters ?? {}, 20)
        : await hybridSearch(query, filters ?? {}, 20);
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
    const { fullText, usage } = await streamAnswerToSSE({ res, query, contextNodes: nodes, maxTokens: 1024 });
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

    res.write(
      `event: done\ndata: ${JSON.stringify({
        queryId: row.id,
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

