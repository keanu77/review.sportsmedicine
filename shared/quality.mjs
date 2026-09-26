// Pre-render quality gate shared by the browser, the Pages API and the Mac worker.
// Ported from the topic-flow claims-check gate (numbers, §85, 病歷, disclaimer,
// style) and extended for single-paper drafts: claims are locked by the owner,
// numbers are checked against the verified full text, and simplified
// characters are rejected. Pure functions only: no I/O, no Node APIs.

// Review seats (Claude writes, Codex reviews). Codex had the best recall in the
// 2026-09-25 benchmark, so its findings count by default and it must have run.
export const PRIMARY_REVIEWER = 'codex';
export const REVIEW_SEATS = {
  codex: { label: 'Codex', role: '主審', note: '意見預設成立；駁回須附理由' },
  claude: { label: 'Claude', role: '副審', note: '與寫稿同家族，不影響主審結論' },
  grok: { label: 'Grok', role: '副審', note: '第三意見' },
  gemini: { label: 'Gemini', role: '選配', note: '補充資訊，不作對錯判斷' },
};

export const DISCLAIMER = '本內容僅供衛教參考，無法取代醫師診察、超音波或 MRI 等影像檢查。症狀持續或惡化請就醫。';
const DISCLAIMER_RE = /僅供衛教參考|無法取代醫師/;

// Baseline §85 list written for this public repo from the Medical Care Act's
// commonly prohibited guarantee wording. high = error, medium = warning.
export const COMPLIANCE = [
  ...['療效保證', '保證療效', '保證有效', '保證治癒', '保證根治', '保證痊癒', '保證改善', '絕對有效', '絕對治癒', '完全根治', '徹底根治', '徹底根除', '永久治癒', '永不復發', '終身不復發', '百分百有效', '100%有效', '無效退費', '藥到病除', '一次見效', '立即見效', '馬上見效', '零副作用', '無副作用', '零風險', '無任何風險', '最有效', '唯一有效'].map(phrase => ({ phrase, severity: 'high' })),
  ...['根治', '治癒率', '痊癒', '神效', '奇蹟', '特效', '最先進', '最權威', '第一名', '名醫', '免開刀', '不用開刀', '取代手術', '不會復發', '一定有效', '一定會好', '保證'].map(phrase => ({ phrase, severity: 'medium' })),
];

// Characters used only in Simplified Chinese. Forms that are also valid
// Traditional characters (后 里 干 台 只 系 面 准 余 于 松 周 冲 斗 云 术 叶 却) are excluded.
const SIMPLIFIED = new Set([...'据种这个们为来时说会对发经过还进动应实现体见关点开问间长头东车门马书业产从众优伤价传伦儿两严乐习买亚仅华协单卖厂历压厅县参双变号启围国图圣场坏块坚报声处备复夺奋妇学宁宝审宪导寿将层岁岛币师帐带帮广庆库废弃张弯录归当彻征忆态总恶惊惯战户执扩扫扬护担拟拥择换损摄敌数断无旧显晓机杀权条杨极构枪样桥检欢气汉汤沟没泽洁测济浅满灭灯灵热爱牵状独猎环电画疗疡盖监确离积称稳穷竞笔简类纪约级纸线组细结给绝统继续维综绿缓网罗职联肤胜脑脏腾舰艺节苏药获虽规视览觉触计认让议记讲许论设证评识诉诊词试话该详语误请读谁调谈谢质购贵费资赛赵跃践转轮软轻载较辆输边达迁运远连选递释钟钱铁锻键闭闻阅队阶际陈险随隐难雾须顶项顺预领频题额风飞饭驱验鱼鲜鸡齐龄医与么']);

const UNITS = '%|週|個月|年|天|日|次|倍|公分|cm|mm|公斤|kg|歲|小時|分鐘|秒|成|位|人|篇|項|度|°';
const NUMBER_RE = new RegExp(`\\d+(?:\\.\\d+)?(?:%)?(?:(?:-|~|至|到)\\d+(?:\\.\\d+)?)?(?:${UNITS})`, 'g');
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };

