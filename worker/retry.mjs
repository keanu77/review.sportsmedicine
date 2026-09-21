import { setTimeout as delay } from 'node:timers/promises';

export function transient(error) {
  return [408,429,500,502,503,504].includes(error?.status) || ['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENOTFOUND','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error?.code ?? error?.cause?.code) || (error?.name === 'TimeoutError') || (error?.name === 'TypeError' && /fetch failed/i.test(error.message));
}
// Only use for reads and uploads with a stable idempotency key, never model invocations/claims.
export async function retryTransfer(action, { signal, attempts = 3, wait = delay } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    try { return await action(); }
    catch (error) { if (signal?.aborted || attempt + 1 >= attempts || !transient(error)) throw error; await wait(500 * 2 ** attempt, undefined, { signal }); }
  }
}
