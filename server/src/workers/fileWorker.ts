import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { FILE_QUEUE_NAME, FileJobData } from '../queues/fileQueue';
import { getFileById, updateFileStatus } from '../db/files';
import { downloadFromS3 } from '../lib/storage';
import { parsePdf } from '../ingestion/llamaparse';
import { chunkMarkdown } from '../ingestion/chunker';
import { extractMetadataForNodes } from '../ingestion/metadata';
import { insertNodes, deleteNodesByFileId, updateFileProductModels } from '../db/nodes';
import { config } from '../config';
import { summarizeNodes } from '../ingestion/summarizer';
import { embedDocuments } from '../ingestion/embedder';
import { insertVectors, deleteVectorsByFileId, buildVectorInserts } from '../db/vectors';

console.log(`File worker starting (env: ${config.NODE_ENV})`);

function limitMarkdownPages(markdown: string, maxPages?: number): string {
  if (!maxPages) return markdown;
  const pages = markdown.split(/^---\s*$/m).map((page) => page.trim()).filter(Boolean);
  return pages.slice(0, maxPages).join('\n\n---\n\n');
}

const worker = new Worker<FileJobData>(
  FILE_QUEUE_NAME,
  async (job: Job<FileJobData>) => {
    const { fileId, storageKey, originalName } = job.data;
    console.log(`\n[${job.id}] Processing: ${originalName}`);

    try {
      // Guard: was the file deleted while this job was queued?
      const existingFile = await getFileById(fileId);
      if (!existingFile) {
        console.warn(`[${job.id}] File ${fileId} no longer exists in DB, skipping`);
        return { fileId, status: 'skipped', reason: 'file_deleted' };
      }

      await updateFileStatus(fileId, 'parsing');

      // 1. Download
      console.log(`[${job.id}] Downloading from S3...`);
      const buffer = await downloadFromS3(storageKey);
      console.log(`[${job.id}]   ${buffer.length} bytes downloaded`);

      // 2. Parse
      console.log(`[${job.id}] Parsing with LlamaParse...`);
      const parsed = await parsePdf({
        buffer,
        filename: originalName,
        maxPages: config.INGEST_MAX_PAGES,
      });
      const markdown = limitMarkdownPages(parsed.markdown, config.INGEST_MAX_PAGES);
      const pageCount = config.INGEST_MAX_PAGES
        ? Math.min(parsed.pageCount, config.INGEST_MAX_PAGES)
        : parsed.pageCount;
      console.log(`[${job.id}]   ${pageCount} pages, ${markdown.length} chars`);

      // 3. Chunk
      console.log(`[${job.id}] Chunking...`);
      const chunks = chunkMarkdown(markdown);
      const typeBreakdown = chunks.reduce<Record<string, number>>((acc, c) => {
        acc[c.type] = (acc[c.type] ?? 0) + 1;
        return acc;
      }, {});
      console.log(`[${job.id}]   ${chunks.length} nodes:`, typeBreakdown);

      if (chunks.length === 0) {
        throw new Error('Chunker produced no nodes');
      }

      // 4. Metadata
      console.log(`[${job.id}] Extracting metadata...`);
      const firstPageContent = markdown.split(/^---\s*$/m)[0];
      const tMeta = Date.now();
      const metadata = await extractMetadataForNodes(chunks, {
        filename: originalName,
        firstPageContent,
      });
      console.log(`[${job.id}]   metadata in ${Date.now() - tMeta}ms`);

      // 5. Clear any prior state
      await deleteVectorsByFileId(fileId);
      const deleted = await deleteNodesByFileId(fileId);
      if (deleted > 0) {
        console.log(`[${job.id}]   (cleared ${deleted} existing nodes)`);
      }

      // Re-verify file still exists before writes (in case of mid-job deletion)
      const stillExists = await getFileById(fileId);
      if (!stillExists) {
        console.warn(`[${job.id}] File ${fileId} deleted during processing, abandoning`);
        return { fileId, status: 'abandoned', reason: 'file_deleted_mid_job' };
      }

      // 6. Insert nodes
      console.log(`[${job.id}] Saving nodes...`);
      const inserted = await insertNodes(fileId, originalName, chunks, metadata);
      console.log(`[${job.id}]   ${inserted.length} nodes inserted`);

      // 7. Summarize
      console.log(`[${job.id}] Generating retrieval summaries...`);
      const tSum = Date.now();
      const summaries = await summarizeNodes(
        chunks,
        metadata,
        originalName,
        config.SUMMARY_CONCURRENCY,
        config.SUMMARY_DELAY_MS
      );
      console.log(`[${job.id}]   summaries in ${Date.now() - tSum}ms`);

      // 8. Embed
      console.log(`[${job.id}] Embedding with Voyage-3...`);
      const tEmb = Date.now();
      const embeddings = await embedDocuments(summaries);
      console.log(
        `[${job.id}]   ${embeddings.length} x ${embeddings[0]?.length ?? 0}-dim vectors in ${Date.now() - tEmb}ms`
      );

      // 9. Insert vectors
      console.log(`[${job.id}] Saving vectors...`);
      const vecCount = await insertVectors(buildVectorInserts(inserted, summaries, embeddings));
      console.log(`[${job.id}]   ${vecCount} vectors inserted`);

      // 10. Roll up + finalize
      await updateFileProductModels(fileId);
      await updateFileStatus(fileId, 'ready');
      console.log(`[${job.id}] ✓ Completed: ${originalName}\n`);

      return {
        fileId,
        status: 'ready',
        pageCount,
        nodeCount: inserted.length,
        vectorCount: vecCount,
        typeBreakdown,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${job.id}] ✗ Failed:`, message);
      if (err instanceof Error && err.stack) console.error(err.stack);
      await updateFileStatus(fileId, 'failed', message);
      throw err;
    }
  },
  {
    connection: createRedisConnection(),
    concurrency: 1,
    lockDuration: 10 * 60 * 1000,
    lockRenewTime: 5 * 60 * 1000,
    stalledInterval: 30 * 1000,
  }
);

worker.on('completed', (job) => {
  console.log(`[${job.id}] BullMQ completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[${job?.id}] BullMQ failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});