export function normalize(text) {
  return String(text ?? '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/％/g, '%').replace(/．/g, '.').replace(/[～〜]/g, '~').replace(/[–—－]/g, '-')
    .replace(/周/g, '週').replace(/百分之百/g, '100%');
}

export function extractNumbers(text) {
  const compact = normalize(text)
    .replace(/(\d%?)\s*(-|~|至|到)\s*(\d)/g, '$1$2$3')
    .replace(new RegExp(`(\\d)\\s+(${UNITS})`, 'g'), '$1$2');
  return compact.match(NUMBER_RE) ?? [];
}

const canonical = value => String(Number(value));
const valuesOf = token => (token.match(/\d+(?:\.\d+)?/g) ?? []).map(canonical);

// Every number in a verified full text, including small counts written as words.
export function sourceNumberSet(text) {
  const plain = normalize(text);
  const values = new Set((plain.match(/\d+(?:\.\d+)?/g) ?? []).map(canonical));
  for (const word of plain.toLowerCase().match(/[a-z]+/g) ?? []) if (WORD_NUMBERS[word]) values.add(String(WORD_NUMBERS[word]));
  return [...values].slice(0, 6000);
}

// Stable key for an owner decision on one claim (FNV-1a, two lanes, 16 hex chars).
export function claimKey(claim) {
  const input = `${claim.text}\u0000${claim.locator}\u0000${claim.quote}`;
  let a = 0x811c9dc5, b = 0x01000193 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function withDisclaimer(text) {
  return DISCLAIMER_RE.test(text) ? text : `${String(text).trimEnd()}\n\n${DISCLAIMER}`;
}

// Every piece of owner-facing draft text with a human-readable location.
function fields(draft) {
  const out = [['FB 貼文', draft.post], ['IG 文案', draft.igCaption]];
  draft.pages.forEach((page, i) => {
    const at = `第 ${i + 1} 頁`;
    out.push([`${at}標題`, page.title], [`${at}副標`, page.subtitle ?? '']);
    (page.cards ?? []).forEach((card, j) => out.push([`${at}重點 ${j + 1}`, `${card.title}\n${card.body}`]));
  });
  return out;
}

const dispositionOf = (dispositions, index) => dispositions?.[`${PRIMARY_REVIEWER}:${index}`];

// Primary findings the owner rejected, with the reason shown to the doctor.
export function primaryRejections(reviews, dispositions) {
  const review = (Array.isArray(reviews) ? reviews : []).find(item => item?.provider === PRIMARY_REVIEWER);
  return (review?.findings ?? []).flatMap((finding, index) => {
    const decision = dispositionOf(dispositions, index);
    return decision?.status === 'rejected' ? [{ index, severity: finding.severity, claim: finding.claim, reason: finding.reason, suggestion: finding.suggestion, locator: finding.locator, quote: finding.quote, rejection: decision.reason }] : [];
  });
}

export function rejectionsMarkdown(rejections) {
  const head = `# 主審（${REVIEW_SEATS[PRIMARY_REVIEWER].label}）駁回清單\n\n主審意見預設成立；以下是作者判定不成立的意見與理由，請醫師過目。\n`;
  if (!rejections?.length) return `${head}\n沒有被駁回的主審意見。\n`;
  return `${head}\n${rejections.map(item => `## 意見 ${item.index + 1}（${item.severity}）\n\n- 主審原意見：${item.claim}\n- 主審理由：${item.reason}\n${item.quote ? `- 原文：${item.quote}（${item.locator}）\n` : ''}- 駁回理由：${item.rejection}\n`).join('\n')}`;
}

// Gate B: the primary reviewer ran on this job and the owner settled each of its findings.
function checkPrimary({ reviews, dispositions }, error) {
  const { label } = REVIEW_SEATS[PRIMARY_REVIEWER];
  const review = (Array.isArray(reviews) ? reviews : []).find(item => item?.provider === PRIMARY_REVIEWER);
  if (review?.status !== 'ran') { error('PRIMARY_REVIEW_MISSING', '模型審核', `主審 ${label} ${review ? '這次沒有成功執行' : '尚未審核'}；請按「重新審核目前版本」`); return; }
  const open = (review.findings ?? []).filter((_, index) => !['resolved', 'rejected'].includes(dispositionOf(dispositions, index)?.status)).length;
  if (open) error('PRIMARY_FINDINGS_OPEN', '模型審核', `主審 ${label} 還有 ${open} 條意見未處理；每條要標「已修正」或「不採納」並附理由`);
}

export function checkDraft(draft, { claimReview, sourceNumbers, review } = {}) {
  const errors = [], warnings = [];
  const error = (code, where, message, overridable = false) => errors.push({ code, where, message, overridable });
  const warn = (code, where, message) => warnings.push({ code, where, message });

  // Gate A: the owner decides every claim before anything is rendered.
  const decisions = claimReview?.decisions ?? {};
  const statuses = draft.claims.map(claim => decisions[claimKey(claim)]?.status);
  const undecided = statuses.filter(status => status !== 'locked' && status !== 'rejected').length;
  if (undecided) error('CLAIMS_UNDECIDED', '研究主張', `還有 ${undecided} 條主張尚未鎖定或駁回`);
  if (statuses.some(status => status === 'rejected')) error('CLAIM_REJECTED_PRESENT', '研究主張', '已駁回的主張仍在草稿中；請依審核修訂草稿，或手動刪除相關文字');
  if (!undecided && !statuses.includes('locked')) error('NO_LOCKED_CLAIM', '研究主張', '至少要鎖定一條主張');
  if (review) checkPrimary(review, error);

  const lockedValues = new Set(draft.claims.filter(c => decisions[claimKey(c)]?.status === 'locked').flatMap(c => [...extractNumbers(c.text), ...extractNumbers(c.quote)].flatMap(valuesOf).concat((`${c.text} ${c.quote}`.match(/\d+(?:\.\d+)?/g) ?? []).map(canonical))));
  const source = Array.isArray(sourceNumbers) && sourceNumbers.length ? new Set(sourceNumbers) : null;

  for (const [where, text] of fields(draft)) {
    if (!text) continue;
    const found = [...new Set([...text].filter(char => SIMPLIFIED.has(char)))];
    if (found.length) error('SIMPLIFIED', where, `出現簡體字：${found.join('、')}`);
    const plain = normalize(text);
    for (const item of COMPLIANCE) if (plain.includes(item.phrase)) {
      if (item.severity === 'high') error('COMPLIANCE', where, `§85 禁用語「${item.phrase}」`, true);
      else warn('COMPLIANCE', where, `§85 注意用語「${item.phrase}」，請確認語境`);
    }
    if (text.includes('病歷')) error('MEDICAL_RECORD', where, '出現「病歷」，請改用分數、紀錄或評估結果');
    for (const token of extractNumbers(text)) {
      const values = valuesOf(token);
      if (source) { if (values.some(value => !source.has(value))) error('NUMBER_NOT_IN_SOURCE', where, `數字「${token}」在已核對的原文中找不到`, true); }
      else if (values.some(value => !lockedValues.has(value))) warn('NUMBER_NOT_IN_CLAIMS', where, `數字「${token}」不在已鎖定主張中，請回原文確認`);
    }
    if (/不是[^，。！？\n]{1,20}[，,]\s*而是/.test(text) || /不只是.{1,20}更是|不僅.{1,20}更/.test(text)) warn('NOT_BUT', where, '「不是…而是」同族句式，容易有 AI 腔');
    if (/——|—/.test(text)) warn('DASH', where, '破折號，建議改用逗號或句號');
  }
  for (const [where, text] of [['FB 貼文', draft.post], ['IG 文案', draft.igCaption]]) {
    // Exports always append it (see worker/render.mjs), so a missing one never blocks.
    if (!DISCLAIMER_RE.test(text)) warn('DISCLAIMER', where, '尚未寫免責聲明；輸出時會自動附在文末');
  }
  return { errors, warnings };
}
