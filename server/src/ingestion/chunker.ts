import { encoding_for_model } from 'tiktoken';

export type NodeType = 'text' | 'table' | 'image' | 'procedure';

export interface ChunkNode {
  type: NodeType;
  content: string;
  page: number;
  section?: string;
  figureRefs: string[];
  tokenCount: number;
}

const MAX_TOKENS = 512;
const OVERLAP_TOKENS = 64;
const MIN_CONTENT_CHARS = 80;        // skip stubs
const FIGURE_CONTEXT_WINDOW = 200;   // chars to scan around a match for figure refs

const TABLE_REGEX = /<table[\s\S]*?<\/table>/gi;
const IMAGE_CAPTION_REGEX = /(?:^|\n)(The image (?:shows|depicts|displays|illustrates)[^\n]+)/gi;
const FIGURE_REF_REGEX = /\bFigure\s+\d+[a-z]?(?:-\d+)?\b/gi;
const STEP_LINE_REGEX = /^\s*(?:(?:\d+[a-z]?(?:[-.]\d+)?[.)]?)|(?:Step\s+\d+))\s/i;

// Headings that are actually safety/warning labels, not real section titles.
const WARNING_HEADING_PATTERNS = [
  /^CAUTION!?/i,
  /^WARNING!?/i,
  /^NOTE:?/i,
  /^DANGER!?/i,
];

function countTokens(text: string): number {
  const enc = encoding_for_model('gpt-4');
  const tokens = enc.encode(text);
  enc.free();
  return tokens.length;
}

function extractFigureRefs(text: string): string[] {
  const matches = text.match(FIGURE_REF_REGEX) || [];
  return Array.from(new Set(matches.map((m) => m.trim())));
}

/**
 * Extract figure refs from the node's content PLUS a window of surrounding
 * context in the source page. This catches cases where an image caption doesn't
 * literally say "Figure 1" but the text just above/below does.
 */
function extractFigureRefsWithContext(
  nodeContent: string,
  pageContent: string
): string[] {
  const direct = extractFigureRefs(nodeContent);
  const idx = pageContent.indexOf(nodeContent.slice(0, 60));
  if (idx < 0) return direct;

  const start = Math.max(0, idx - FIGURE_CONTEXT_WINDOW);
  const end = Math.min(pageContent.length, idx + nodeContent.length + FIGURE_CONTEXT_WINDOW);
  const windowed = pageContent.slice(start, end);
  const windowedRefs = extractFigureRefs(windowed);

  return Array.from(new Set([...direct, ...windowedRefs]));
}

/**
 * Find the most relevant section heading before a position. Skips warning
 * labels like "CAUTION!" — prefers actual section titles.
 */
function findSection(markdown: string, beforeIndex: number): string | undefined {
  const before = markdown.slice(0, beforeIndex);
  const regex = /^#{1,4}\s+(.+)$/gm;
  const headings: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(before)) !== null) {
    headings.push(match[1].trim());
  }

  // Walk backwards through headings, skip warning-like ones
  for (let i = headings.length - 1; i >= 0; i--) {
    const h = headings[i];
    const isWarning = WARNING_HEADING_PATTERNS.some((p) => p.test(h));
    if (!isWarning) return h;
  }

  // All headings we found were warnings — return the nearest one anyway
  return headings[headings.length - 1];
}

function splitIntoPages(markdown: string): string[] {
  const pages = markdown.split(/^---\s*$/m);
  return pages.map((p) => p.trim()).filter((p) => p.length > 0);
}

function extractTables(pageContent: string): { tables: string[]; remaining: string } {
  const tables: string[] = [];
  const remaining = pageContent.replace(TABLE_REGEX, (match) => {
    tables.push(match);
    return `\n[TABLE_PLACEHOLDER_${tables.length - 1}]\n`;
  });
  return { tables, remaining };
}

function extractImageCaptions(content: string): string[] {
  const captions: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(IMAGE_CAPTION_REGEX.source, 'gi');
  while ((match = regex.exec(content)) !== null) {
    captions.push(match[1].trim());
  }
  return captions;
}

/**
 * Heading lines that introduce a procedure but don't contain steps themselves.
 * E.g., "Drywall Installation Procedures:" — the numbered steps come after.
 * We'll remove these from the text pass since the procedure node already has context via its section.
 */
const PROCEDURE_INTRO_REGEX = /^[A-Z][\w\s()]+(?:Installation|Procedure|Instructions)[\w\s()]*:\s*$/gm;

