// 分類標籤的色彩系統。
//
// 兩版之前用字串雜湊挑 Okabe–Ito 11 色配 23 個分類，結果是同一個 #0072B2 同時代表
// 腕與手、踝與足、胸椎、代謝、傷害流行病學——顏色在說謊；而且 Okabe–Ito 是為「色盲可
// 分辨的填色」設計，11 色中有 6 色在淺色底達不到 4.5:1。
// 上一版收斂成 5 個解剖大類共 5 色，對比乾淨但色彩層次不足。
//
// 現在的做法兼顧兩者：**每個分類各有專屬色相**（23 個，完全不重複），但同一解剖家族的
// 色相彼此相鄰（上肢藍、下肢綠、脊椎與頭頸暖紅橙、方法與實務黃橄欖、全身與內科紫洋紅），
// 所以家族一眼看得出來，個別分類又分得開。
//
// 所有色值由同一組 OKLCH 明度／彩度換色相產生，因此視覺權重一致；
// 每組都驗過文字對底色 ≥4.5:1、色點對底色 ≥3:1，明暗兩套皆然
// （實測最低 6.17:1 與 3.48:1）。色相數值即產生這些 hex 的來源，改色請一併重算對比。

export interface Tone {
  /** 標籤底色 */
  bg: string;
  /** 標籤文字，對 bg ≥4.5:1 */
  text: string;
  /** 標籤外框 */
  border: string;
  /** 色點，對 bg ≥3:1 */
  dot: string;
}

export interface RegionStyle {
  /** 所屬解剖家族，僅供閱讀程式碼時定位 */
  family: string;
  /** OKLCH 色相 */
  hue: number;
  light: Tone;
  dark: Tone;
}

const T = (bg: string, text: string, border: string, dot: string): Tone => ({
  bg,
  text,
  border,
  dot,
});

