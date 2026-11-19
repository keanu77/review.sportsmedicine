import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { makePilotFeedback, PILOT_TOPICS, validatePilotData, type PilotCard, type PilotData, type PilotTopic } from './kbPilot';
import { learningReport, parseLocalOverlay } from './kbLearning';

const action = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-linestrong px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark';
const sourceLink = 'text-brand underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-brand-dark';
const input = 'w-full rounded-lg border border-linestrong bg-surface px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:bg-surface-dark dark:text-ink-dark';
const draftLabels = { design: '研究設計', population: '研究族群', intervention: '介入或評估', comparison: '對照與追蹤', results: '研究結果', limitations: '限制與待核對處' } as const;
type LocalNotes = ReturnType<typeof parseLocalOverlay>['notes'];
function abstractLocation(locator: string): string {
  const sections: Record<string, string> = { METHODS: '方法', METHOD: '方法', RESULTS: '結果', RESULT: '結果', BACKGROUND: '背景', OBJECTIVE: '目的', OBJECTIVES: '目的', CONCLUSION: '結論', CONCLUSIONS: '結論' };
  if (locator.toLowerCase() === 'abstract') return '原始摘要';
  if (locator.includes(';')) return locator.split(';').map(part => abstractLocation(part.trim())).join('、');
  const part = locator.match(/^abstract:(.+)$/i)?.[1].trim().toUpperCase();
  return part && sections[part] ? `摘要・${sections[part]}` : locator;
}

function LocalFeedback({ data, count, onReplace }: { data: PilotData; count: number; onReplace: (notes: LocalNotes) => void }) {
  const id = useId();
  const request = useRef(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => () => { request.current += 1; }, []);
  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const current = ++request.current;
    setMessage(''); setError('');
    if (file.size > 1_048_576) { setLoading(false); setError('檔案超過 1 MiB，未套用；既有批註保持不變。'); return; }
    setLoading(true);
    try {
      const value: unknown = JSON.parse(await file.text());
      if (current !== request.current) return;
      const result = parseLocalOverlay(value, data);
      onReplace(result.notes);
      const applied = Object.keys(result.notes).length;
      setMessage(applied ? `已載入 ${applied} 篇本機批註。${result.skipped ? `另有 ${result.skipped} 筆非閱讀卡修正未套用。` : ''}` : `此檔案沒有有效的閱讀卡批註，已清除原有批註。${result.skipped ? `另有 ${result.skipped} 筆非閱讀卡修正未套用。` : ''}`);
    } catch {
      if (current === request.current) setError('無法套用本機審核檔。請確認來源版本、審核狀態與檔案格式；既有批註保持不變。');
    } finally {
      if (current === request.current) setLoading(false);
    }
  };
  const clear = () => {
    request.current += 1; onReplace({}); setError(''); setLoading(false); setMessage('本機批註已清除。');
  };
  return <section aria-labelledby={`${id}-heading`} className="space-y-3 rounded-xl border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark print:hidden">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id={`${id}-heading`} className="font-semibold text-ink dark:text-ink-dark">套用本機審核結果</h2><span className="text-xs text-muted dark:text-muted-dark">目前 {count} 篇批註</span></div>
    <p id={`${id}-help`} className="text-sm leading-relaxed text-muted dark:text-muted-dark">載入審核工具匯出的 JSON，核對版本後顯示已接受的閱讀卡批註。每次載入會完整替換；撤回後重新載入即可移除批註。內容只留在這次頁面，不上傳或加入醫學證據。</p>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1"><label className="mb-1 block text-sm font-medium" htmlFor={`${id}-file`}>載入本機審核檔</label><input id={`${id}-file`} type="file" accept=".json,application/json" onChange={load} aria-describedby={`${id}-help`} className="block min-h-11 w-full max-w-full rounded-lg text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-linestrong file:bg-surface-alt file:px-3 file:font-medium file:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:file:border-linestrong-dark dark:file:bg-surface-altdark dark:file:text-body-dark" /></div>
      <button type="button" onClick={clear} disabled={count === 0 && !loading} className={`${action} disabled:cursor-default disabled:opacity-50`}>清除本機批註</button>
    </div>
    {loading && <p role="status" className="text-sm text-muted dark:text-muted-dark">正在核對本機審核檔…</p>}
    {message && <p role="status" className="text-sm text-brand dark:text-brand-dark">{message}</p>}
    {error && <p role="alert" className="text-sm text-amber-900 dark:text-amber-200">{error}</p>}
  </section>;
}

