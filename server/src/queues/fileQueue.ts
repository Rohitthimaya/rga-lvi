import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis';

export interface FileJobData {
  fileId: string;
  storageKey: string;
  storageUrl: string;
  originalName: string;
  mimeType: string;
}

export const FILE_QUEUE_NAME = 'file-processing';

export const fileQueue = new Queue<FileJobData>(FILE_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600, // keep completed jobs 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // keep failed jobs 7 days for debugging
    },
  },
});

export async function enqueueFileJob(data: FileJobData) {
  const job = await fileQueue.add('process-file', data, {
    jobId: data.fileId, // ensures idempotency — re-enqueueing same fileId is a no-op
  });
  return job.id;
}