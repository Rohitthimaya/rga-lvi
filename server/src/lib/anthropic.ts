import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

export const anthropic = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

export const MODELS = {
  // Primary generation model for answers
  SONNET: 'claude-sonnet-4-6',
  // Cheap/fast model for classification, metadata, summaries
  HAIKU: 'claude-haiku-4-5-20251001',
} as const;