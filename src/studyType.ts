// 從標題推導證據類型。
//
// 資料沒有 studyType 欄位，但標題幾乎都自報文體（"A Systematic Review and
// Meta-analysis of…"）。臨床判讀時「這是指引還是敘述性回顧」比期刊 IF 重要得多，
// 所以在資料管線補上欄位之前，先在前端用標題推導並標示。
// 先辨識明確研究文體；標題提及 reporting guideline 並不代表它本身是指引。

export type StudyType =
  | "指引"
  | "共識"
  | "統合分析"
  | "系統性回顧"
  | "傘狀回顧"
  | "範疇回顧"
  | "敘述性回顧";

interface Rule {
  type: StudyType;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { type: "傘狀回顧", pattern: /\bumbrella review\b/i },
  { type: "統合分析", pattern: /\b(meta-?analys[ie]s|network meta)\b/i },
  { type: "範疇回顧", pattern: /\bscoping review\b/i },
  { type: "系統性回顧", pattern: /\bsystematic (review|search)\b/i },
  { type: "敘述性回顧", pattern: /\bnarrative review\b/i },
  { type: "指引", pattern: /\b(clinical practice guideline|practice guideline|guidelines?)\b/i },
  { type: "共識", pattern: /\b(consensus|position (statement|stand)|delphi)\b/i },
  { type: "敘述性回顧", pattern: /\breview\b/i },
];

export function studyTypeOf(title: string): StudyType | null {
  const rule = RULES.find((r) => r.pattern.test(title));
  return rule ? rule.type : null;
}

/** 統合分析常與系統性回顧併稱，兩者都命中時顯示合稱，資訊量較高。 */
export function studyTypeLabel(title: string): string | null {
  const type = studyTypeOf(title);
  if (!type) return null;
  if (type === "統合分析" && /\bsystematic (review|search)\b/i.test(title)) {
    return "系統性回顧＋統合分析";
  }
  return type;
}
