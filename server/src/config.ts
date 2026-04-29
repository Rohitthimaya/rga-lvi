import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// When running as a workspace, process.cwd() is usually `server/`, but our env
// lives at the repo root. Load repo-root `.env` explicitly, with a fallback to
// `server/.env` for overrides if present.
const rootEnvPath = path.resolve(__dirname, '../../.env');
const serverEnvPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(rootEnvPath)) dotenv.config({ path: rootEnvPath });
if (fs.existsSync(serverEnvPath)) dotenv.config({ path: serverEnvPath, override: true });

const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),

  // Postgres
  DATABASE_URL: z.string().url(),

  // AWS S3
  AWS_REGION: z.string().default('us-west-2'),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  S3_BUCKET: z.string(),

  // API keys (we'll use these in later steps, so add them as optional for now)
  ANTHROPIC_API_KEY: z.string(),
  VOYAGE_API_KEY: z.string(),
  COHERE_API_KEY: z.string().optional(),
  LLAMA_CLOUD_API_KEY: z.string(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_SUMMARY_MODEL: z.string().default('gemini-2.5-flash'),

  // Langfuse (optional observability)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),

  // Ingestion throttles for free-tier/local indexing.
  INGEST_MAX_PAGES: z.coerce.number().int().positive().optional(),
  SUMMARY_MODE: z.enum(['anthropic', 'gemini', 'fallback']).default('anthropic'),
  SUMMARY_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SUMMARY_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  SUMMARY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  SUMMARY_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(65000),
  VOYAGE_EMBED_BATCH_SIZE: z.coerce.number().int().positive().default(128),
  VOYAGE_EMBED_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  VOYAGE_EMBED_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
});

function loadConfig() {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
export type Config = z.infer<typeof ConfigSchema>;