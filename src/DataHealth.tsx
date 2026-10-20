import { useEffect, useState } from "react";
import type { ReadinessData } from "./types";

export default function DataHealth() {
  const [data, setData] = useState<ReadinessData | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/readiness.json", { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(value => {
      if (value?.version === 1 && value.counts) setData(value);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  if (!data) return null;
  const c = data.counts;
  return <details className="rounded-xl border border-line bg-surface p-4 text-sm dark:border-line-dark dark:bg-surface-dark">
    <summary className="min-h-11 cursor-pointer font-medium text-ink dark:text-ink-dark">資料更新與完整度 <span className="ml-2 text-xs font-normal text-muted dark:text-muted-dark">{c.summariesAvailable.toLocaleString()}／{c.total.toLocaleString()} 篇有中文摘要</span></summary>
    <div className="mt-2 space-y-3">
      <p>索引更新：{data.indexUpdated || data.sourceUpdated || "未提供"}；摘要產生：{data.summaryGeneratedAt?.slice(0, 10) || "尚未產生"}；完整度檢查：{data.generatedAt.slice(0, 10)}。</p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div><dt className="font-medium">摘要待補</dt><dd>{c.summaryBacklog} 篇（{c.summaryReady} 篇已有來源摘要，{c.summaryBlocked} 篇需先補來源或處理衝突）</dd></div>
        <div><dt className="font-medium">書目待查</dt><dd>{c.bibliographyUnresolved} 篇；缺作者 {c.missingAuthors} 篇，缺識別碼 {c.missingIdentifiers} 篇。</dd></div>
        <div><dt className="font-medium">全文來源</dt><dd>{c.fullTextVerified} 篇有來源列出的免費全文；{c.fullTextInferred} 篇僅上游標示，尚待核對。</dd></div>
      </dl>
      <p className="text-xs text-muted dark:text-muted-dark">來源欄位查核與摘要生成不等於全文品質評讀。缺漏資料會保留狀態，不補造作者、結果或臨床建議。</p>
    </div>
  </details>;
}
