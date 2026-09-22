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

async function withStorage(run: (local: MemoryStorage, session: MemoryStorage) => Promise<void>) {
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const local = new MemoryStorage(), session = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  try { await run(local, session); }
  finally {
    if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal); else delete (globalThis as any).localStorage;
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession); else delete (globalThis as any).sessionStorage;
  }
}

test('explicit logout clears every private owner draft and session pointer while preserving public storage', async () => withStorage(async (local, session) => {
  const recovery = await import('../../src/draftRecovery.ts?document=logout');
  recovery.writeRecovery('owner', 'job', snapshot as any, true);
  recovery.writeRecovery('other-owner', 'job', snapshot as any, true);
  local.setItem('favorites', '["public-paper"]'); session.setItem('recent', 'public-paper');
  assert.equal(typeof recovery.logoutPrivateSession, 'function', 'logout must revoke recovery writes before clearing storage');
  assert.equal(recovery.logoutPrivateSession(), null);
  assert.equal(Object.keys(local).filter(key => key.startsWith('review:private-draft:')).length, 0);
  assert.equal(Object.keys(session).filter(key => key.startsWith('review:private-draft:')).length, 0);
  recovery.writeRecovery('owner', 'job', snapshot as any, true);
  assert.equal(Object.keys(local).filter(key => key.startsWith('review:private-draft:')).length, 0, 'effect cleanup cannot recreate cleared drafts');
  assert.equal(local.getItem('favorites'), '["public-paper"]'); assert.equal(session.getItem('recent'), 'public-paper');
}));

test('an old suspended document cannot read or rewrite drafts after another document logs out', async () => withStorage(async (local, session) => {
  const stale = await import('../../src/draftRecovery.ts?document=suspended');
  stale.writeRecovery('owner', 'job', snapshot as any, true);
  const loggingOut = await import('../../src/draftRecovery.ts?document=active-logout');
  assert.equal(typeof loggingOut.logoutPrivateSession, 'function');
  loggingOut.logoutPrivateSession();
  assert.equal(stale.readRecovery('owner', 'job').snapshot, undefined);
  stale.writeRecovery('owner', 'job', snapshot as any, true);
  assert.equal(Object.keys(local).filter(key => key.startsWith('review:private-draft:')).length, 0);
  assert.equal(Object.keys(session).filter(key => key.startsWith('review:private-draft:')).length, 0);
  const signedIn = await import('../../src/draftRecovery.ts?document=new-signin');
  assert.equal(signedIn.writeRecovery('owner', 'new-job', snapshot as any, true), null, 'a new document may recover drafts in a fresh session');
  assert.equal(signedIn.readRecovery('owner', 'new-job').snapshot?.draft?.post, 'draft B');
}));

