import { readFile } from 'node:fs/promises';
import { overlayConflicts, enrichItems, type BibliographyLookup } from '../src/enrich.ts';
import { paperAliases, sourceInput, uniquePapers } from '../src/identity.ts';
import type { Item, SummariesData, TagsData } from '../src/types.ts';

type Load<T> = { status: 'ready' | 'missing' | 'invalid'; data: T | null };
type OverlayData = { summaries: Pick<SummariesData, 'generatedAt' | 'summaries'>; tags: Pick<TagsData, 'generatedAt' | 'tags'> };
type Snapshot = { summaryCoverage: number | null; tagCoverage: number | null };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

// Optional enrichment must be reported as unavailable, never silently as 0% coverage.
export async function readOverlay<K extends keyof OverlayData>(kind: K, path = `public/data/${kind}.json`): Promise<Load<OverlayData[K]>> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    const valid = object(value) && object(value[kind]) && (kind === 'summaries'
      ? Object.values(value[kind]).every(text => typeof text === 'string')
      : Object.values(value[kind]).every(tag => object(tag) && typeof tag.label === 'string' && ['themes', 'populations'].includes(String(tag.axis)) && Array.isArray(tag.keys) && tag.keys.every(key => typeof key === 'string')));
    return valid ? { status: 'ready', data: { ...value, generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : null } as OverlayData[K] } : { status: 'invalid', data: null };
  } catch (error) {
    return { status: object(error) && error.code === 'ENOENT' ? 'missing' : 'invalid', data: null };
  }
}

export function readOverlayBaseline(report: string): Snapshot | null {
  try {
    const match = report.match(/<!-- overlay-health:v1 (.*?) -->/);
    if (!match) return null;
    const value = JSON.parse(match[1]);
    return object(value) && ['summaryCoverage', 'tagCoverage'].every(key => value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 100)) ? value as Snapshot : null;
  } catch { return null; }
}

export function buildOverlayHealth(items: readonly Item[], bibliography: BibliographyLookup, summaries: Load<OverlayData['summaries']>, tags: Load<OverlayData['tags']>, upstreamDate: string, previous: Snapshot | null = null) {
  const papers = uniquePapers(enrichItems(items, {}, {}, bibliography));
  const conflicts = overlayConflicts(items, bibliography);
  const aliases = (item: Item) => paperAliases(item).filter(key => !conflicts.has(key));
  const summaryCount = summaries.data ? papers.filter(item => aliases(item).some(key => Boolean(summaries.data!.summaries[key]?.trim()))).length : null;
  const groups = tags.data ? Object.values(tags.data.tags) : [];
  const tagKeys = new Set(groups.flatMap(tag => tag.keys));
  const tagCount = tags.data ? papers.filter(item => aliases(item).some(key => tagKeys.has(key))).length : null;
  const percent = (count: number | null) => count === null || !papers.length ? null : Number((count / papers.length * 100).toFixed(1));
  const snapshot: Snapshot = { summaryCoverage: percent(summaryCount), tagCoverage: percent(tagCount) };
  const delta = (now: number | null, before: number | null | undefined) => now === null || before == null ? '未取得可比基準' : `${now >= before ? '+' : ''}${(now - before).toFixed(1)} pp`;
  const coverage = (count: number | null, pct: number | null) => count === null ? '未取得' : `${count} / ${papers.length}（${pct === null ? '無文獻' : `${pct.toFixed(1)}%`}）`;
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : null;
  const generation = (value: unknown) => {
    const day = date(value), upstream = date(upstreamDate);
    return day ? `${day}${upstream && day < upstream ? '（早於本期上游資料，需確認是否補跑）' : ''}` : '未提供有效日期';
  };
  const status = { ready: '可讀取', missing: '檔案缺少', invalid: '格式無效或讀取失敗' };
  const withheld = summaries.data ? papers.filter(item => paperAliases(item).some(key => conflicts.has(key) && Boolean(summaries.data!.summaries[key]?.trim()))).length : null;
  const escape = (value: string) => value.replace(/[\r\n]/g, ' ').replace(/[<>&|]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '|': '&#124;' })[char]!);
  const markdown = `## 摘要與自訂標籤疊加層\n\n| 項目 | 狀態 | 可安全套用的唯一文獻 | 較上月 | 產生日期 |\n| --- | --- | --- | --- | --- |\n| 摘要 | ${status[summaries.status]} | ${coverage(summaryCount, snapshot.summaryCoverage)} | ${delta(snapshot.summaryCoverage, previous?.summaryCoverage)} | ${generation(summaries.data?.generatedAt)} |\n| 自訂標籤 | ${status[tags.status]} | ${coverage(tagCount, snapshot.tagCoverage)} | ${delta(snapshot.tagCoverage, previous?.tagCoverage)} | ${generation(tags.data?.generatedAt)} |\n\n自訂標籤只描述特定族群／主題，不以 100% 覆蓋為目標；比率不表示醫學內容已查核。產生日期是檔案日期，不代表逐篇重新驗證。\n\n- 識別碼衝突的標題鍵：${conflicts.size}\n- 因歧義停用疊加摘要的唯一文獻：${withheld ?? '未取得'}\n${[...conflicts].map(([, group]) => `- 待核對：${escape(group[0].title)} — ${[...new Set(group.map(sourceInput).filter(Boolean))].map(id => escape(id!)).join(' / ')}`).join('\n')}\n\n<!-- overlay-health:v1 ${JSON.stringify(snapshot)} -->\n`;
  return { markdown, snapshot, summaryCount, tagCount, conflicts, withheld, uniqueCount: papers.length };
}
