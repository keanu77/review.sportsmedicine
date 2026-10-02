#!/usr/bin/env node
// 決定這一次排程同步要不要做事。
//
// 上游每月 1 日 02:00 重建，本站 03:00 同步；上游偶爾延遲，所以 1 日中午與 2 日凌晨各有一次補跑。
// 排程只接受「本月」的批次：本月已同步過就跳過，上游還沒發布時前幾次靜默等待補跑，
// 最後一次（2 日）仍沒有就失敗，讓人看得到。手動執行一律照做（沿用原本的驗證）。
//
// 用法：node scripts/sync-gate.mjs <upstream.json> <current.json> >> "$GITHUB_OUTPUT"

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FINAL_ATTEMPT_DAY = 2;

export function syncDecision({ event, today, current, upstream }) {
  if (event !== 'schedule') return { run: true, reason: '手動執行' };
  const monthStart = `${today.slice(0, 8)}01`;
  if ((current?.meta?.updated ?? '') >= monthStart) return { run: false, reason: `本月已同步過（${current.meta.updated}）` };
  if ((upstream?.meta?.updated ?? '') >= monthStart) return { run: true, reason: `上游本月批次 ${upstream.meta.updated}` };
  const reason = `上游尚未發布本月批次（最新 ${upstream?.meta?.updated ?? '未知'}），保留現有索引`;
  if (Number(today.slice(8, 10)) >= FINAL_ATTEMPT_DAY) throw new Error(`${reason}；已是最後一次補跑，請人工確認上游`);
  return { run: false, reason: `${reason}，等待補跑` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [upstreamPath, currentPath] = process.argv.slice(2);
  const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const decision = syncDecision({ event: process.env.GITHUB_EVENT_NAME, today, current: readJson(currentPath), upstream: readJson(upstreamPath) });
  console.error(`${decision.run ? '▶' : '⏭'} ${decision.reason}`);
  if (!decision.run) console.error(`::notice::${decision.reason}`);
  console.log(`run=${decision.run}`);
}
