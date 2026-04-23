import Redis from 'ioredis';
import { config } from '../config';

// BullMQ requires maxRetriesPerRequest: null for blocking operations (workers).
export function createRedisConnection() {
  return new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    maxRetriesPerRequest: null,
  });
}