export const REGION_STYLES: Record<string, RegionStyle> = {
  // 上肢
  "肩": {
    family: "上肢",
    hue: 200,
    light: T("#dcfbfc", "#00666d", "#aae0e2", "#00919b"),
    dark: T("#00282a", "#82e0e5", "#07494c", "#00c3cb"),
  },
  "肘": {
    family: "上肢",
    hue: 215,
    light: T("#dcfaff", "#00637b", "#abdeeb", "#008dad"),
    dark: T("#00272f", "#85ddf3", "#0c4853", "#06bfde"),
  },
  "腕與手": {
    family: "上肢",
    hue: 230,
    light: T("#dff8ff", "#005f86", "#b0dcf2", "#0087bc"),
    dark: T("#042533", "#8ed9fe", "#174559", "#3bb9ed"),
  },
  // 下肢
  "髖與鼠蹊": {
    family: "下肢",
    hue: 140,
    light: T("#e9f9e5", "#306324", "#c2debc", "#488e38"),
    dark: T("#152712", "#afdda5", "#2e4729", "#7dbf6e"),
  },
  "膝": {
    family: "下肢",
    hue: 158,
    light: T("#e3faeb", "#00673d", "#b7e0c7", "#009259"),
    dark: T("#0b2819", "#9be0b7", "#214933", "#58c38b"),
  },
  "踝與足": {
    family: "下肢",
    hue: 175,
    light: T("#defbf2", "#006852", "#afe1d2", "#009476"),
    dark: T("#022820", "#8ce1ca", "#134a3e", "#2dc5a6"),
  },
  // 脊椎與頭頸
  "頭頸／腦震盪": {
    family: "脊椎與頭頸",
    hue: 5,
    light: T("#ffebf0", "#85374d", "#f5c6cf", "#bc516f"),
    dark: T("#33181f", "#ffb5c6", "#5a323b", "#ef86a0"),
  },
  "頸椎": {
    family: "脊椎與頭頸",
    hue: 20,
    light: T("#ffeceb", "#88383b", "#f7c7c5", "#bf5257"),
    dark: T("#341819", "#ffb7b5", "#5b3232", "#f28788"),
  },
  "胸椎": {
    family: "脊椎與頭頸",
    hue: 33,
    light: T("#ffece6", "#873a2a", "#f6c8bd", "#bf5640"),
    dark: T("#341913", "#ffb9a8", "#5b332b", "#f18a74"),
  },
  "腰椎": {
    family: "脊椎與頭頸",
    hue: 46,
    light: T("#ffede2", "#853e17", "#f4cab6", "#bb5b27"),
    dark: T("#331a0e", "#ffbc9c", "#5a3524", "#ed8f61"),
  },
  // 方法與實務
  "訓練方法與運動處方": {
    family: "方法與實務",
    hue: 75,
    light: T("#fff1dc", "#784a00", "#ead0ad", "#a96b00"),
    dark: T("#2e1e06", "#f1c68b", "#523b18", "#da9e3f"),
  },
  "影像・診斷・生物力學": {
    family: "方法與實務",
    hue: 88,
    light: T("#fcf3dc", "#6f5000", "#e3d3ac", "#9d7300"),
    dark: T("#2b2005", "#e6cb89", "#4d3e16", "#cda53a"),
  },
  "傷害流行病學・預防・篩檢": {
    family: "方法與實務",
    hue: 101,
    light: T("#f8f5dc", "#635600", "#dcd6ad", "#8d7b00"),
    dark: T("#262205", "#dad08a", "#474117", "#bdad3e"),
  },
  "注射・再生・儀器治療": {
    family: "方法與實務",
    hue: 114,
    light: T("#f3f6de", "#555b00", "#d3d9b0", "#7a8200"),
    dark: T("#212408", "#ccd590", "#3f431b", "#aab44a"),
  },
  "其他（運動科學・政策・牙科等）": {
    family: "方法與實務",
    hue: 127,
    light: T("#eef8e1", "#45600c", "#cadcb5", "#648918"),
    dark: T("#1c260c", "#bed999", "#374621", "#95ba5b"),
  },
  // 全身與內科
  "高齡・肌少・骨骼健康": {
    family: "全身與內科",
    hue: 252,
    light: T("#e4f6ff", "#1f5790", "#bbd7f8", "#317dca"),
    dark: T("#112337", "#a3d2ff", "#27415f", "#6aaffa"),
  },
  "代謝・營養・內分泌": {
    family: "全身與內科",
    hue: 266,
    light: T("#e9f4ff", "#385192", "#c3d4fa", "#5375cd"),
    dark: T("#172137", "#b2cdff", "#313f60", "#84a8fd"),
  },
  "心血管・呼吸・內科": {
    family: "全身與內科",
    hue: 280,
    light: T("#eff2ff", "#4a4c90", "#ccd1f9", "#6c6ecb"),
    dark: T("#1d1f37", "#c2c8ff", "#393c5f", "#9ba1fb"),
  },
  "神經系統疾病復健": {
    family: "全身與內科",
    hue: 294,
    light: T("#f4f0ff", "#59478c", "#d6cef6", "#8067c4"),
    dark: T("#231d35", "#d0c3ff", "#41395c", "#b09af5"),
  },
  "腫瘤運動復健": {
    family: "全身與內科",
    hue: 308,
    light: T("#f9eeff", "#664284", "#decbf1", "#9160b9"),
    dark: T("#281b32", "#debefc", "#493758", "#c294ea"),
  },
  "全身性肌肉骨骼・風濕・疼痛": {
    family: "全身與內科",
    hue: 322,
    light: T("#feedff", "#713e79", "#e6c9ea", "#a05bab"),
    dark: T("#2c1a2e", "#eabbf1", "#4f3553", "#d18edb"),
  },
  "女性運動員・RED-S": {
    family: "全身與內科",
    hue: 336,
    light: T("#ffecfc", "#7a3a6c", "#ecc7e2", "#ac5699"),
    dark: T("#2f192a", "#f4b8e4", "#54334c", "#de8aca"),
  },
  "運動心理與心理健康": {
    family: "全身與內科",
    hue: 350,
    light: T("#ffebf6", "#81385e", "#f2c6d9", "#b55386"),
    dark: T("#321825", "#fcb6d6", "#573244", "#e887b6"),
  },
};

// 資料新增了沒列到的分類時的保底色（中性），不會與既有分類撞色。
const FALLBACK: RegionStyle = {
  family: "其他",
  hue: 240,
  light: T("#f1f5f7", "#4a5a63", "#cbdae2", "#6b8f9e"),
  dark: T("#132229", "#b3c6ce", "#2c414c", "#7f9daa"),
};

const ORDERED = Object.values(REGION_STYLES);

export function toneOf(key: string): RegionStyle {
  return REGION_STYLES[key] ?? FALLBACK;
}

/**
 * 依部位軸以外（臨床主題、族群）沒有解剖分類可對應。這些軸的顏色**純粹是裝飾**，
 * 用來讓一整排標籤有層次、好掃視，不帶語意——所以用穩定的索引輪替，
 * 而不是雜湊：雜湊會讓兩個不相干的鍵撞到同色，看起來像在暗示關聯。
 */
export function toneByIndex(index: number): RegionStyle {
  return ORDERED[index % ORDERED.length];
}
