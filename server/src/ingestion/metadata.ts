import type { ChunkNode } from './chunker';

export interface BCNodeMetadata {
  crop: string;
  region: string;
  doc_type: string;
  source_year: number;
  has_spray_advice: boolean;
  has_regulatory_info: boolean;
  corpus_version: string;
  section: string;
  page: number;
}

export type NodeMetadata = BCNodeMetadata;

const CROP_KEYWORDS: Array<[string, string[]]> = [
  ['blueberry', ['blueberry', 'blueberries', 'highbush']],
  ['apple', ['apple', 'apples', 'orchard']],
  ['cherry', ['cherry', 'cherries', 'sweet cherry']],
  ['grape', ['grape', 'grapes', 'vineyard', 'vinifera']],
  ['raspberry', ['raspberry', 'raspberries']],
  ['strawberry', ['strawberry', 'strawberries']],
  ['cranberry', ['cranberry', 'cranberries']],
  ['peach', ['peach', 'peaches', 'nectarine']],
  ['pear', ['pear', 'pears']],
  ['programs', ['agristability', 'agriinvest', 'crop insurance']],
  ['regulations', ['pesticide', 'spray', 'buffer zone']],
];

const REGION_KEYWORDS: Array<[string, string[]]> = [
  ['Fraser Valley', ['fraser valley', 'abbotsford', 'chilliwack', 'langley']],
  ['Okanagan', ['okanagan', 'kelowna', 'penticton', 'oliver', 'osoyoos']],
  ['Vancouver Island', ['vancouver island', 'victoria', 'nanaimo', 'cowichan']],
  ['Northern BC', ['northern bc', 'prince george', 'fort st john', 'fort st. john']],
];

const DOC_TYPE_KEYWORDS: Array<[string, string[]]> = [
  ['ipm', ['ipm', 'integrated pest', 'pest management']],
  ['pesticide', ['pesticide', 'spray guide', 'buffer', 'registration']],
  ['program', ['agristability', 'agriinvest', 'crop insurance', 'program']],
  ['soil_water', ['soil', 'nutrient', 'irrigation', 'water management']],
  ['certification', ['organic', 'certified organic']],
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function detectFromKeywords(text: string, entries: Array<[string, string[]]>, fallback: string): string {
  return entries.find(([, keywords]) => includesAny(text, keywords))?.[0] ?? fallback;
}

function detectSourceYear(text: string): number {
  const matches = [...text.matchAll(/\b(20[0-3]\d|19[8-9]\d)\b/g)].map((m) => Number(m[1]));
  return matches[0] ?? new Date().getFullYear();
}

/**
 * Extract BC agriculture metadata for a single chunk.
 */
export async function extractMetadata(
  node: ChunkNode,
  documentHint: { filename: string; firstPageContent?: string }
): Promise<NodeMetadata> {
  const searchableText = [
    documentHint.filename,
    documentHint.firstPageContent ?? '',
    node.section ?? '',
    node.content,
  ]
    .join('\n')
    .toLowerCase();

  const docType = detectFromKeywords(searchableText, DOC_TYPE_KEYWORDS, 'production_guide');
  const sprayTerms = ['spray', 'pesticide', 'fungicide', 'insecticide', 'herbicide', 'apply', 'application', 'rate', 'dosage'];
  const regulatoryTerms = [
    'registered',
    'registration',
    'pre-harvest interval',
    'preharvest interval',
    'phi',
    'buffer zone',
    'restricted',
    'banned',
    'approved',
    'legal',
  ];

  return {
    crop: detectFromKeywords(searchableText, CROP_KEYWORDS, 'general'),
    region: detectFromKeywords(searchableText, REGION_KEYWORDS, 'all'),
    doc_type: docType,
    source_year: detectSourceYear(searchableText),
    has_spray_advice: docType === 'ipm' || docType === 'pesticide' || includesAny(searchableText, sprayTerms),
    has_regulatory_info: includesAny(searchableText, regulatoryTerms),
    corpus_version: 'v1',
    section: node.section ?? 'Unknown',
    page: node.page,
  };
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
        // Fall back to safe defaults so pipeline doesn't halt.
        results[i] = {
          crop: 'general',
          region: 'all',
          doc_type: 'production_guide',
          source_year: new Date().getFullYear(),
          has_spray_advice: false,
          has_regulatory_info: false,
          corpus_version: 'v1',
          section: nodes[i].section ?? 'Unknown',
          page: nodes[i].page,
        };
      }
    }
  };

  await Promise.all(Array(concurrency).fill(null).map(() => worker()));
  return results;
}