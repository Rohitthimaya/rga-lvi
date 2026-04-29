import { initLangfuse } from './observability/langfuse';
void initLangfuse();

import express, { Request, Response } from 'express';
import { config } from './config';
import { testConnection, checkExtensions } from './db/client';
import { testS3Connection } from './lib/storage';
import { createRedisConnection } from './lib/redis';
import uploadRouter from './routes/upload';
import searchRouter from './routes/search';
import askRouter from './routes/ask';
import feedbackRouter from './routes/feedback';
import queriesRouter from './routes/queries';
import notesRouter from './routes/notes';

const app = express();

const redis = createRedisConnection();
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err.message));

app.use(express.json());

app.get('/health', async (_req: Request, res: Response) => {
  const health: Record<string, any> = {
    status: 'ok',
    service: 'aicangrow-rag',
    timestamp: new Date().toISOString(),
  };

  try {
    const pong = await redis.ping();
    health.redis = pong === 'PONG' ? 'connected' : 'unhealthy';
  } catch {
    health.redis = 'disconnected';
    health.status = 'degraded';
  }

  const dbCheck = await testConnection();
  if (dbCheck.ok) {
    health.postgres = 'connected';
    const extensions = await checkExtensions();
    health.extensions = extensions;
  } else {
    health.postgres = 'disconnected';
    health.status = 'degraded';
  }

  const s3Check = await testS3Connection();
  if (s3Check.ok) {
    health.s3 = 'connected';
    health.s3_bucket = s3Check.bucket;
  } else {
    health.s3 = 'disconnected';
    health.s3_error = s3Check.error;
    health.status = 'degraded';
  }

  res.json(health);
});

app.use('/', uploadRouter);
app.use('/', searchRouter);
app.use('/', askRouter);
app.use('/', feedbackRouter);
app.use('/', queriesRouter);
app.use('/', notesRouter);
app.use('/api', uploadRouter);
app.use('/api', searchRouter);
app.use('/api', askRouter);
app.use('/api', feedbackRouter);
app.use('/api', queriesRouter);
app.use('/api', notesRouter);

app.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  console.log(`Health check: http://localhost:${config.PORT}/health`);
});