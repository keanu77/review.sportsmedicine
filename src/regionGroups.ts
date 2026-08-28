// 部位分類的色彩系統。
//
// 原本用字串雜湊挑 Okabe–Ito 11 色配給 23 個部位，結果是：同一個 #0072B2 同時代表
// 腕與手、踝與足、胸椎、代謝、傷害流行病學——顏色反而在說謊。而且 Okabe–Ito 是為了
// 「色盲可分辨的填色」設計，不是文字對比，11 色中有 6 色在淺色底達不到 4.5:1。
//
// 改法：色彩只表達「解剖大類」（5 組，固定對應），且只用在圓點與邊框這類非文字元件；
// 改法：五個解剖大類各有一組完整色調（底色／文字／外框／色點），色相拉開到
// 40°／155°／228°／295°／340°，但共用同一套 OKLCH 明度與彩度，因此彼此視覺權重
// 相等、可辨識，又與主站 sportsmedicine.tw 的品牌色相 228 同調。
// 每組的文字對底色 ≥4.5:1、色點對底色 ≥3:1，明暗兩套皆驗過。

export interface GroupTone {
  /** 標籤底色 */
  bg: string;
  /** 標籤文字，對 bg 達 4.5:1 */
  text: string;
  /** 標籤外框 */
  border: string;
  /** 色點，對 bg 達 3:1 */
  dot: string;
}

export interface RegionGroup {
  label: string;
  light: GroupTone;
  dark: GroupTone;
  regions: string[];
}

export const REGION_GROUPS: RegionGroup[] = [
  {
    label: "上肢",
    light: { bg: "#d9f5ff", text: "#005f85", border: "#a8daf0", dot: "#0088bb" },
    dark: { bg: "#062835", text: "#89d7f9", border: "#19485b", dot: "#36baeb" },
    regions: ["肩", "肘", "腕與手"],
  },
  {
    label: "下肢",
    light: { bg: "#dff8e6", text: "#036639", border: "#b3ddc0", dot: "#0e9254" },
    dark: { bg: "#102a1a", text: "#9bdcb1", border: "#264c34", dot: "#5ec386" },
    regions: ["髖與鼠蹊", "膝", "踝與足"],
  },
  {
    label: "脊椎與頭頸",
    light: { bg: "#ffe9df", text: "#863c21", border: "#f5c5b4", dot: "#bd5833" },
    dark: { bg: "#361c13", text: "#feb79e", border: "#5d3729", dot: "#f08d6a" },
    regions: ["頸椎", "胸椎", "腰椎", "頭頸／腦震盪"],
  },
  {
    label: "全身與內科",
    light: { bg: "#f1ecff", text: "#5a478b", border: "#d3caf5", dot: "#8166c3" },
    dark: { bg: "#261f37", text: "#cebfff", border: "#453c5f", dot: "#b199f4" },
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
    light: { bg: "#ffe8f8", text: "#7c3a68", border: "#edc2dd", dot: "#af5594" },
    dark: { bg: "#321b2b", text: "#f3b4dd", border: "#58354c", dot: "#e189c5" },
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
  light: { bg: "#eef4f7", text: "#4a5a63", border: "#cbdae2", dot: "#6b8f9e" },
  dark: { bg: "#132229", text: "#b3c6ce", border: "#2c414c", dot: "#7f9daa" },
  regions: [],
};

export function groupOf(key: string): RegionGroup {
  return BY_REGION.get(key) ?? FALLBACK;
}

/**
 * 依部位軸以外（臨床主題、族群）沒有解剖大類可對應。這些軸的顏色**純粹是裝飾**，
 * 用來讓一整排標籤有層次、好掃視，不帶語意——所以用穩定的索引輪替，
 * 而不是雜湊：雜湊會讓兩個不相干的鍵撞到同色，看起來像在暗示關聯。
 */
export function toneByIndex(index: number): RegionGroup {
  return REGION_GROUPS[index % REGION_GROUPS.length];
}
