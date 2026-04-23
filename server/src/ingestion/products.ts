/**
 * Known product identifiers in the corpus. This list is a hint to the metadata
 * extractor — Haiku can still detect unknown products, but listing known ones
 * helps disambiguation (e.g., MG52 vs MG52E) and lowers hallucination risk.
 *
 * Adding a new product: just add it here. No other code changes required.
 */
export const KNOWN_PRODUCTS: string[] = [
  // Cisco Meraki
  'MG52',
  'MG52E',
  'CW9162',

  // Chief
  'FSM-4100',

  // Peerless
  'PT640',

  // Opti-UPS Enhance Series
  'ES550C',
  'ES800C',
  'ES1000C',
  'ES1500C',
  'ES1000C-RM',
  'ES1500C-RM',

  // Epson
  'TM-T70II-DT',
];
