import { useEffect, useState } from 'react';
import type { Draft, DraftVersion, Job } from '../shared/contracts';
import { errorText, privateApi } from './privateApi';

function fields(draft: Draft): Record<string, string> {
  return { 'Facebook 貼文': draft.post, 'Instagram 說明': draft.igCaption, '製作備註': draft.notes,
    ...Object.fromEntries(draft.pages.map((page, index) => [`第 ${index + 1} 頁（${page.id}）`, [page.title, page.subtitle, ...(page.cards || []).map(card => `${card.title}\n${card.body}`)].filter(Boolean).join('\n')])),
    '主張與來源': draft.claims.map(claim => `${claim.text}\n${claim.locator}\n${claim.quote}`).join('\n\n') };
}
export default function DraftHistory({ job, disabled, onUpdate }: { job: Job; disabled: boolean; onUpdate: (job: Job) => void }) {
  const [open, setOpen] = useState(false), [versions, setVersions] = useState<DraftVersion[]>([]);
  const [selected, setSelected] = useState(''), [version, setVersion] = useState<DraftVersion | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    privateApi<{ versions: DraftVersion[] }>(`/jobs/${job.id}/versions`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setVersions(result.versions); setMore(result.versions.length === 50); setError(''); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [job.id, job.draftRevision, open]);
  useEffect(() => {
    setVersion(null);
    if (!selected) return;
    const controller = new AbortController();
    privateApi<{ version: DraftVersion }>(`/jobs/${job.id}/versions/${selected}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setVersion(result.version); setError(''); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [selected, job.id]);
  const restore = async () => {
    if (disabled || busy || !version) return;
    setBusy(true); setError('');
    try {
      const result = await privateApi<{ job: Job }>(`/jobs/${job.id}/restore`, { method: 'POST', body: { revision: job.revision, version: version.revision } });
      onUpdate(result.job); setSelected(''); setNotice('已還原為新版本，原有歷史仍保留。');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const loadMore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await privateApi<{ versions: DraftVersion[] }>(`/jobs/${job.id}/versions?before=${versions[versions.length - 1]?.revision}`);
      setVersions(current => [...current, ...result.versions]); setMore(result.versions.length === 50);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const older = version?.draft ? fields(version.draft) : {}, current = job.draft ? fields(job.draft) : {};
  const differences = [...new Set([...Object.keys(older), ...Object.keys(current)])].filter(key => older[key] !== current[key]);
  return <details className="wb-panel" onToggle={event => setOpen(event.currentTarget.open)}><summary className="wb-history-heading">草稿版本紀錄</summary>
    <p className="wb-small">還原會建立新版本；既有版本與審核紀錄會保留。先儲存目前修改，再選擇要還原的版本。</p>
    <label className="wb-form">選擇歷史版本<select aria-label="選擇歷史版本" value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>
      <option value="">請選擇版本</option>{versions.map(item => <option key={item.revision} value={item.revision}>版本 {item.revision} · {new Date(item.createdAt).toLocaleString('zh-TW')}{item.restoredFrom ? `（還原自 ${item.restoredFrom}）` : ''}</option>)}
    </select></label>
    {more && <button className="wb-button is-quiet" disabled={busy} onClick={() => void loadMore()}>載入更早版本</button>}
    {version?.draft && <><h3>版本 {version.revision} 與目前已儲存草稿比較</h3>
      {differences.length ? <div className="wb-diff-scroll"><table className="wb-diff"><thead><tr><th>欄位</th><th>歷史版本</th><th>目前版本</th></tr></thead><tbody>{differences.map(key => <tr key={key}><th scope="row">{key}</th><td>{older[key] || '（空白）'}</td><td>{current[key] || '（空白）'}</td></tr>)}</tbody></table></div> : <p className="wb-small">文字與目前版本相同。</p>}
      <button className="wb-button" disabled={disabled || busy || !differences.length} onClick={() => void restore()}>{busy ? '還原中…' : '還原為新版本'}</button>
    </>}
    {error && <p className="wb-alert" role="alert">{error}</p>}{notice && <p className="wb-notice" role="status">{notice}</p>}
  </details>;
}
