// 部位分類的色彩系統。
//
// 原本用字串雜湊挑 Okabe–Ito 11 色配給 23 個部位，結果是：同一個 #0072B2 同時代表
// 腕與手、踝與足、胸椎、代謝、傷害流行病學——顏色反而在說謊。而且 Okabe–Ito 是為了
// 「色盲可分辨的填色」設計，不是文字對比，11 色中有 6 色在淺色底達不到 4.5:1。
//
// 改法：色彩只表達「解剖大類」（5 組，固定對應），且只用在圓點與邊框這類非文字元件；
// 文字一律用中性色，對比自然達標。明暗兩套色值都驗過 ≥3:1（WCAG 1.4.11 非文字對比）。

export interface RegionGroup {
  label: string;
  /** 淺色底用的色值 */
  light: string;
  /** 深色底用的色值 */
  dark: string;
  regions: string[];
}

export const REGION_GROUPS: RegionGroup[] = [
  {
    label: "上肢",
    light: "#0369a1",
    dark: "#7dd3fc",
    regions: ["肩", "肘", "腕與手"],
  },
  {
    label: "下肢",
    light: "#15803d",
    dark: "#86efac",
    regions: ["髖與鼠蹊", "膝", "踝與足"],
  },
  {
    label: "脊椎與頭頸",
    light: "#b45309",
    dark: "#fcd34d",
    regions: ["頸椎", "胸椎", "腰椎", "頭頸／腦震盪"],
  },
  {
    label: "全身與內科",
    light: "#7e22ce",
    dark: "#d8b4fe",
    regions: [
      "高齡・肌少・骨骼健康",
      "代謝・營養・內分泌",
      "心血管・呼吸・內科",
      "神經系統疾病復健",
      "腫瘤運動復健",
      "全身性肌肉骨骼・風濕・疼痛",
      "女性運動員・RED-S",
      "運動心理與心理健康",
    ],
  },
  {
    label: "方法與實務",
    light: "#475569",
    dark: "#cbd5e1",
    regions: [
      "訓練方法與運動處方",
      "傷害流行病學・預防・篩檢",
      "影像・診斷・生物力學",
      "注射・再生・儀器治療",
      "其他（運動科學・政策・牙科等）",
    ],
  },
];

const BY_REGION = new Map<string, RegionGroup>();
for (const group of REGION_GROUPS) {
  for (const region of group.regions) BY_REGION.set(region, group);
}

// 未列入的分類（含資料新增的部位、theme／population 軸的鍵）都落到中性色，
// 不會再出現「兩個不相干分類共用一個顏色」的假訊號。
const FALLBACK: RegionGroup = {
  label: "其他",
  light: "#475569",
  dark: "#cbd5e1",
  regions: [],
};

export function groupOf(key: string): RegionGroup {
  return BY_REGION.get(key) ?? FALLBACK;
}
