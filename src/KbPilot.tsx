import { useEffect, useId, useState, type FormEvent } from 'react';
import { makePilotFeedback, PILOT_TOPICS, validatePilotData, type PilotCard, type PilotData, type PilotTopic } from './kbPilot';

const action = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-linestrong px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark';
const sourceLink = 'text-brand underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-brand-dark';
const input = 'w-full rounded-lg border border-linestrong bg-surface px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:bg-surface-dark dark:text-ink-dark';

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

function ReadingCard({ card, version, position }: { card: PilotCard; version: string; position: number }) {
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
    <section aria-label="研究問題" className="rounded-lg bg-surface-alt p-3 dark:bg-surface-altdark"><h4 className="text-xs font-semibold text-muted dark:text-muted-dark">閱讀時要回答的問題</h4><p className="mt-1 text-sm leading-relaxed">{card.question}</p></section>
    {card.fields.length > 0 && <dl className="grid gap-4 sm:grid-cols-2">{card.fields.map(field => <div key={field.key} className="min-w-0">
      <dt className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink dark:text-ink-dark">{field.label}<span className="text-xs font-normal text-muted dark:text-muted-dark">{field.status === 'title-context' ? '依題名整理，待核對原文' : '尚待評讀'}</span></dt>
      <dd className="mt-1 break-words text-sm leading-relaxed">{field.text}<span className="mt-1 block text-xs text-muted dark:text-muted-dark"><a href={field.sourceUrl} className={sourceLink} target="_blank" rel="noopener noreferrer">核對來源 ↗</a> · {field.locator === 'title' ? '原始題名' : field.locator === 'not-reviewed' ? '原文尚待評讀' : field.locator}</span></dd>
    </div>)}</dl>}
    {card.abstractExcerpt && <section aria-label="原始摘要節錄" className="space-y-1 border-l-2 border-linestrong pl-3 dark:border-linestrong-dark"><h4 className="text-xs font-semibold text-muted dark:text-muted-dark">原始摘要節錄</h4><p lang="en" className="text-sm leading-relaxed">{card.abstractExcerpt}</p><p className="text-xs text-muted dark:text-muted-dark">節錄不超過 25 個英文詞；完整摘要請回原始來源閱讀。</p></section>}
    <div className="flex flex-wrap gap-2 print:hidden"><a className={`${action} text-brand dark:text-brand-dark`} href={card.sourceUrl} target="_blank" rel="noopener noreferrer">閱讀原始來源 ↗</a>{card.reviewUrl && <a className={action} href={card.reviewUrl}>Review 文獻詳情</a>}</div>
    <details className="rounded-lg border border-line px-3 dark:border-line-dark">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">查看來源與對應紀錄</summary>
      <dl className="space-y-2 pb-3 text-xs text-muted dark:text-muted-dark">
        <div><dt className="font-semibold">來源查核日期</dt><dd>{card.sourceCheckedAt.slice(0, 10)} · 書目核對不代表已評讀研究品質。</dd></div>
        <div><dt className="font-semibold">知識庫對應</dt><dd>{card.kbRefs.length ? card.kbRefs.map(ref => `Ethanai #${ref.id}`).join('、') : '本次搜尋尚未對應到紀錄，不代表知識庫沒有收錄。'}</dd></div>
        <div><dt className="font-semibold">試點版本</dt><dd className="break-words">{version}</dd></div>
        <div><dt className="font-semibold">來源快照指紋</dt><dd className="break-all font-mono">{card.sourceFingerprint}</dd></div>
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
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setFailed(false);
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
        <nav aria-label="試點主題" className="flex flex-wrap gap-2">{(Object.keys(PILOT_TOPICS) as PilotTopic[]).map(key => <button key={key} type="button" aria-pressed={topic === key} onClick={() => setTopic(key)} className={`${action} ${topic === key ? 'border-brand bg-brand text-white dark:border-brand-dark dark:bg-brand-dark dark:text-page-dark' : 'bg-surface text-body dark:bg-surface-dark dark:text-body-dark'}`}>{PILOT_TOPICS[key]}<span className="ml-2 rounded-full border border-current/25 px-1.5 text-xs">{data.cards.filter(card => card.topic === key).length}</span></button>)}</nav>
        <section aria-labelledby="pilot-topic-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-2"><h2 id="pilot-topic-heading" className="text-xl font-semibold text-ink dark:text-ink-dark">{PILOT_TOPICS[topic]}</h2><p role="status" className="text-sm text-muted dark:text-muted-dark">{cards.length} 篇閱讀卡</p></div>
          {cards.length ? cards.map((card, i) => <ReadingCard key={card.id} card={card} version={data.version} position={i + 1} />) : <p className="rounded-lg border border-line p-6 text-sm dark:border-line-dark">{data.cards.length ? '這個主題尚無閱讀卡；可切換其他主題。' : '此版本尚無閱讀卡。'}</p>}
        </section>
        <p className="border-t border-line pt-4 text-xs leading-relaxed text-muted dark:border-line-dark dark:text-muted-dark">本試點供教育與研究參考。待審核修正不會自動成為新的醫學證據；需回溯原始研究，核對族群、方法、結果及限制。</p>
      </>}
  </div>;
}
