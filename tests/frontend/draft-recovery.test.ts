import test from 'node:test';
import assert from 'node:assert/strict';
class MemoryStorage {
  getItem(key: string) { return Object.hasOwn(this, key) ? String((this as any)[key]) : null; }
  setItem(key: string, value: string) { Object.defineProperty(this, key, { value, writable: true, configurable: true, enumerable: true }); }
  removeItem(key: string) { delete (this as any)[key]; }
}
const snapshot = { draft: { post: 'draft B', igCaption: 'caption', notes: '', pages: [{ id: 'cover', layout: 'cover', title: 'title' }], claims: [] }, baseline: 'old', revision: 2,
  design: { palette: 'blue', style: 'clinical', imageStyle: 'none', format: 'square' }, designBaseline: '{}' };

test('duplicated sessionStorage never reuses another document recovery write key; clean reload stays clean', async () => {
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const local = new MemoryStorage(), firstSession = new MemoryStorage(), duplicateSession = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: firstSession, configurable: true });
  try {
    const first = await import('../../src/draftRecovery.ts?document=first');
    assert.equal(first.writeRecovery('owner', 'job', snapshot as any, true), null);
    for (const key of Object.keys(firstSession)) duplicateSession.setItem(key, firstSession.getItem(key)!);
    Object.defineProperty(globalThis, 'sessionStorage', { value: duplicateSession, configurable: true });
    const duplicate = await import('../../src/draftRecovery.ts?document=duplicate');
    assert.equal(duplicate.readRecovery('owner', 'job').snapshot?.draft?.post, 'draft B');
    duplicate.writeRecovery('owner', 'job', snapshot as any, false);
    const reload = await import('../../src/draftRecovery.ts?document=reload');
    assert.equal(reload.readRecovery('owner', 'job').snapshot, undefined, 'saved/clean duplicate does not revive unrelated older backups');
    Object.defineProperty(globalThis, 'sessionStorage', { value: firstSession, configurable: true });
    assert.equal(reload.readRecovery('owner', 'job').snapshot?.draft?.post, 'draft B', 'original tab keeps its unsaved recovery copy');
    assert.equal(reload.readRecovery('another-owner', 'job').snapshot, undefined);
  } finally {
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal); else delete (globalThis as any).localStorage;
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession); else delete (globalThis as any).sessionStorage;
  }
});
