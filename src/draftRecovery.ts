import type { Design, Draft } from '../shared/contracts';

export type EditorSnapshot = { draft: Draft | null; baseline: string; revision: number; design: Design; designBaseline: string; pendingSave?: boolean };
const PREFIX = 'review:private-draft:v1:';
const PRIVATE_PREFIX = 'review:private-draft:';
const LOGOUT_KEY = 'review:private-logout:v1';
const TTL = 7 * 24 * 60 * 60 * 1000;
const readEpoch = () => { try { return localStorage.getItem(LOGOUT_KEY); } catch { return undefined; } };
// Captured once per document, never refreshed on resume or after logout. A new
// authenticated document gets a new baseline; an old/BFCache document stays locked.
const documentEpoch = readEpoch();
let locked = false;
const lockListeners = new Set<() => void>();
function clearPrivateStorage(storage: Storage) {
  for (const key of Object.keys(storage)) if (key.startsWith(PRIVATE_PREFIX)) storage.removeItem(key);
}
function lockPrivateSession() {
  if (locked) return;
  locked = true;
  try { clearPrivateStorage(sessionStorage); } catch { /* Reported by explicit logout; writes are already blocked. */ }
  for (const listener of [...lockListeners]) listener();
}
export function isPrivateSessionActive(): boolean {
  if (!locked && documentEpoch !== readEpoch()) lockPrivateSession();
  return !locked;
}
export function onPrivateSessionLock(listener: () => void): () => void {
  lockListeners.add(listener);
  if (!isPrivateSessionActive()) listener();
  return () => { lockListeners.delete(listener); };
}
export function watchPrivateSession(listener: () => void): () => void {
  const unsubscribe = onPrivateSessionLock(listener);
  const check = () => { isPrivateSessionActive(); };
  const storage = (event: StorageEvent) => { if (event.key === LOGOUT_KEY || event.key === null) check(); };
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOGOUT_KEY);
  if (channel) channel.onmessage = () => lockPrivateSession();
  window.addEventListener('storage', storage);
  window.addEventListener('pageshow', check);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  return () => {
    unsubscribe(); channel?.close(); window.removeEventListener('storage', storage);
    window.removeEventListener('pageshow', check); window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
  };
}
export function logoutPrivateSession(): string | null {
  let failed = false;
  const epoch = crypto.randomUUID();
  const persistEpoch = () => {
    try { localStorage.setItem(LOGOUT_KEY, epoch); return readEpoch() === epoch; }
    catch { return false; }
  };
  // The durable, non-sensitive tombstone must outlive every draft and old tab.
  let persisted = persistEpoch();
  lockPrivateSession();
  try { clearPrivateStorage(localStorage); } catch { failed = true; }
  try { clearPrivateStorage(sessionStorage); } catch { failed = true; }
  // Full storage can reject the first tombstone. Clearing drafts frees space;
  // retry and verify durability before reporting success to a suspended tab.
  if (!persisted || readEpoch() !== epoch) persisted = persistEpoch();
  // A suspended writer may have finished in the cleanup-to-retry gap. Sweep
  // once more after the durable epoch exists; any later old write self-rejects.
  if (persisted) try { clearPrivateStorage(localStorage); } catch { failed = true; }
  if (!persisted || readEpoch() !== epoch) failed = true;
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(LOGOUT_KEY); channel.postMessage('logout'); channel.close();
  }
  return failed ? '瀏覽器未允許清除全部本機資料。工作台已鎖定；請清除此網站的瀏覽器資料，並繼續登出。' : null;
}
export function clearExpiredRecoveries(): string | null {
  try {
    const expired = new Set<string>();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PRIVATE_PREFIX)) continue;
      try {
        const savedAt = JSON.parse(localStorage.getItem(key)!).savedAt;
        if (!Number.isFinite(savedAt) || Date.now() - savedAt > TTL) expired.add(key);
      } catch { expired.add(key); }
    }
    for (const key of expired) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage)) {
      // Missing targets also mark successfully saved tabs. Keep those pointers
      // so a clean reload cannot revive a different tab's older crash copy.
      if (key.startsWith(PRIVATE_PREFIX) && expired.has(sessionStorage.getItem(key)!)) sessionStorage.removeItem(key);
    }
    return null;
  } catch { return '無法清理過期的本機復原副本；請確認瀏覽器允許儲存資料。'; }
}
const baseKey = (owner: string, job: string) => `${PREFIX}${encodeURIComponent(owner)}:${job}:`;
// Fresh for every document, including duplicated tabs; sessionStorage is copied by browsers.
const documentId = crypto.randomUUID();
const keyFor = (owner: string, job: string) => `${baseKey(owner, job)}${documentId}`;
const validDraft = (value: any): boolean => value === null || (value && ['post','igCaption','notes'].every(key => typeof value[key] === 'string')
  && Array.isArray(value.claims) && value.claims.every((c: any) => c && ['text','locator','quote'].every(k => typeof c[k] === 'string'))
  && Array.isArray(value.pages) && value.pages.every((p: any) => p && typeof p.id === 'string' && typeof p.title === 'string'
    && ['cover','content','outro'].includes(p.layout) && (p.subtitle === undefined || typeof p.subtitle === 'string')
    && (p.cards === undefined || (Array.isArray(p.cards) && p.cards.every((c: any) => c && typeof c.title === 'string' && typeof c.body === 'string')))));
