import type { Response } from 'express';
import type { NodeRecord } from '../db/nodes';
import { anthropic, MODELS } from '../lib/anthropic';

export function buildGroundedPrompt(query: string, contextNodes: NodeRecord[]) {
  const system = `You are a technical assistant for R2 Gaming / LVI field technicians installing networking equipment.

Answer ONLY from the provided context.

Every factual claim — especially torque values, dimensions, part numbers, LED meanings, and safety procedures — must cite the source as [filename, page X].

If the context doesn't contain the answer, say:
"I don't have that information in the manuals. Please check with your supervisor or escalate to engineering."

Never guess. Never extrapolate a torque value or part number.

If the question involves electrical safety, grounding, or lifting loads, include the exact safety warnings from the manual verbatim.`;

  const context = contextNodes
    .map((n) => {
      const section = n.section ?? '(unknown section)';
      const figs = n.figure_refs?.length ? `; figure_refs: ${n.figure_refs.join(', ')}` : '';
      return `---\n[source: ${n.source}, page ${n.page}, section: ${section}${figs}]\n${n.content}\n`;
    })
    .join('\n');

  const user = `Question:\n${query}\n\nContext:\n${context}`;
  return { system, user };
}

export async function streamAnswerToSSE(params: {
  res: Response;
  query: string;
  contextNodes: NodeRecord[];
  maxTokens?: number;
}): Promise<{ fullText: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const { system, user } = buildGroundedPrompt(params.query, params.contextNodes);
  const stream = anthropic.messages.stream({
    model: MODELS.SONNET,
    max_tokens: params.maxTokens ?? 1024,
    system,
    messages: [{ role: 'user', content: user }],
  });

  let full = '';

  stream.on('text', (delta) => {
    full += delta;
    params.res.write(`event: token\ndata: ${JSON.stringify({ text: delta })}\n\n`);
  });

  const msg = await stream.finalMessage();
  const usage =
    (msg as any)?.usage && typeof (msg as any).usage.input_tokens === 'number'
      ? { input_tokens: (msg as any).usage.input_tokens, output_tokens: (msg as any).usage.output_tokens ?? 0 }
      : undefined;

  return { fullText: full.trim(), usage };
}

