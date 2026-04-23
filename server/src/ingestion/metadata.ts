import { z } from 'zod';
import { anthropic, MODELS } from '../lib/anthropic';
import { retryWithBackoff } from '../lib/retry';
import type { ChunkNode } from './chunker';
import { KNOWN_PRODUCTS } from './products';

// Common doc types (used as hints to the LLM, not a strict enum).
// The actual doc_type field accepts any lowercase-hyphenated string.
const SUGGESTED_DOC_TYPES = [
  'installation',
  'specifications',
  'troubleshooting',
  'safety',
  'warranty',
  'overview',
  'configuration',
  'setup',
  'quick-start',
  'user-guide',
  'maintenance',
  'reference',
] as const;

export const MetadataSchema = z.object({
  product_model: z.string().nullable(),
  doc_type: z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase-hyphenated'),
  section: z.string(),
  has_safety_warning: z.boolean(),
  has_torque_spec: z.boolean(),
  lang: z.string().default('en'),
});

export type NodeMetadata = z.infer<typeof MetadataSchema>;

// Anthropic tool definition — forces structured JSON output via tool use
const EXTRACT_TOOL = {
  name: 'extract_metadata',
  description: 'Extract structured metadata from a technical manual chunk.',
  input_schema: {
    type: 'object' as const,
    properties: {
        product_model: {
            type: ['string', 'null'],
            description:
              'The specific product model this chunk refers to. ' +
              'Use the exact model identifier as it appears in the text (e.g., "MG52", "MG52E", "CW9162", "PT640", "FSM-4100", "ES800C", "TM-T70II-DT"). ' +
              'Known models in this corpus include: ' + KNOWN_PRODUCTS.join(', ') + '. ' +
              'You may also return other product models not in this list if they appear in the content. ' +
              'Prefer the most specific variant (e.g., "MG52E" over "MG52" if the chunk is specifically about MG52E). ' +
              'Use null only if the chunk is purely generic boilerplate (warranty, FCC notices, disposal instructions) that applies to no specific product.',
          },
      doc_type: {
        type: 'string',
        description:
          'The type of content this chunk represents, as a lowercase-hyphenated string. ' +
          'Common values: ' + SUGGESTED_DOC_TYPES.join(', ') + '. ' +
          'You may use others if they better describe the chunk (e.g., "wiring", "api-reference", "changelog").',
      },
      section: {
        type: 'string',
        description:
          'A short (2-5 word) section title describing what this chunk is about. ' +
          'Examples: "Mounting Hardware", "LED Status Indicators", "Drywall Installation", ' +
          '"Power Requirements". Be specific, not generic.',
      },
      has_safety_warning: {
        type: 'boolean',
        description:
          'True if the chunk contains safety warnings, cautions, dangers, ' +
          'or electrical/mechanical hazard information.',
      },
      has_torque_spec: {
        type: 'boolean',
        description:
          'True if the chunk contains torque specifications, ' +
          'weight limits, or mechanical force values.',
      },
      lang: {
        type: 'string',
        description: 'ISO 639-1 language code of the content (e.g., "en", "es", "fr").',
      },
    },
    required: [
      'product_model',
      'doc_type',
      'section',
      'has_safety_warning',
      'has_torque_spec',
      'lang',
    ],
  },
};

/**
 * Extract metadata for a single chunk. Uses Claude Haiku with tool calling
 * to guarantee structured output.
 */
export async function extractMetadata(
  node: ChunkNode,
  documentHint: { filename: string; firstPageContent?: string }
): Promise<NodeMetadata> {
  const systemPrompt = `You analyze chunks from technical installation manuals and extract metadata.

Known products in this corpus:
${KNOWN_PRODUCTS.map((p) => `- ${p}`).join('\n')}

Rules:
- If the chunk mentions a specific product model by name, use that exact string as product_model — verbatim, preserving case and hyphens.
- Known models include the list above, but you can return other models you find in the content (e.g., Epson printer models, new Cisco products).
- If the chunk mentions multiple specific variants (e.g., "MG52 and MG52E"), pick the more specific one or the primary subject.
- If the chunk is pure boilerplate (generic warranty, FCC notice, safety disclaimer), use null.
- Section should be a concrete noun phrase (e.g., "Antenna Installation"), not a sentence or warning label.
- Only set has_safety_warning=true for actual hazard information, not general notes.
- Always call the extract_metadata tool. Do not respond with plain text.`;

  const userPrompt = `Source document: ${documentHint.filename}
${
  documentHint.firstPageContent
    ? `\nFirst page context (for product identification):\n${documentHint.firstPageContent.slice(0, 500)}\n`
    : ''
}
Chunk type: ${node.type}
Chunk page: ${node.page}
Chunk section (from parser): ${node.section ?? '(none)'}
Chunk content:
"""
${node.content.slice(0, 2000)}
"""`;

  const response = await retryWithBackoff(
    () =>
      anthropic.messages.create({
        model: MODELS.HAIKU,
        max_tokens: 512,
        system: systemPrompt,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'extract_metadata' },
        messages: [{ role: 'user', content: userPrompt }],
      }),
    {
      onRetry: (attempt, _err, delay) => {
        console.log(`  metadata retry #${attempt} after ${Math.round(delay)}ms`);
      },
    }
  );

  // Extract the tool use block
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not call the extract_metadata tool');
  }

  const parsed = MetadataSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `Metadata schema validation failed: ${JSON.stringify(parsed.error.flatten())}`
    );
  }

  return parsed.data;
}

/**
 * Batch-extract metadata for many nodes, with parallel control.
 */
export async function extractMetadataForNodes(
  nodes: ChunkNode[],
  documentHint: { filename: string; firstPageContent?: string },
  concurrency = 3
): Promise<NodeMetadata[]> {
  const results: NodeMetadata[] = new Array(nodes.length);
  let index = 0;

  const worker = async () => {
    while (index < nodes.length) {
      const i = index++;
      try {
        results[i] = await extractMetadata(nodes[i], documentHint);
      } catch (err) {
        console.error(`Metadata extraction failed for node ${i}:`, err);
        // Fall back to safe defaults so pipeline doesn't halt
        results[i] = {
          product_model: null,
          doc_type: 'installation',
          section: nodes[i].section ?? 'Unknown',
          has_safety_warning: false,
          has_torque_spec: false,
          lang: 'en',
        };
      }
    }
  };

  await Promise.all(Array(concurrency).fill(null).map(() => worker()));
  return results;
}