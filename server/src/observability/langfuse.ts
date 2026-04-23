import { config } from '../config';

let sdkStarted = false;
let client: any | null = null;

export function isLangfuseEnabled() {
  return Boolean(config.LANGFUSE_PUBLIC_KEY && config.LANGFUSE_SECRET_KEY);
}

export async function initLangfuse() {
  if (!isLangfuseEnabled() || sdkStarted) return;

  const [{ LangfuseSpanProcessor }, { NodeSDK }, { LangfuseClient }] = await Promise.all([
    import('@langfuse/otel'),
    import('@opentelemetry/sdk-node'),
    import('@langfuse/client'),
  ]);

  const processor = new LangfuseSpanProcessor({
    publicKey: config.LANGFUSE_PUBLIC_KEY!,
    secretKey: config.LANGFUSE_SECRET_KEY!,
    baseUrl: config.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    environment: config.NODE_ENV,
  });

  const sdk = new NodeSDK({
    spanProcessors: [processor],
  });

  sdk.start();
  sdkStarted = true;
  client = new LangfuseClient({
    publicKey: config.LANGFUSE_PUBLIC_KEY,
    secretKey: config.LANGFUSE_SECRET_KEY,
    baseUrl: config.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  });
}

export function getLangfuseClient(): any | null {
  return client;
}

