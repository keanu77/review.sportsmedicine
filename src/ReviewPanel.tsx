import { useEffect, useState } from 'react';
import type { Job, ReviewDisposition, ReviewRun } from '../shared/contracts';
import { errorText, privateApi } from './privateApi';
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const label: Record<string, string> = { claude: 'Claude', gemini: 'Gemini', grok: 'Grok' };

function FindingDecision({ jobId, run, provider, index, onUpdate }: { jobId: string; run: ReviewRun; provider: string; index: number; onUpdate: (runs: ReviewRun[]) => void }) {
  const saved = run.dispositions.find(item => item.provider === provider && item.findingIndex === index);
  const [status, setStatus] = useState<ReviewDisposition['status']>(saved?.status || 'pending');
  const [reason, setReason] = useState(saved?.reason || ''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const name = `${label[provider]} 意見 ${index + 1}`;
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await privateApi<{ runs: ReviewRun[] }>(`/jobs/${jobId}/reviews/${run.id}/findings/${provider}/${index}`, { method: 'PATCH', body: { status, reason } });
      onUpdate(result.runs); setMessage('意見處理紀錄已儲存。');
    } catch (cause) { setMessage(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <div className="wb-decision wb-form">
    <label>{name} 處理狀態<select value={status} disabled={busy} onChange={event => setStatus(event.target.value as ReviewDisposition['status'])}><option value="pending">待確認</option><option value="resolved">已修正</option><option value="rejected">不採納</option></select></label>
    <label>{name} 處理理由<textarea rows={2} maxLength={2000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder={status === 'rejected' ? '不採納時請說明理由' : '記錄修改方式或判斷依據'} /></label>
    <button className="wb-button is-quiet" disabled={busy || (status === 'rejected' && !reason.trim())} onClick={() => void save()}>儲存 {name}</button>
    {saved?.updatedAt && <p className="wb-small">處理於草稿版本 {saved.draftRevision} · {new Date(saved.updatedAt).toLocaleString('zh-TW')}</p>}
    {message && <p className="wb-notice" role="status">{message}</p>}
  </div>;
}
export default function ReviewPanel({ job, edited, editable = false, onUpdate }: { job: Job; edited: boolean; editable?: boolean; onUpdate?: (job: Job) => void }) {
  const [runs, setRuns] = useState<ReviewRun[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('');
  // Findings chosen for a model revision, as provider:index into the job's current reviews.
  const [adopted, setAdopted] = useState<Set<string>>(new Set()), [instructions, setInstructions] = useState(''), [revising, setRevising] = useState(false), [reviseError, setReviseError] = useState('');
  const revise = async () => {
    if (revising || !onUpdate) return;
    setRevising(true); setReviseError('');
    try {
      const findings = [...adopted].map(value => { const [provider, index] = value.split(':'); return { provider, index: Number(index) }; });
      const result = await privateApi<{ job: Job }>(`/jobs/${encodeURIComponent(job.id)}/revise`, { method: 'POST', body: { revision: job.revision, findings, instructions: instructions.trim() } });
      setAdopted(new Set()); setInstructions(''); onUpdate(result.job);
    } catch (cause) { setReviseError(errorText(cause)); }
    finally { setRevising(false); }
  };
  useEffect(() => {
    const controller = new AbortController();
    privateApi<{ runs: ReviewRun[] }>(`/jobs/${job.id}/reviews`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setRuns(result.runs); setError(''); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [job.id, job.metadata.reviewRunId]);
  const run = runs.find(item => item.id === (selected || job.metadata.reviewRunId)) || (!selected ? runs[0] : undefined);
  const reviews = run?.reviews || (Array.isArray(job.metadata.reviews) ? job.metadata.reviews : Object.entries(record(job.metadata.reviews)).map(([provider, item]) => ({ ...record(item), provider })));
  const checkedVersion = run ? run.draftRevision : job.metadata.reviewsDraftRevision;
  const stale = edited || (typeof checkedVersion === 'number' && checkedVersion !== job.draftRevision && job.draftRevision != null);
  // Only the current reviews can be adopted: the server resolves provider:index against them.
  const current = !run || run.id === job.metadata.reviewRunId;
  return <section className="wb-panel"><h2>模型審核紀錄</h2><p className="wb-small">「已執行」表示模型回傳結果，不代表內容已通過醫學查核。下方保留未執行與失敗紀錄。</p>
    <p className={stale ? 'wb-notice' : 'wb-small'}>{typeof checkedVersion === 'number' ? `審核對應草稿版本 ${checkedVersion}${stale ? '；目前文字已有變更，請重新審核。' : '。'}` : '這些模型意見針對生成時的初稿；人工修改後尚未重新查核。舊紀錄未保存確切草稿版本。'}</p>
    {runs.length > 1 && <label className="wb-form">查看審核批次<select value={run?.id || ''} onChange={event => setSelected(event.target.value)}>{runs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('zh-TW')} · {item.draftRevision ? `草稿版本 ${item.draftRevision}` : '舊紀錄（版本未記錄）'}</option>)}</select></label>}
    {error && <p className="wb-small">審核歷史暫時無法載入，先顯示任務保存的意見。{error}</p>}
    <div className="wb-reviewers">{['claude','gemini','grok'].map(provider => {
      const review = reviews.map(record).find(item => text(item.provider).toLowerCase() === provider);
      const status = text(review?.status), findings: Record<string, any>[] = Array.isArray(review?.findings) ? review.findings.map(record) : [];
      return <details key={provider} className="wb-review"><summary><strong>{label[provider]}</strong><span className="wb-small">{status === 'ran' ? `已執行 · ${findings.length} 項意見` : status === 'failed' ? '執行失敗' : '未執行／無法使用'}</span></summary>
        {review ? <div className="wb-review-body"><p className="wb-small">{text(review.role)} {text(review.checkedAt)}</p>{(review.summary || review.error) && <p>{text(review.summary) || text(review.error) || text(record(review.error).message)}</p>}
          {findings.map((finding, index) => <div key={`${run?.id || 'legacy'}-${index}`} className="wb-finding"><p><strong>{text(finding.severity)}</strong> · {text(finding.claim)}</p><p>{text(finding.reason)}</p>{finding.suggestion && <p>建議：{text(finding.suggestion)}</p>}{finding.quote && <blockquote>{text(finding.quote)}</blockquote>}<p className="wb-small">{text(finding.locator)} · {finding.sourceVerified === true ? '來源片段已比對' : '模型意見，未核對來源'}</p>
            {editable && current && onUpdate && <label className="wb-check"><input type="checkbox" checked={adopted.has(`${provider}:${index}`)} onChange={event => setAdopted(value => { const next = new Set(value); if (event.target.checked) next.add(`${provider}:${index}`); else next.delete(`${provider}:${index}`); return next; })} /> 修訂時採納這條意見</label>}
            {run && <FindingDecision jobId={job.id} run={run} provider={provider} index={index} onUpdate={setRuns} />}
          </div>)}
          {status === 'ran' && findings.length === 0 && <p className="wb-small">本次沒有回傳問題項目，仍需人工確認。</p>}
        </div> : <p className="wb-review-body wb-small">這個任務沒有此模型的執行紀錄。</p>}
      </details>;
    })}</div>
    {editable && onUpdate && <div className="wb-revise wb-form">
      <h3>依審核修訂草稿</h3>
      <p className="wb-small">Mac 會依勾選的意見、製作前檢查的問題和你的補充說明改寫草稿：已鎖定的主張原樣保留，已駁回的主張會被移除。修訂後會成為新版本，舊版可在版本歷史還原。會使用一次模型額度。</p>
      <label>補充說明（選填）<textarea rows={2} maxLength={1000} value={instructions} disabled={revising} onChange={event => setInstructions(event.target.value)} placeholder="例如：語氣更口語、封面問句更直接" /></label>
      <button className="wb-button is-primary" disabled={revising || edited || (!adopted.size && !instructions.trim())} onClick={() => void revise()}>{revising ? '排入修訂中…' : `依 ${adopted.size} 條意見修訂草稿`}</button>
      {edited && <p className="wb-small">草稿有尚未儲存的修改，請先儲存。</p>}
      {reviseError && <div role="alert" className="wb-alert">{reviseError}</div>}
    </div>}
  </section>;
}