function DraftEvidence({ card }: { card: PilotCard }) {
  const draft = card.evidenceDraft;
  if (!draft) return card.evidenceMissingReason ? <p className="rounded-lg bg-surface-alt p-3 text-sm text-muted dark:bg-surface-altdark dark:text-muted-dark">摘要草稿尚未產生：{card.evidenceMissingReason}</p> : null;
  return <section aria-label="摘要閱讀草稿" className="space-y-3 rounded-lg border border-line bg-surface-alt p-4 dark:border-line-dark dark:bg-surface-altdark">
    <header className="space-y-1"><h4 className="font-semibold text-ink dark:text-ink-dark">摘要閱讀草稿</h4><p className="text-xs leading-relaxed text-muted dark:text-muted-dark">AI 依原始摘要整理，尚未完成臨床評讀。</p>{card.evidenceStatus === 'quarantined' && <p className="text-xs leading-relaxed text-muted dark:text-muted-dark">本草稿來自獨立核對的原始摘要，未使用已隔離的知識庫全文。</p>}</header>
    <dl className="grid gap-4 sm:grid-cols-2">{draft.sections.map(section => <div key={section.key} className="min-w-0"><dt className="text-sm font-semibold text-ink dark:text-ink-dark">{draftLabels[section.key]}</dt><dd className="mt-1 break-words text-sm leading-relaxed"><p>{section.text}</p><span className="mt-1 block text-xs text-muted dark:text-muted-dark"><a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer" className={sourceLink}>核對原始摘要 ↗</a> · {abstractLocation(section.locator)}</span></dd></div>)}</dl>
    <p className="text-xs text-muted dark:text-muted-dark">來源查核 {draft.sourceCheckedAt.slice(0, 10)}；摘要未提供的細節仍需回原文確認。</p>
  </section>;
}

function ReadingChecklist({ card }: { card: PilotCard }) {
  return <dl className="grid gap-4 sm:grid-cols-2">{card.fields.map(field => <div key={field.key} className="min-w-0">
    <dt className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink dark:text-ink-dark">{field.label}<span className="text-xs font-normal text-muted dark:text-muted-dark">{field.status === 'title-context' ? '依題名整理，待核對原文' : '尚待評讀'}</span></dt>
    <dd className="mt-1 break-words text-sm leading-relaxed">{field.text}<span className="mt-1 block text-xs text-muted dark:text-muted-dark"><a href={field.sourceUrl} className={sourceLink} target="_blank" rel="noopener noreferrer">核對來源 ↗</a> · {field.locator === 'title' ? '原始題名' : field.locator.includes('not') ? '原文尚待評讀' : field.locator}</span></dd>
  </div>)}</dl>;
}

function SourceAccess({ card }: { card: PilotCard }) {
  const access = card.access;
  if (!access) return null;
  const freeLabel = access.freeFullText === 'verified' ? '來源列有免費全文' : access.freeFullText === 'inferred' ? '可能有免費全文，待核對' : '免費全文未確認';
  const oaLabel = access.oaStatus === 'yes' ? 'Europe PMC OA：已標記' : access.oaStatus === 'no' ? 'Europe PMC OA：未標記' : 'Europe PMC OA：未知';
  return <section aria-label="全文與授權" className="space-y-2 border-t border-line pt-3 dark:border-line-dark">
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted dark:text-muted-dark"><span>{freeLabel}</span><span>{oaLabel}</span><span>{access.license ? `來源授權：${access.license}` : '再利用授權未確認'}</span></div>
    {access.url && access.freeFullText !== 'unknown' && <a href={access.url} target="_blank" rel="noopener noreferrer" className={`${sourceLink} inline-flex min-h-11 items-center text-sm`}>{access.freeFullText === 'verified' ? '來源列出的免費全文 ↗' : '查看可能的免費全文 ↗'}</a>}
    <p className="text-xs text-muted dark:text-muted-dark">來源查核 {access.checkedAt.slice(0, 10)}。免費閱讀與再利用授權分開核對；未確認不表示付費。</p>
  </section>;
}

function FeedbackForm({ card, version }: { card: PilotCard; version: string }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [proposed, setProposed] = useState('');
  const [message, setMessage] = useState('');
  const download = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim() || !proposed.trim()) { setMessage('請填寫修正原因與建議內容。'); return; }
    try {
      const feedback = makePilotFeedback(card, version, reason, proposed);
      const url = URL.createObjectURL(new Blob([JSON.stringify(feedback, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `review-kb-feedback-${feedback.id}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('修正檔已下載，尚未送出或套用；請交由維護者核對。');
    } catch { setMessage('無法下載修正檔，請重試；填寫內容仍保留在此頁。'); }
  };
  return <details className="border-t border-line pt-2 dark:border-line-dark print:hidden">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-brand dark:text-brand-dark">提出閱讀卡修正</summary>
    <p className="mb-3 text-sm text-muted dark:text-muted-dark">下載待審核的修正檔，附上這張卡的來源版本。此頁不會傳送資料，也不會更動知識庫；請勿填入病人或其他私人資訊。</p>
    <form onSubmit={download} className="space-y-3">
      <div><label htmlFor={`${id}-reason`} className="mb-1 block text-sm font-medium">修正原因</label><textarea id={`${id}-reason`} className={input} rows={2} maxLength={1000} required value={reason} onChange={event => setReason(event.target.value)} placeholder="哪個欄位需要核對？原文有什麼依據？" /></div>
      <div><label htmlFor={`${id}-proposed`} className="mb-1 block text-sm font-medium">建議修正內容</label><textarea id={`${id}-proposed`} className={input} rows={3} maxLength={4000} required value={proposed} onChange={event => setProposed(event.target.value)} placeholder="請附原文段落或表格位置，方便逐項查核。" /></div>
      <button type="submit" className={`${action} bg-brand text-white dark:bg-brand-dark dark:text-page-dark`}>下載待審核修正</button>
      <p role="status" className="text-sm text-brand dark:text-brand-dark">{message}</p>
    </form>
  </details>;
}

function ReadingCard({ card, version, position, note }: { card: PilotCard; version: string; position: number; note?: LocalNotes[string] }) {
  const headingId = useId();
  const isolated = card.evidenceStatus === 'quarantined';
  const identityLabel = card.identityStatus === 'conflict' ? '來源有衝突・已隔離' : card.identityStatus === 'matched' ? '知識庫書目已對應' : '知識庫本次未對應';
  return <article aria-labelledby={headingId} className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark sm:p-5">
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted dark:text-muted-dark">
        <span className="font-display font-semibold">{String(position).padStart(2, '0')}</span>
        <span>{card.year || '年份未提供'}</span>
        <span className={`rounded-full px-2 py-1 font-medium ${isolated ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-surface-alt text-body dark:bg-surface-altdark dark:text-body-dark'}`}>{identityLabel}</span>
        <span>{card.reviewUrl ? 'Review 已收錄' : 'Review 待收錄'}</span>
      </div>
      <h3 id={headingId} lang="en" className="break-words text-lg font-semibold leading-snug text-ink dark:text-ink-dark">{card.title}</h3>
      <p className="break-words text-xs text-muted dark:text-muted-dark">{card.doi ? `DOI ${card.doi}` : `PMID ${card.pmid}`}{card.doi && card.pmid ? ` · PMID ${card.pmid}` : ''}</p>
    </header>
    {card.warnings.length > 0 && <aside aria-label="來源提醒" className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{card.warnings.map((warning, i) => <p key={i}>{warning}</p>)}{isolated && <p className="font-medium">此卡未採用有衝突的全文或其臨床結論。</p>}</aside>}
    {note && <aside aria-label="本機審核批註" className="space-y-2 rounded-lg border border-brand/35 bg-brand/5 p-3 dark:border-brand-dark/40 dark:bg-brand-dark/10"><h4 className="text-sm font-semibold text-brand dark:text-brand-dark">本機審核批註</h4><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{note.text}</p><p className="break-words text-xs text-muted dark:text-muted-dark">操作者：{note.reviewer} · {note.reviewedAt.slice(0, 10)} · 核對說明：{note.reason}</p><p className="text-xs text-muted dark:text-muted-dark">這是本機操作者的審核紀錄，未作為新的醫學證據。</p></aside>}
    <section aria-label="研究問題" className="rounded-lg bg-surface-alt p-3 dark:bg-surface-altdark"><h4 className="text-xs font-semibold text-muted dark:text-muted-dark">閱讀時要回答的問題</h4><p className="mt-1 text-sm leading-relaxed">{card.question}</p></section>
    <DraftEvidence card={card} />
    {card.fields.length > 0 && (card.evidenceDraft ? <details className="rounded-lg border border-line p-3 dark:border-line-dark"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">閱讀核對清單</summary><ReadingChecklist card={card} /></details> : <ReadingChecklist card={card} />)}
    {card.abstractExcerpt && <section aria-label="原始摘要節錄" className="space-y-1 border-l-2 border-linestrong pl-3 dark:border-linestrong-dark"><h4 className="text-xs font-semibold text-muted dark:text-muted-dark">原始摘要節錄</h4><p lang="en" className="text-sm leading-relaxed">{card.abstractExcerpt}</p><p className="text-xs text-muted dark:text-muted-dark">節錄不超過 25 個英文詞；完整摘要請回原始來源閱讀。</p></section>}
    <SourceAccess card={card} />
    <div className="flex flex-wrap gap-2 print:hidden"><a className={`${action} text-brand dark:text-brand-dark`} href={card.sourceUrl} target="_blank" rel="noopener noreferrer">閱讀原始來源 ↗</a>{card.reviewUrl && <a className={action} href={card.reviewUrl}>Review 文獻詳情</a>}</div>
    <details className="rounded-lg border border-line px-3 dark:border-line-dark">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">查看來源與對應紀錄</summary>
      <dl className="space-y-2 pb-3 text-xs text-muted dark:text-muted-dark">
        <div><dt className="font-semibold">來源查核日期</dt><dd>{card.sourceCheckedAt.slice(0, 10)} · 書目核對不代表已評讀研究品質。</dd></div>
        <div><dt className="font-semibold">知識庫對應</dt><dd>{card.kbRefs.length ? <ul className="mt-1 space-y-1">{card.kbRefs.map(ref => <li key={`${ref.namespace}:${ref.id}`} className="break-all">{ref.namespace === 'rss-kb' ? 'RSS 知識庫' : 'Ethanai'} #{ref.id}</li>)}</ul> : '本次搜尋尚未對應到紀錄，不代表知識庫沒有收錄。'}</dd></div>
        <div><dt className="font-semibold">試點版本</dt><dd className="break-words">{version}</dd></div>
        <div><dt className="font-semibold">來源快照指紋</dt><dd className="break-all font-mono">{card.sourceFingerprint}</dd></div>
        {card.evidenceDraft && <div><dt className="font-semibold">原始摘要快照指紋</dt><dd className="break-all font-mono">{card.evidenceDraft.sourceSha256}</dd></div>}
      </dl>
    </details>
    <FeedbackForm card={card} version={version} />
  </article>;
}

export default function KbPilot() {
  const [data, setData] = useState<PilotData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [topic, setTopic] = useState<PilotTopic>('prp-knee');
  const [notes, setNotes] = useState<LocalNotes>({});
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setFailed(false); setNotes({});
    (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/kb-pilot.json`, { signal: controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('Unavailable data');
        const body = await response.text();
        if (body.length > 1_048_576) throw new Error('Oversized data');
        const parsed = validatePilotData(JSON.parse(body));
        if (!controller.signal.aborted) setData(parsed);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const previous = document.title;
    document.title = 'Review × 知識庫閱讀試點';
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'; document.head.appendChild(robots);
    return () => { document.title = previous; robots.remove(); };
  }, []);
  const cards = data?.cards.filter(card => card.topic === topic) || [];
  const report = useMemo(() => data ? learningReport(data) : null, [data]);
  return <div className="space-y-5 pb-6">
    <header className="space-y-3 border-b border-line py-5 dark:border-line-dark sm:py-7">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand dark:text-brand-dark">REVIEW × KNOWLEDGE BASE · PILOT</p>
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink dark:text-ink-dark sm:text-3xl">Review × 知識庫閱讀試點</h1>
      <p className="max-w-3xl text-sm leading-relaxed">從三個臨床主題核對文獻、找出收錄缺口，把修正交回知識庫。此處的閱讀卡用來協助評讀；文獻身分的核對，與研究結果、偏差風險及臨床適用性的評讀分開呈現。</p>
      <a className={`${sourceLink} inline-flex min-h-11 items-center text-sm`} href="/">返回文獻索引</a>
    </header>
    {failed ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><p className="font-medium">試點資料暫時無法載入</p><p className="mt-1 text-sm">資料可能尚未發布或格式不完整。請重試，或先返回一般文獻索引。</p><button className={`${action} mt-3`} type="button" onClick={() => setAttempt(value => value + 1)}>重新載入試點</button></div>
      : !data ? <p role="status" className="py-6 text-sm">正在載入試點閱讀卡…</p>
      : <>
        <div className="grid gap-3 rounded-xl bg-surface-alt p-4 dark:bg-surface-altdark sm:grid-cols-[auto_1fr]">
          <dl className="flex gap-5 text-xs text-muted dark:text-muted-dark">
            <div><dt>試點文獻</dt><dd className="mt-1 font-display text-2xl font-semibold text-ink dark:text-ink-dark">{data.cards.length}<span className="ml-1 text-xs font-normal">篇</span></dd></div>
            <div><dt>Review 已收錄</dt><dd className="mt-1 font-display text-2xl font-semibold text-ink dark:text-ink-dark">{data.cards.filter(card => card.reviewUrl).length}<span className="ml-1 text-xs font-normal">篇</span></dd></div>
            <div><dt>來源隔離</dt><dd className="mt-1 font-display text-2xl font-semibold text-ink dark:text-ink-dark">{data.cards.filter(card => card.evidenceStatus === 'quarantined').length}<span className="ml-1 text-xs font-normal">篇</span></dd></div>
          </dl>
          <div className="text-xs leading-relaxed text-muted dark:text-muted-dark sm:border-l sm:border-line sm:pl-4 dark:sm:border-line-dark"><p>{data.selectionNote}</p><p className="mt-1">試點建立 {data.generatedAt.slice(0, 10)} · Review 索引 {data.sourceUpdated.slice(0, 10)}</p></div>
        </div>
        {report && <section aria-label="雙向對應與待辦" className="space-y-3 rounded-xl border border-line p-4 dark:border-line-dark">
          <h2 className="font-semibold text-ink dark:text-ink-dark">雙向對應與待辦</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted dark:text-muted-dark">RSS 知識庫已對應</dt><dd className="mt-1 font-semibold">{report.counts.rssMatched} 篇</dd></div>
            <div><dt className="text-xs text-muted dark:text-muted-dark">Ethanai 已對應</dt><dd className="mt-1 font-semibold">{report.counts.ethanaiMatched} 篇</dd></div>
            <div><dt className="text-xs text-muted dark:text-muted-dark">Review 待收錄候選</dt><dd className="mt-1 font-semibold">{report.counts.reviewCandidates} 篇</dd></div>
            <div><dt className="text-xs text-muted dark:text-muted-dark">已整理摘要草稿</dt><dd className="mt-1 font-semibold">{report.counts.abstractDrafts} 篇</dd></div>
          </dl>
          <p className="text-xs leading-relaxed text-muted dark:text-muted-dark">對應依本次來源觀察，未命中不代表知識庫沒有收錄。候選與摘要草稿仍需核對，沒有自動改寫正式資料。</p>
          <div className="flex flex-wrap gap-2"><a className={action} href={`${import.meta.env.BASE_URL}data/kb-learning.json`} download>下載雙向差異報告</a><a className={action} href={`${import.meta.env.BASE_URL}data/kb-candidates.json`} download>下載待收錄文獻清單</a></div>
        </section>}
        <LocalFeedback data={data} count={Object.keys(notes).length} onReplace={setNotes} />
        <nav aria-label="試點主題" className="flex flex-wrap gap-2">{(Object.keys(PILOT_TOPICS) as PilotTopic[]).map(key => <button key={key} type="button" aria-pressed={topic === key} onClick={() => setTopic(key)} className={`${action} ${topic === key ? 'border-brand bg-brand text-white dark:border-brand-dark dark:bg-brand-dark dark:text-page-dark' : 'bg-surface text-body dark:bg-surface-dark dark:text-body-dark'}`}>{PILOT_TOPICS[key]}<span className="ml-2 rounded-full border border-current/25 px-1.5 text-xs">{data.cards.filter(card => card.topic === key).length}</span></button>)}</nav>
        <section aria-labelledby="pilot-topic-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-2"><h2 id="pilot-topic-heading" className="text-xl font-semibold text-ink dark:text-ink-dark">{PILOT_TOPICS[topic]}</h2><p role="status" className="text-sm text-muted dark:text-muted-dark">{cards.length} 篇閱讀卡</p></div>
          {cards.length ? cards.map((card, i) => <ReadingCard key={card.id} card={card} version={data.version} position={i + 1} note={notes[card.id]} />) : <p className="rounded-lg border border-line p-6 text-sm dark:border-line-dark">{data.cards.length ? '這個主題尚無閱讀卡；可切換其他主題。' : '此版本尚無閱讀卡。'}</p>}
        </section>
        <p className="border-t border-line pt-4 text-xs leading-relaxed text-muted dark:border-line-dark dark:text-muted-dark">本試點供教育與研究參考。待審核修正不會自動成為新的醫學證據；需回溯原始研究，核對族群、方法、結果及限制。</p>
      </>}
  </div>;
}
