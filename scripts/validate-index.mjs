import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateIndex(next, previous) {
  if (!next?.meta || !/^\d{4}-\d{2}-\d{2}$/.test(next.meta.updated || '') || !Number.isFinite(Date.parse(next.meta.updated))) throw new Error('索引日期無效');
  if (!Array.isArray(next.items) || next.items.length < 1) throw new Error('索引文獻不可為空');
  if (previous?.meta?.updated && next.meta.updated < previous.meta.updated) throw new Error('上游資料日期倒退，保留現有索引');
  if (previous?.items?.length && (next.items.length < previous.items.length * .7 || next.items.length > previous.items.length * 1.5)) throw new Error('文獻筆數變動超過安全範圍，請人工檢查');
  for (const [index, item] of next.items.entries()) {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 3000) throw new Error(`第 ${index + 1} 筆標題無效`);
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`第 ${index + 1} 筆來源網址無效`);
    if (item.year !== null && (!Number.isInteger(item.year) || item.year < 1800 || item.year > new Date().getUTCFullYear() + 1)) throw new Error(`第 ${index + 1} 筆年份無效`);
    if (typeof item.free !== 'boolean' || ['region','disease','source'].some(key => typeof item[key] !== 'string')
      || ['themes','populations'].some(key => !Array.isArray(item[key]) || item[key].some(value => typeof value !== 'string'))) throw new Error(`第 ${index + 1} 筆分類欄位無效`);
  }
  return { count: next.items.length, updated: next.meta.updated };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [next = 'public/data/reviews-index.json', previous] = process.argv.slice(2);
  console.log(JSON.stringify(validateIndex(JSON.parse(readFileSync(next, 'utf8')), previous ? JSON.parse(readFileSync(previous, 'utf8')) : undefined)));
}
