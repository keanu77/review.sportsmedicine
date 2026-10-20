// 共用型別：public/data/ 下兩份 JSON 的形狀。
// reviews-index.json 由上游 RSS/知識庫 monorepo 產生；
// new-items.json 由 scripts/build-new-items.mjs 在每月同步時比對前後快照產生。

export type Axis = "region" | "theme" | "population";

export interface Item {
  title: string;
  year: number | null;
  firstPublicationDate?: string | null;
  url: string;
  source: string;
  tldr: string | null;
  free: boolean;
  freeUrl?: string | null;
  journal?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  doi?: string | null;
  authors?: string[] | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  bibliography?: BibliographyEntry;
  /** Source-listed access is distinct from an upstream free-access heuristic. */
  fullText?: FullTextMetadata;
  abstract?: SourceAbstract;
  /** Frontend merge aliases; keeps old title bookmarks resolvable after metadata enrichment. */
  identityAliases?: string[];
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

export interface FullTextMetadata {
  status: "verified" | "inferred" | "unknown";
  url?: string;
  pdfUrl?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  /** A source-reported license; free access alone does not imply a reuse license. */
  license?: string;
  licenseUrl?: string;
  reason?: string;
}

export interface SourceAbstract {
  text: string;
  /** Original source headings only; missing sections are never generated. */
  sections?: { label: string; text: string }[];
  source: "Europe PMC" | "PubMed";
  sourceUrl: string;
  verifiedAt: string;
  /** Non-reusable abstracts are publicly limited to a short source excerpt. */
  excerptOnly?: boolean;
  license?: string;
}

/** Durable source metadata, independent of the monthly upstream index. */
export interface BibliographyEntry {
  title: string;
  year: number | null;
  /** Europe PMC first-publication date; the upstream source may infer partial dates. */
  firstPublicationDate?: string | null;
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  authors: string[];
  journal?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  source: "Europe PMC" | "Crossref";
  sourceUrl: string;
  verifiedAt: string;
  matchMethod: "identifier" | "exact-title-year";
  fullText?: FullTextMetadata;
  abstract?: SourceAbstract | null;
}

export interface BibliographyData {
  version: 1;
  generatedAt: string;
  records: BibliographyEntry[];
  unresolved: { key: string; title: string; reason: string; checkedAt: string }[];
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

/**
 * 中文摘要疊加層 public/data/summaries.json。
 * 獨立成一個檔是因為 reviews-index.json 每月會被上游整檔覆蓋，
 * 摘要寫回去下次同步就消失。鍵為正規化標題。
 */
export interface SummariesData {
  generatedAt: string | null;
  model: string;
  count: number;
  summaries: Record<string, string>;
  provenance?: Record<string, { sourceUrl: string; sourceVerifiedAt: string; generatedAt: string; model: string;
    sourceEdit?: { editedAt: string; reason: string } }>;
  attempts?: Record<string, { status: "generated" | "blocked" | "failed"; reason?: string; checkedAt: string }>;
}

export interface ReadinessRecord {
  key: string;
  title: string;
  bibliography: "verified" | "unresolved";
  abstract: "verified" | "missing";
  summary: "available" | "pending" | "blocked";
  summaryOverlay: "available" | "pending" | "blocked";
  fullText: FullTextMetadata["status"];
  missing: string[];
  reasons: string[];
  sourceUrl?: string;
}

export interface ReadinessData {
  version: 1;
  generatedAt: string;
  sourceUpdated: string;
  indexUpdated: string;
  summaryGeneratedAt: string | null;
  counts: {
    total: number; bibliographyVerified: number; bibliographyUnresolved: number;
    abstractVerified: number; abstractMissing: number; abstractFull: number; abstractExcerpt: number;
    summariesAvailable: number; summaryBacklog: number; summaryReady: number; summaryBlocked: number;
    overlaySummariesAvailable: number; overlaySummaryBacklog: number;
    missingAuthors: number; missingIdentifiers: number; missingDate: number;
    fullTextVerified: number; fullTextInferred: number; fullTextUnknown: number;
    conflictedTitleKeys: number;
  };
  papers: ReadinessRecord[];
}

export type DataReadiness = ReadinessData;

/**
 * 自訂標籤疊加層 public/data/tags.json。與 summaries.json 同理獨立成檔——
 * reviews-index.json 每月被上游整檔覆蓋。
 */
export interface TagsData {
  generatedAt: string | null;
  model: string;
  tags: Record<
    string,
    {
      label: string;
      /** 併進哪一條軸 */
      axis: "themes" | "populations";
      /** 這些上游標籤會被改名成 label（達成聯集，不會少收） */
      absorbs?: string[];
      keys: string[];
      count?: number;
    }
  >;
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
