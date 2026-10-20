// 臨床用語以同義詞群組建立雙向索引。中文俗名、病名、縮寫及英文片語
// 都能作為查詢入口；症狀（例如膝痛）不與病因（例如膝骨關節炎）混成同義詞。
const CLINICAL_SYNONYMS: readonly (readonly string[])[] = [
  ["acl", "前十字韌帶", "anterior cruciate", "anterior cruciate ligament"],
  ["pcl", "後十字韌帶", "posterior cruciate", "posterior cruciate ligament"],
  ["mcl", "內側副韌帶", "medial collateral", "medial collateral ligament"],
  ["lcl", "外側副韌帶", "lateral collateral", "lateral collateral ligament"],
  ["mpfl", "內側髕股韌帶", "medial patellofemoral", "medial patellofemoral ligament"],
  // PRF（platelet-rich fibrin）不是 PRP；不可只展開到 platelet-rich / 富血小板。
  ["prp", "富血小板血漿", "高濃度血小板血漿", "富含血小板血漿", "platelet-rich plasma", "platelet rich plasma"],
  ["rtp", "回場", "return to play", "return-to-play"],
  ["rts", "回到運動", "return to sport", "return-to-sport"],
  ["red-s", "reds", "相對能量不足", "relative energy deficiency"],
  ["pfps", "髕股疼痛", "髕骨股骨疼痛", "patellofemoral pain", "patellofemoral pain syndrome"],
  ["lbp", "下背痛", "腰痛", "low back pain"],
  ["fai", "fais", "股骨髖臼夾擠", "femoroacetabular impingement"],
  ["eswt", "體外震波", "震波治療", "shockwave", "shock wave", "extracorporeal shockwave therapy", "extracorporeal shock wave therapy"],
  ["oa", "骨關節炎", "osteoarthritis"],
  ["ra", "類風濕", "rheumatoid arthritis"],
  ["tka", "全膝關節置換", "total knee arthroplasty"],
  ["tha", "全髖關節置換", "total hip arthroplasty"],
  ["rcr", "旋轉肌袖修補", "rotator cuff repair"],
  ["rc", "旋轉肌袖", "rotator cuff"],
  ["ubs", "超音波", "ultrasound"],
  ["mri", "磁振造影", "magnetic resonance", "magnetic resonance imaging"],
  ["doms", "延遲性肌肉痠痛", "delayed onset muscle soreness", "delayed-onset muscle soreness"],
  ["hiit", "高強度間歇", "high-intensity interval", "high intensity interval"],
  ["bfr", "血流限制", "blood flow restriction"],
  ["cpg", "臨床指引", "clinical practice guideline"],
  ["sr", "系統性回顧", "systematic review"],
  ["ma", "統合分析", "meta-analysis", "meta analysis"],
  ["tbi", "腦損傷", "traumatic brain injury"],
  ["scat", "腦震盪", "concussion", "sport concussion assessment"],
  ["ai", "人工智慧", "artificial intelligence"],
  ["冰凍肩", "五十肩", "沾黏性肩關節囊炎", "粘連性肩關節囊炎", "frozen shoulder", "adhesive capsulitis"],
  ["膝蓋痛", "膝痛", "膝關節疼痛", "knee pain"],
  ["肩痛", "肩膀痛", "肩關節疼痛", "shoulder pain"],
  ["膝骨關節炎", "膝關節退化", "膝退化性關節炎", "knee osteoarthritis"],
  ["網球肘", "肱骨外上髁病變", "肱骨外上髁炎", "lateral epicondylitis", "lateral epicondylalgia", "tennis elbow"],
  ["高爾夫球肘", "肱骨內上髁炎", "medial epicondylitis", "golfer's elbow"],
  ["媽媽手", "狄奎凡氏症", "狄奎凡氏腱鞘炎", "de quervain", "de quervain's", "de quervain tenosynovitis"],
  ["足底筋膜炎", "plantar fasciitis", "plantar fasciopathy"],
  ["阿基里斯肌腱病變", "跟腱病變", "achilles tendinopathy"],
  ["髕腱病變", "髕骨肌腱病變", "patellar tendinopathy", "jumper's knee"],
  ["半月板撕裂", "meniscal tear", "meniscus tear"],
  ["踝扭傷", "腳踝扭傷", "ankle sprain"],
  ["腕隧道症候群", "carpal tunnel syndrome"],
  ["頸痛", "頸部疼痛", "neck pain"],
  ["肌少症", "肌少症候群", "sarcopenia"],
];

export const ALIASES: Record<string, string[]> = Object.fromEntries(
  CLINICAL_SYNONYMS.flatMap(group => group.map(term => [term, group.filter(other => other !== term)])),
);

// 保留既有縮寫的寬鬆查詢入口；這些較廣的相關詞不是雙向同義詞。
for (const [term, related] of Object.entries({
  "red-s": ["female athlete triad"],
  fai: ["femoroacetabular"], fais: ["femoroacetabular"],
  eswt: ["extracorporeal"], ra: ["rheumatoid"],
  doms: ["delayed onset muscle"], cpg: ["guideline"], ai: ["machine learning"],
})) ALIASES[term].push(...related);

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

/** 查一個詞或片語的所有展開詞（含自身）；查不到則保留原詞。 */
export function expandToken(token: string): string[] {
  const normalized = token.toLowerCase().trim().replace(/\s+/g, " ");
  const extra = ALIASES[normalized] ?? JOURNAL_ALIASES[normalized] ?? [];
  // Treat inherited object properties (e.g. constructor / __proto__) as ordinary text.
  return [normalized, ...(Array.isArray(extra) ? extra : [])];
}
