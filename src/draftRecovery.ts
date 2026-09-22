import type { Design, Draft } from '../shared/contracts';

export type EditorSnapshot = { draft: Draft | null; baseline: string; revision: number; design: Design; designBaseline: string; pendingSave?: boolean };
const PREFIX = 'review:private-draft:v1:';
const TTL = 7 * 24 * 60 * 60 * 1000;
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
export function writeRecovery(owner: string, job: string, snapshot: EditorSnapshot, dirty: boolean): string | null {
  try {
    const key = keyFor(owner, job);
    sessionStorage.setItem(baseKey(owner, job), key);
    // Remove expired private drafts without touching other application storage.
    for (const candidate of Object.keys(localStorage)) {
      if (!candidate.startsWith(`${PREFIX}${encodeURIComponent(owner)}:`)) continue;
      try { if (Date.now() - JSON.parse(localStorage.getItem(candidate)!).savedAt > TTL) localStorage.removeItem(candidate); } catch { localStorage.removeItem(candidate); }
    }
    if (!dirty) localStorage.removeItem(key);
    else {
      const raw = JSON.stringify({ ...snapshot, savedAt: Date.now() });
      if (raw.length > 600000) throw new Error('Draft exceeds recovery storage limit');
      localStorage.setItem(key, raw);
    }
    return null;
  } catch { return '本機復原副本儲存失敗；請立即手動儲存文字，避免關閉頁面後遺失。'; }
}
