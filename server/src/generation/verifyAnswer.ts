import { z } from 'zod';
import { anthropic, MODELS } from '../lib/anthropic';
import type { NodeRecord } from '../db/nodes';
import { retryWithBackoff } from '../lib/retry';

const VerifyOutSchema = z.object({
  verified: z.boolean(),
  reason: z.string().nullable(),
});

const TOOL = {
  name: 'verify_answer',
  description: 'Verify grounding, citations, and consistency with context.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verified: { type: 'boolean' },
      reason: {
        type: ['string', 'null'],
        description: 'If not verified, a short reason (missing citations, contradicts context, etc).',
      },
    },
    required: ['verified', 'reason'],
  },
};

export async function verifyAnswer(params: {
  query: string;
  answer: string;
  contextNodes: NodeRecord[];
}): Promise<{ verified: boolean; reason?: string }> {
  const context = params.contextNodes
    .map((n) => `[${n.source}, page ${n.page}, section: ${n.section ?? '(unknown)'}]\n${n.content}`)
    .join('\n\n---\n\n');

  const system = `You are a strict verifier for a RAG assistant.

Check that:
- The answer uses ONLY the provided context.
- Every factual claim has an inline citation like [filename, page X].
- If spray or pesticide advice is involved, the answer includes the Health Canada Pesticide Label database disclaimer.
- No hallucinated pesticide names, rates, pre-harvest intervals, registration status, program rules, or regulatory requirements.

Always call the tool.`;

  const user = `Question:\n${params.query}\n\nAnswer:\n${params.answer}\n\nContext:\n${context}`;

  const resp = await retryWithBackoff(() =>
    anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 256,
      system,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: user }],
    })
  );

  const toolUse = resp.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Verifier did not call the tool');
  }

  const parsed = VerifyOutSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`Verifier output invalid: ${parsed.error.message}`);
  }

  return {
    verified: parsed.data.verified,
    reason: parsed.data.reason ?? undefined,
  };
}

