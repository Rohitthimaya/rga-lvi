export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

/**
 * Retry an async function with exponential backoff.
 * Respects Anthropic-style `retry-after` headers when present.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 30000;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;

      const status = err?.status ?? err?.statusCode;
      const code = err?.code;
      const message = typeof err?.message === 'string' ? err.message : '';
      const isRetryable =
        status === 429 || // rate limit
        status === 529 || // overloaded
        (typeof status === 'number' && status >= 500) || // server errors
        message.includes('Status code: 429') ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNRESET';

      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }

      // Honor Retry-After header if present (in seconds)
      let delay = baseDelay * Math.pow(2, attempt - 1);
      const retryAfter = err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after'];
      if (retryAfter) {
        const seconds = parseInt(String(retryAfter), 10);
        if (!Number.isNaN(seconds)) delay = Math.max(delay, seconds * 1000);
      }
      delay = Math.min(delay, maxDelay);
      // Add jitter to avoid thundering herd
      delay = delay + Math.random() * 500;

      opts.onRetry?.(attempt, err, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}
