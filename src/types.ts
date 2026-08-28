// 共用型別：public/data/ 下兩份 JSON 的形狀。
// reviews-index.json 由上游 RSS/知識庫 monorepo 產生；
// new-items.json 由 scripts/build-new-items.mjs 在每月同步時比對前後快照產生。

export type Axis = "region" | "theme" | "population";

export interface Item {
  title: string;
  year: number | null;
  url: string;
  source: string;
  tldr: string | null;
  free: boolean;
  freeUrl?: string | null;
  journal?: string | null;
  pmid?: string | null;
  impactFactor?: number | null;
  origin?: "kb" | "pubmed";
  region: string;
  disease: string;
  themes: string[];
  populations: string[];
  /** 僅新增清單有：去重時合併的多個疾病標籤 */
  diseases?: string[];
  /** 摘要來源。"local-llm" 代表由本機模型自 PubMed 摘要生成，UI 會標示 */
  tldrSource?: "local-llm" | string;
}

export interface AxisKey {
  key: string;
  count: number;
}

export interface ReviewsData {
  meta: {
    updated: string;
    total: number;
    freeCount: number;
    ifJcrYear?: string;
    note?: string;
  };
  axes: { region: AxisKey[]; theme: AxisKey[]; population: AxisKey[] };
  items: Item[];
}

export interface NewItemsData {
  /** 上游本批次的資料日期（YYYY-MM-DD） */
  batch: string | null;
  /** 上一批次的資料日期，用於說明比較基準 */
  previousBatch: string | null;
  /** 本站實際同步的日期 */
  syncedAt: string;
  count: number;
  items: Item[];
  /** 補摘要的日期與模型，供追溯 */
  summarizedAt?: string;
  summaryModel?: string;
}
