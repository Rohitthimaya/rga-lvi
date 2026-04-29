import type { Response } from 'express';
import type { NodeRecord } from '../db/nodes';
import { anthropic, MODELS } from '../lib/anthropic';
import { downloadFromS3 } from '../lib/storage';

const BC_AGRIBOT_SYSTEM_PROMPT = `You are BC AgriBot, an expert 
agricultural advisor specializing exclusively in British Columbia 
farming. You work for AICanGrow, helping BC farmers make better 
decisions using information from BC Ministry of Agriculture documents.

YOUR KNOWLEDGE COVERS:
- BC Ministry of Agriculture crop production guides
- BC Integrated Pest Management (IPM) guidelines
- BC-registered pesticides, spray timing, pre-harvest intervals, 
  and buffer zone requirements
- Fraser Valley crops: blueberry, raspberry, strawberry, cranberry
- Okanagan crops: apple, cherry, grape, peach, pear
- Vancouver Island: mixed vegetables and small farms
- BC AgriStability, AgriInvest, and crop insurance programs
- BC Certified Organic certification requirements
- BC soil and water management practices

STRICT RESPONSE RULES:
1. Answer ONLY from the BC Ministry document context provided below.
   Never use general agricultural knowledge not present in the context.
2. Never invent or guess pesticide names, dosages, registration 
   numbers, or pre-harvest intervals. If it is not in the context, 
   say so explicitly.
3. Always cite the source: "According to [document name], page [N]..."
4. If the answer is not in the provided context, respond with:
   "I don't have that specific information in my BC Ministry documents.
   I recommend contacting your local BC Ministry of Agriculture office 
   or calling AgriService BC at 1-888-221-7141."
5. Lead with the diagnosis or recommendation. Be concise.
   Farmers are busy - they need the answer first, details second.
6. For ANY spray or pesticide advice, always end with:
   "Always verify current registration status at the Health Canada 
   Pesticide Label database (pr-rp.hc-sc.gc.ca) before applying."
7. If an image is described or provided: identify what you see 
   first (disease, pest, soil condition, damage type), state your 
   confidence level, then advise.
8. If the image or query is unclear: ask ONE targeted clarifying 
   question. Never ask more than one question at a time.
9. After two rounds of clarification, give your best answer 
   with appropriate uncertainty noted.
10. The farmer's crop and region from their profile are provided 
    in the context - use this without asking again.

RESPONSE FORMAT:
- Start with a clear one-line diagnosis or direct answer
- Follow with 2-3 sentences of explanation
- List specific recommended actions (numbered)
- Cite source document(s)
- Add regulatory disclaimer if spray advice given

TONE: Friendly and direct. Like a knowledgeable BC agronomist 
who is your neighbor, not a corporate chatbot. Plain English only.`;

export function buildGroundedPrompt(query: string, contextNodes: NodeRecord[]) {
  const system = BC_AGRIBOT_SYSTEM_PROMPT;

  const context = contextNodes
    .map((n) => {
      const section = n.section ?? '(unknown section)';
      const figs = n.figure_refs?.length ? `; figure_refs: ${n.figure_refs.join(', ')}` : '';
      return (
        `---\n[source: ${n.source}, page ${n.page}, section: ${section}, ` +
        `crop: ${n.crop ?? 'general'}, region: ${n.region ?? 'all'}, doc_type: ${n.doc_type ?? 'general'}${figs}]\n` +
        `${n.content}\n`
      );
    })
    .join('\n');

  const user = `Question:\n${query}\n\nContext:\n${context}`;
  return { system, user };
}

function parseS3Key(url: string): string | null {
  if (!url.startsWith('s3://')) return null;
  const withoutScheme = url.slice('s3://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) return null;
  return withoutScheme.slice(slashIndex + 1);
}

function mediaTypeFromKey(key: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function buildImageBlock(imageUrl?: string) {
  if (!imageUrl) return null;
  const key = parseS3Key(imageUrl);
  if (!key) {
    throw new Error('Unsupported image_url. Upload the image through /api/images first.');
  }

  const buffer = await downloadFromS3(key);
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: mediaTypeFromKey(key),
      data: buffer.toString('base64'),
    },
  };
}

export async function streamAnswerToSSE(params: {
  res: Response;
  query: string;
  contextNodes: NodeRecord[];
  imageUrl?: string;
  maxTokens?: number;
}): Promise<{ fullText: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const { system, user } = buildGroundedPrompt(params.query, params.contextNodes);
  const imageBlock = await buildImageBlock(params.imageUrl);
  const content = imageBlock
    ? [
        imageBlock,
        {
          type: 'text' as const,
          text:
            `${user}\n\nFarmer image instruction:\n` +
            `Use the attached image only to describe visible symptoms or damage. ` +
            `Do not diagnose beyond what the BC Ministry context supports; state uncertainty when needed.`,
        },
      ]
    : user;
  const stream = anthropic.messages.stream({
    model: MODELS.SONNET,
    max_tokens: params.maxTokens ?? 1024,
    system,
    messages: [{ role: 'user', content }],
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

