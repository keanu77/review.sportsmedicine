import test from 'node:test';
import assert from 'node:assert/strict';
import { privateApi, fetchArtifact } from '../../src/privateApi.ts';
import { logoutPrivateSession } from '../../src/draftRecovery.ts';

test('logout aborts in-flight requests, rejects late responses and prevents any new private fetch', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { setTimeout }, configurable: true });
  let resolveResponse!: (response: Response) => void;
  let requestSignal!: AbortSignal;
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++; requestSignal = options!.signal as AbortSignal;
    return new Promise<Response>(resolve => { resolveResponse = resolve; });
  };
  try {
    const pending = privateApi('/jobs', { method: 'POST', body: { input: 'private input' } });
    const rejection = assert.rejects(pending, { name: 'AbortError' });
    logoutPrivateSession();
    assert.equal(requestSignal.aborted, true, 'logout cancels transport immediately');
    resolveResponse(new Response(JSON.stringify({ jobs: ['late private response'] }), { headers: { 'Content-Type': 'application/json' } }));
    await rejection;
    await assert.rejects(() => privateApi('/session'), { name: 'AbortError' });
    await assert.rejects(() => fetchArtifact('job', { id: 'file' } as any), { name: 'AbortError' });
    assert.equal(requests, 1, 'locked documents never start another request');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete (globalThis as any).window;
  }
});