test('entry cleanup expires private recoveries for all owners but retains unexpired crash copies and public data', async () => withStorage(async (local, session) => {
  const oldKey = 'review:private-draft:v1:other-owner:old:document';
  const freshKey = 'review:private-draft:v1:owner:fresh:document';
  local.setItem(oldKey, JSON.stringify({ ...snapshot, savedAt: Date.now() - 8 * 86400000 }));
  local.setItem(freshKey, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  session.setItem('review:private-draft:v1:other-owner:old:', oldKey);
  local.setItem('favorites', 'public');
  const recovery = await import('../../src/draftRecovery.ts?document=cleanup');
  assert.equal(typeof recovery.clearExpiredRecoveries, 'function');
  recovery.clearExpiredRecoveries();
  assert.equal(local.getItem(oldKey), null); assert.equal(session.getItem('review:private-draft:v1:other-owner:old:'), null);
  assert.ok(local.getItem(freshKey)); assert.equal(local.getItem('favorites'), 'public');
}));

test('entry cleanup preserves a clean-tab pointer so reload does not revive another tab draft', async () => withStorage(async (local, session) => {
  const old = await import('../../src/draftRecovery.ts?document=old-copy');
  old.writeRecovery('owner', 'job', snapshot as any, true);
  const clean = await import('../../src/draftRecovery.ts?document=clean-copy');
  clean.writeRecovery('owner', 'job', snapshot as any, false);
  clean.clearExpiredRecoveries();
  const reload = await import('../../src/draftRecovery.ts?document=clean-after-entry');
  assert.equal(reload.readRecovery('owner', 'job').snapshot, undefined, 'clean marker must survive entry cleanup');
}));

test('logout between a recovery epoch check and storage write cannot leave a recreated draft', async () => withStorage(async (local, session) => {
  const writer = await import('../../src/draftRecovery.ts?document=racing-writer');
  const loggingOut = await import('../../src/draftRecovery.ts?document=racing-logout');
  const setItem = local.setItem.bind(local);
  let interrupted = false;
  local.setItem = (key, value) => {
    if (!interrupted && key.startsWith('review:private-draft:')) { interrupted = true; loggingOut.logoutPrivateSession(); }
    setItem(key, value);
  };
  writer.writeRecovery('owner', 'job', snapshot as any, true);
  assert.equal(interrupted, true);
  assert.equal(Object.keys(local).filter(key => key.startsWith('review:private-draft:')).length, 0);
  assert.equal(Object.keys(session).filter(key => key.startsWith('review:private-draft:')).length, 0);
}));

test('quota-full logout retries its durable epoch after clearing drafts and rejects a missed-event resumed writer', async () => withStorage(async (local, session) => {
  const stale = await import('../../src/draftRecovery.ts?document=quota-suspended');
  stale.writeRecovery('owner', 'job', snapshot as any, true);
  local.setItem('favorites', 'keep');
  const loggingOut = await import('../../src/draftRecovery.ts?document=quota-logout');
  const setItem = local.setItem.bind(local);
  let quotaFailures = 0;
  local.setItem = (key, value) => {
    if (key === 'review:private-logout:v1' && Object.keys(local).some(item => item.startsWith('review:private-draft:'))) {
      quotaFailures++; throw new DOMException('Storage full', 'QuotaExceededError');
    }
    setItem(key, value);
  };
  assert.equal(loggingOut.logoutPrivateSession(), null, 'cleanup frees enough space to persist the logout epoch');
  assert.equal(quotaFailures, 1);
  assert.ok(local.getItem('review:private-logout:v1'), 'successful logout must leave a durable tombstone');
  // No storage/BroadcastChannel event was delivered to this separate document.
  stale.writeRecovery('owner', 'job', snapshot as any, true);
  assert.equal(stale.isPrivateSessionActive(), false);
  assert.equal(Object.keys(local).filter(key => key.startsWith('review:private-draft:')).length, 0);
  assert.equal(Object.keys(session).filter(key => key.startsWith('review:private-draft:')).length, 0);
  assert.equal(local.getItem('favorites'), 'keep');
}));

test('logout reports failure when the durable epoch cannot be read back after cleanup', async () => withStorage(async (local) => {
  const loggingOut = await import('../../src/draftRecovery.ts?document=nonpersistent-logout');
  loggingOut.writeRecovery('owner', 'job', snapshot as any, true);
  const setItem = local.setItem.bind(local);
  local.setItem = (key, value) => { if (key !== 'review:private-logout:v1') setItem(key, value); };
  assert.match(loggingOut.logoutPrivateSession() || '', /瀏覽器未允許/);
  assert.equal(loggingOut.isPrivateSessionActive(), false);
}));

test('quota recovery also erases an old-tab write that finishes before the retried tombstone is persisted', async () => withStorage(async (local) => {
  const stale = await import('../../src/draftRecovery.ts?document=quota-gap-writer');
  stale.writeRecovery('owner', 'job', snapshot as any, true);
  const loggingOut = await import('../../src/draftRecovery.ts?document=quota-gap-logout');
  const setItem = local.setItem.bind(local);
  let attempts = 0;
  local.setItem = (key, value) => {
    if (key === 'review:private-logout:v1') {
      attempts++;
      if (attempts === 1) throw new DOMException('Storage full', 'QuotaExceededError');
      if (attempts === 2) stale.writeRecovery('owner', 'job', snapshot as any, true);
    }
    setItem(key, value);
  };
  assert.equal(loggingOut.logoutPrivateSession(), null);
  assert.equal(Object.keys(local).filter(key => key.startsWith('review:private-draft:')).length, 0, 'cleanup must also cover the quota-retry gap');
}));
