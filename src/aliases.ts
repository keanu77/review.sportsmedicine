// 臨床縮寫 ↔ 中英全稱對照。
//
// 資料裡的 title 是英文、disease 是中文，醫師實際會打的卻是縮寫（ACL、PRP、RTP）。
// 沒有這張表時，「ACL」只命中標題裡剛好寫出縮寫的那幾篇，病名為「前十字韌帶損傷」
// 的其餘文獻全部漏掉。每個 key 都是小寫，比對前會先正規化。

export const ALIASES: Record<string, string[]> = {
  acl: ["前十字韌帶", "anterior cruciate"],
  pcl: ["後十字韌帶", "posterior cruciate"],
  mcl: ["內側副韌帶", "medial collateral"],
  lcl: ["外側副韌帶", "lateral collateral"],
  mpfl: ["內側髕股韌帶", "medial patellofemoral"],
  prp: ["富血小板", "platelet-rich", "platelet rich"],
  rtp: ["回場", "return to play", "return-to-play"],
  rts: ["回到運動", "return to sport", "return-to-sport"],
  "red-s": ["相對能量不足", "relative energy deficiency", "female athlete triad"],
  reds: ["相對能量不足", "relative energy deficiency"],
  pfps: ["髕股疼痛", "patellofemoral pain"],
  lbp: ["下背痛", "low back pain"],
  fai: ["股骨髖臼夾擠", "femoroacetabular"],
  fais: ["股骨髖臼夾擠", "femoroacetabular"],
  eswt: ["體外震波", "shockwave", "shock wave", "extracorporeal"],
  oa: ["骨關節炎", "osteoarthritis"],
  ra: ["類風濕", "rheumatoid"],
  tka: ["全膝關節置換", "total knee arthroplasty"],
  tha: ["全髖關節置換", "total hip arthroplasty"],
  rcr: ["旋轉肌袖修補", "rotator cuff repair"],
  rc: ["旋轉肌袖", "rotator cuff"],
  ubs: ["超音波", "ultrasound"],
  mri: ["磁振造影", "magnetic resonance"],
  doms: ["延遲性肌肉痠痛", "delayed onset muscle"],
  hiit: ["高強度間歇", "high-intensity interval", "high intensity interval"],
  bfr: ["血流限制", "blood flow restriction"],
  cpg: ["臨床指引", "clinical practice guideline", "guideline"],
  sr: ["系統性回顧", "systematic review"],
  ma: ["統合分析", "meta-analysis", "meta analysis"],
  tbi: ["腦損傷", "traumatic brain injury"],
  scat: ["腦震盪", "sport concussion assessment"],
  ai: ["人工智慧", "artificial intelligence", "machine learning"],
};

// 期刊縮寫 → 資料裡實際出現的 source／journal 字樣。
export const JOURNAL_ALIASES: Record<string, string[]> = {
  bjsm: ["br j sports med", "british journal of sports medicine"],
  ajsm: ["am j sports med", "american journal of sports medicine"],
  ojsm: ["orthop j sports med", "orthopaedic journal of sports medicine"],
  jospt: ["j orthop sports phys ther", "journal of orthopaedic"],
  kssta: ["knee surg sports traumatol", "knee surgery"],
  ijspt: ["int j sports phys ther", "international journal of sports physical"],
  jbjs: ["j bone joint surg", "journal of bone and joint"],
  bmj: ["bmj", "british medical journal"],
  jama: ["jama"],
  nejm: ["n engl j med", "new england journal"],
};

/** 查一個 token 的所有展開詞（含自身）。找不到就只回自身。 */
export function expandToken(token: string): string[] {
  const extra = ALIASES[token] ?? JOURNAL_ALIASES[token] ?? [];
  return [token, ...extra];
}
