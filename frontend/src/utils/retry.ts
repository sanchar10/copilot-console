/**
 * Retry a function with exponential backoff.
 * Stops on first success or after maxAttempts total attempts.
 * Delays: 2s, 4s, 8s (for default settings).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 4, initialDelayMs = 2000 }: { maxAttempts?: number; initialDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[retry] Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