export function readRecovery(owner: string, job: string): { snapshot?: EditorSnapshot; error?: string } {
  if (!isPrivateSessionActive()) return {};
  try {
    const ownKey = keyFor(owner, job);
    const previousKey = sessionStorage.getItem(baseKey(owner, job));
    const candidates = Object.keys(localStorage).filter(key => key.startsWith(baseKey(owner, job)));
    const validTime = (key: string) => { try { return Number(JSON.parse(localStorage.getItem(key)!).savedAt) || 0; } catch { return 0; } };
    const key = localStorage.getItem(ownKey) ? ownKey : previousKey || candidates.sort((a, b) => validTime(b) - validTime(a))[0];
    const raw = key ? localStorage.getItem(key) : null;
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.savedAt) || Date.now() - value.savedAt > TTL || raw.length > 600000
      || !Number.isSafeInteger(value.revision) || value.revision < 1 || !validDraft(value.draft)
      || typeof value.baseline !== 'string' || typeof value.designBaseline !== 'string'
      || !value.design || ['palette','style','imageStyle','format'].some(k => typeof value.design[k] !== 'string')) {
      localStorage.removeItem(key); return {};
    }
    return { snapshot: { ...value, pendingSave: value.pendingSave || !previousKey } };
  } catch { return { error: '無法讀取本機復原副本；請確認瀏覽器允許儲存資料。' }; }
}
/** A deleted job leaves no local recovery copy in any tab of this browser. */
export function removeRecovery(owner: string, job: string): void {
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(baseKey(owner, job)))) localStorage.removeItem(key);
    sessionStorage.removeItem(baseKey(owner, job));
  } catch { /* Storage may be unavailable; the server copy is already gone. */ }
}
export function writeRecovery(owner: string, job: string, snapshot: EditorSnapshot, dirty: boolean): string | null {
  if (!isPrivateSessionActive()) return null;
  try {
    const key = keyFor(owner, job);
    sessionStorage.setItem(baseKey(owner, job), key);
    if (!dirty) localStorage.removeItem(key);
    else {
      const raw = JSON.stringify({ ...snapshot, savedAt: Date.now() });
      if (raw.length > 600000) throw new Error('Draft exceeds recovery storage limit');
      localStorage.setItem(key, raw);
    }
    // A different process/tab may log out between the first check and setItem.
    if (!isPrivateSessionActive()) { localStorage.removeItem(key); sessionStorage.removeItem(baseKey(owner, job)); }
    return null;
  } catch { return '本機復原副本儲存失敗；請立即手動儲存文字，避免關閉頁面後遺失。'; }
}
