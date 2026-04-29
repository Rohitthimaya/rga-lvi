import { anthropic, MODELS } from '../lib/anthropic';
import { config } from '../config';
import { retryWithBackoff } from '../lib/retry';
import type { ChunkNode } from './chunker';
import type { NodeMetadata } from './metadata';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSummaryPrompts(node: ChunkNode, metadata: NodeMetadata, source: string) {
  const systemPrompt = `You compress BC Ministry of Agriculture document chunks into dense retrieval summaries for farmer advisory search.

Requirements:
- 1-3 sentences, under 80 words total
- Lead with the crop, region, and action/topic when known
- Include concrete disease, pest, nutrient, irrigation, spray timing, rate, pre-harvest interval, and regulatory terms
- Include key words a BC farmer would search for: diagnose, manage, spray, nutrient, irrigation, disease, pest, regulation
- For image/diagram nodes: describe what the figure shows and which components are visible
- For tables: describe what the table indexes, including crops, pests, rates, timings, and page-specific guidance
- No boilerplate, no filler phrases, no marketing language
- Preserve exact pesticide names, rates, intervals, dates, measurements, and program names — never paraphrase these

Output ONLY the summary text. No preamble, no quotes.`;

  const userPrompt = `Source: ${source}
Crop: ${metadata.crop}
Region: ${metadata.region}
Document type: ${metadata.doc_type}
Page: ${node.page}
Section: ${metadata.section}
Type: ${node.type}
${metadata.has_spray_advice ? 'Contains spray or pesticide advice.\n' : ''}${metadata.has_regulatory_info ? 'Contains regulatory information.\n' : ''}
Content:
"""
${node.content.slice(0, 3000)}
"""`;

  return { systemPrompt, userPrompt };
}

function fallbackSummary(node: ChunkNode, metadata: NodeMetadata, source: string): string {
  const parts = [
    `Source: ${source}`,
    `Crop: ${metadata.crop ?? 'unknown'}`,
    `Region: ${metadata.region ?? 'unknown'}`,
    `Document type: ${metadata.doc_type ?? 'unknown'}`,
    `Page: ${node.page}`,
    metadata.section ? `Section: ${metadata.section}` : null,
    metadata.has_spray_advice ? 'Contains spray or pesticide advice.' : null,
    metadata.has_regulatory_info ? 'Contains regulatory information.' : null,
    `Content: ${node.content.replace(/\s+/g, ' ').trim().slice(0, 700)}`,
  ].filter(Boolean);

  return parts.join(' ');
}

async function summarizeNodeWithAnthropic(
  node: ChunkNode,
  metadata: NodeMetadata,
  source: string
): Promise<string> {
  const { systemPrompt, userPrompt } = buildSummaryPrompts(node, metadata, source);

  const response = await retryWithBackoff(
    () =>
      anthropic.messages.create({
        model: MODELS.HAIKU,
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    {
      maxAttempts: config.SUMMARY_MAX_ATTEMPTS,
      maxDelayMs: config.SUMMARY_RETRY_MAX_DELAY_MS,
      onRetry: (attempt, _err, delay) => {
        console.log(`  summary retry #${attempt} after ${Math.round(delay)}ms`);
      },
    }
  );

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Anthropic summarizer returned no text');
  }
  return textBlock.text.trim();
}

async function summarizeNodeWithGemini(
  node: ChunkNode,
  metadata: NodeMetadata,
  source: string
): Promise<string> {
  if (!config.GEMINI_API_KEY) {
    throw new Error('SUMMARY_MODE=gemini requires GEMINI_API_KEY');
  }

  const { systemPrompt, userPrompt } = buildSummaryPrompts(node, metadata, source);
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(config.GEMINI_SUMMARY_MODEL)}:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY)}`;

  const response = await retryWithBackoff(
    async () => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 200,
          },
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        const err = new Error(`Gemini summary failed (${resp.status}): ${text}`) as Error & {
          status?: number;
          headers?: Headers;
        };
        err.status = resp.status;
        err.headers = resp.headers;
        throw err;
      }

      return (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
    },
    {
      maxAttempts: config.SUMMARY_MAX_ATTEMPTS,
      maxDelayMs: config.SUMMARY_RETRY_MAX_DELAY_MS,
      onRetry: (attempt, _err, delay) => {
        console.log(`  Gemini summary retry #${attempt} after ${Math.round(delay)}ms`);
      },
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) {
    throw new Error('Gemini summarizer returned no text');
  }
  return text;
}

/**
 * Generate a retrieval-oriented summary of a chunk.
 * The summary is what we embed (and also what BM25 searches), not the raw chunk.
 */
export async function summarizeNode(
  node: ChunkNode,
  metadata: NodeMetadata,
  source: string
): Promise<string> {
  if (config.SUMMARY_MODE === 'fallback') {
    return fallbackSummary(node, metadata, source);
  }
  if (config.SUMMARY_MODE === 'gemini') {
    return summarizeNodeWithGemini(node, metadata, source);
  }
  return summarizeNodeWithAnthropic(node, metadata, source);
}

/**
 * Batch-summarize nodes in parallel.
 */
export async function summarizeNodes(
  nodes: ChunkNode[],
  metadata: NodeMetadata[],
  source: string,
  concurrency = 3,
  delayMs = 0
): Promise<string[]> {
  const summaries: string[] = new Array(nodes.length);
  let index = 0;

  const worker = async () => {
    while (index < nodes.length) {
      const i = index++;
      try {
        summaries[i] = await summarizeNode(nodes[i], metadata[i], source);
        if (delayMs > 0 && index < nodes.length) {
          await sleep(delayMs);
        }
      } catch (err) {
        console.error(`Summary failed for node ${i}:`, err);
        // Fallback: use deterministic metadata + raw content.
        // Still searchable, just less optimized.
        summaries[i] = fallbackSummary(nodes[i], metadata[i], source);
      }
    }
  };

  await Promise.all(Array(concurrency).fill(null).map(() => worker()));
  return summaries;
}