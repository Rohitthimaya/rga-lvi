import { anthropic, MODELS } from '../lib/anthropic';
import { retryWithBackoff } from '../lib/retry';
import type { ChunkNode } from './chunker';
import type { NodeMetadata } from './metadata';

/**
 * Generate a retrieval-oriented summary of a chunk.
 * The summary is what we embed (and also what BM25 searches), not the raw chunk.
 */
export async function summarizeNode(
  node: ChunkNode,
  metadata: NodeMetadata,
  source: string
): Promise<string> {
  const systemPrompt = `You compress chunks of technical installation manuals into dense retrieval summaries.

Requirements:
- 1-3 sentences, under 80 words total
- Lead with the specific product model and the action/topic
- Include concrete specifications: sizes, torque values, dimensions, part numbers, LED colors, voltage
- Include key verbs a technician would search for: mount, install, configure, ground, troubleshoot
- For image/diagram nodes: describe what the figure shows and which components are visible
- For tables: describe what the table indexes (e.g., "LED status table: solid orange = no dashboard connection, purple = cellular connected")
- No boilerplate, no filler phrases, no marketing language
- Preserve exact model numbers, part numbers, and measurements — never paraphrase these

Output ONLY the summary text. No preamble, no quotes.`;

  const userPrompt = `Source: ${source}
Product: ${metadata.product_model ?? 'unknown'}
Page: ${node.page}
Section: ${metadata.section}
Type: ${node.type}
${metadata.has_safety_warning ? 'Contains safety warnings.\n' : ''}${metadata.has_torque_spec ? 'Contains torque/load specifications.\n' : ''}
Content:
"""
${node.content.slice(0, 3000)}
"""`;

  const response = await retryWithBackoff(
    () =>
      anthropic.messages.create({
        model: MODELS.HAIKU,
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    {
      onRetry: (attempt, _err, delay) => {
        console.log(`  summary retry #${attempt} after ${Math.round(delay)}ms`);
      },
    }
  );

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Summarizer returned no text');
  }
  return textBlock.text.trim();
}

/**
 * Batch-summarize nodes in parallel.
 */
export async function summarizeNodes(
  nodes: ChunkNode[],
  metadata: NodeMetadata[],
  source: string,
  concurrency = 3
): Promise<string[]> {
  const summaries: string[] = new Array(nodes.length);
  let index = 0;

  const worker = async () => {
    while (index < nodes.length) {
      const i = index++;
      try {
        summaries[i] = await summarizeNode(nodes[i], metadata[i], source);
      } catch (err) {
        console.error(`Summary failed for node ${i}:`, err);
        // Fallback: use a truncated slice of the raw content.
        // Still searchable, just less optimized.
        summaries[i] = nodes[i].content.slice(0, 300);
      }
    }
  };

  await Promise.all(Array(concurrency).fill(null).map(() => worker()));
  return summaries;
}