function extractProcedures(text: string): { procedures: string[]; remaining: string } {
  const lines = text.split('\n');
  const procedures: string[] = [];
  const remainingLines: string[] = [];

  let currentProcedure: string[] = [];

  const flush = () => {
    if (currentProcedure.length >= 2) {
      procedures.push(currentProcedure.join('\n').trim());
    } else {
      remainingLines.push(...currentProcedure);
    }
    currentProcedure = [];
  };

  for (const line of lines) {
    if (STEP_LINE_REGEX.test(line)) {
      currentProcedure.push(line);
    } else if (currentProcedure.length > 0 && line.trim().length > 0 && !line.match(/^#/)) {
      currentProcedure[currentProcedure.length - 1] += '\n' + line;
    } else {
      flush();
      remainingLines.push(line);
    }
  }
  flush();

  return {
    procedures,
    remaining: remainingLines.join('\n'),
  };
}

function splitTextByTokens(text: string, maxTokens: number, overlap: number): string[] {
  if (countTokens(text) <= maxTokens) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let buffer = '';
  let bufferTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);

    if (paraTokens > maxTokens) {
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = '';
        bufferTokens = 0;
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      let sentBuffer = '';
      let sentTokens = 0;
      for (const sent of sentences) {
        const sTok = countTokens(sent);
        if (sentTokens + sTok > maxTokens && sentBuffer) {
          chunks.push(sentBuffer.trim());
          sentBuffer = sent;
          sentTokens = sTok;
        } else {
          sentBuffer = sentBuffer ? sentBuffer + ' ' + sent : sent;
          sentTokens += sTok;
        }
      }
      if (sentBuffer) chunks.push(sentBuffer.trim());
      continue;
    }

    if (bufferTokens + paraTokens > maxTokens) {
      chunks.push(buffer.trim());
      const tail = buffer.split(/\s+/).slice(-overlap).join(' ');
      buffer = tail + '\n\n' + para;
      bufferTokens = countTokens(buffer);
    } else {
      buffer = buffer ? buffer + '\n\n' + para : para;
      bufferTokens += paraTokens;
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

/**
 * Test whether a text chunk is actually meaningful (not just orphaned headings).
 */
function isMeaningfulText(content: string): boolean {
    const trimmed = content.trim();
    if (trimmed.length < MIN_CONTENT_CHARS) return false;
  
    // Count sentences — content that's just labels or fragments won't have periods/colons followed by space.
    const sentenceCount = (trimmed.match(/[.!?:]\s+/g) || []).length;
    if (sentenceCount < 2) return false;
  
    const lines = trimmed.split('\n');
    const meaningfulLines = lines.filter((l) => {
      const t = l.trim();
      return t.length >= 20 && !/^[-*_]{3,}\s*$/.test(t);
    });
  
    return meaningfulLines.length >= 2;
  }

export function chunkMarkdown(markdown: string): ChunkNode[] {
  const pages = splitIntoPages(markdown);
  const nodes: ChunkNode[] = [];

  pages.forEach((pageContent, idx) => {
    const pageNumber = idx + 1;

    // 1. Tables
    const { tables, remaining: afterTables } = extractTables(pageContent);
    tables.forEach((table) => {
      nodes.push({
        type: 'table',
        content: table,
        page: pageNumber,
        section: findSection(pageContent, pageContent.indexOf(table)),
        figureRefs: extractFigureRefsWithContext(table, pageContent),
        tokenCount: countTokens(table),
      });
    });

    // 2. Image captions
    const captions = extractImageCaptions(afterTables);
    captions.forEach((caption) => {
      nodes.push({
        type: 'image',
        content: caption,
        page: pageNumber,
        section: findSection(pageContent, pageContent.indexOf(caption)),
        figureRefs: extractFigureRefsWithContext(caption, pageContent),
        tokenCount: countTokens(caption),
      });
    });

    // 3. Strip captions, table placeholders, and procedure-intro lines
    let cleanedText = afterTables
    .replace(IMAGE_CAPTION_REGEX, '')
    .replace(/\[TABLE_PLACEHOLDER_\d+\]/g, '')
    .replace(PROCEDURE_INTRO_REGEX, '')
    // Strip standalone markdown headings (keep their content only as section metadata)
    .replace(/^#{1,6}\s+.+$/gm, '')
    // Strip "Figure N: Caption" lines that LlamaParse renders as headings
    .replace(/^Figure\s+\d+[a-z]?:.*$/gm, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n');

    // 4. Procedures
    const { procedures, remaining: proseText } = extractProcedures(cleanedText);
    procedures.forEach((proc) => {
      const firstLine = proc.split('\n')[0];
      nodes.push({
        type: 'procedure',
        content: proc,
        page: pageNumber,
        section: findSection(pageContent, pageContent.indexOf(firstLine)),
        figureRefs: extractFigureRefsWithContext(proc, pageContent),
        tokenCount: countTokens(proc),
      });
    });

    // 5. Remaining prose
    const cleanProse = proseText.trim();
    if (cleanProse.length > 0) {
      const textChunks = splitTextByTokens(cleanProse, MAX_TOKENS, OVERLAP_TOKENS);
      textChunks.forEach((chunk) => {
        if (!isMeaningfulText(chunk)) return;
        nodes.push({
          type: 'text',
          content: chunk,
          page: pageNumber,
          section: findSection(pageContent, pageContent.indexOf(chunk.slice(0, 50))),
          figureRefs: extractFigureRefsWithContext(chunk, pageContent),
          tokenCount: countTokens(chunk),
        });
      });
    }
  });

  return nodes;
}