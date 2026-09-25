import { useEffect, useRef, useState } from "react";
import type { Job } from "../shared/contracts";
import { isPrivateSessionActive } from "./draftRecovery";
import { errorText, privateApi } from "./privateApi";

type Action = "identity" | "restart" | "delete" | "removeSource";
const IDLE_EDITABLE = ["queued", "failed", "cancelled"];

export const canEditIdentity = (job: Job) => !job.draft && IDLE_EDITABLE.includes(job.status);
export const canRestart = (job: Job) => Boolean(job.draft) && ["needs_review", "completed", "failed", "cancelled"].includes(job.status);
export const canDelete = (job: Job) => job.status !== "running";

/** Owner management actions for one job; destructive ones always ask first. */
export default function JobManagement({ job, dirty, onUpdate, onDelete }: { job: Job; dirty: boolean; onUpdate: (job: Job) => void; onDelete: (id: string) => void }) {
  const [busy, setBusy] = useState<Action | "">("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(job.input);
  const [title, setTitle] = useState(job.title);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (!editing) { setInput(job.input); setTitle(job.title); } }, [editing, job.input, job.title]);

  const run = async (action: Action, call: (signal: AbortSignal) => Promise<void>) => {
    if (busy || !isPrivateSessionActive()) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(action); setError("");
    try { await call(controller.signal); }
    catch (cause) { if (!controller.signal.aborted && isPrivateSessionActive()) setError(errorText(cause)); }
    finally { request.current = null; if (!controller.signal.aborted && isPrivateSessionActive()) setBusy(""); }
  };
  const path = `/jobs/${encodeURIComponent(job.id)}`;
  const saveIdentity = (event: React.FormEvent) => {
    event.preventDefault();
    void run("identity", async signal => {
      const result = await privateApi<{ job: Job }>(path, { method: "PATCH", signal, body: { revision: job.revision, input: input.trim(), title: title.trim() } });
      onUpdate(result.job); setEditing(false);
    });
  };
  const restart = () => {
    if (dirty) { setError("草稿有尚未儲存的修改。請先儲存，或確認不需要後再從頭重跑。"); return; }
    if (!window.confirm("從頭重跑這個任務？\n\n會重新取得全文、重新產生草稿與模型審核，會再消耗一次模型用量。\n目前的草稿會保留在版本歷史，可以還原。")) return;
    void run("restart", async signal => onUpdate((await privateApi<{ job: Job }>(`${path}/restart`, { method: "POST", signal, body: { revision: job.revision } })).job));
  };
  const remove = () => {
    if (!window.confirm(`刪除「${job.title || job.input}」？\n\n草稿、版本歷史、審核紀錄、上傳的 PDF 與所有輸出檔都會永久刪除，無法復原。\nMac 上的本機資料會在下次整理時一併清除。`)) return;
    void run("delete", async signal => { await privateApi(`${path}?revision=${job.revision}`, { method: "DELETE", signal }); onDelete(job.id); });
  };
  const removeSource = () => {
    if (!window.confirm("移除你上傳的 PDF？\n\n之後重試會改回自動尋找公開全文。")) return;
    void run("removeSource", async signal => onUpdate((await privateApi<{ job: Job }>(`${path}/source?revision=${job.revision}`, { method: "DELETE", signal })).job));
  };

  const manualSource = job.metadata.manualSource as { name?: unknown } | undefined;
  return <div className="wb-manage">
    {manualSource && <p className="wb-small wb-wrap">使用你上傳的 PDF：{String(manualSource.name ?? "")}
      {canDelete(job) && <button type="button" className="wb-link-button" disabled={Boolean(busy)} onClick={removeSource}>{busy === "removeSource" ? "移除中…" : "移除上傳的 PDF"}</button>}</p>}
    {editing ? <form className="wb-form" onSubmit={saveIdentity}>
      <label>DOI、PMID 或 PMCID<input required maxLength={2048} value={input} onChange={event => setInput(event.target.value)} disabled={Boolean(busy)} /></label>
      <label>文獻標題（選填）<textarea rows={2} maxLength={1000} value={title} onChange={event => setTitle(event.target.value)} disabled={Boolean(busy)} /></label>
      {manualSource && input.trim() !== job.input && <p className="wb-small">改了識別碼，之前上傳的 PDF 會一併移除。</p>}
      <div className="wb-actions">
        <button type="submit" className="wb-button is-primary" disabled={Boolean(busy) || !input.trim()}>{busy === "identity" ? "儲存中…" : "儲存標題與識別碼"}</button>
        <button type="button" className="wb-button is-quiet" disabled={Boolean(busy)} onClick={() => { setEditing(false); setError(""); }}>取消編輯</button>
      </div>
    </form> : <div className="wb-actions">
      {canEditIdentity(job) && <button type="button" className="wb-button is-quiet" disabled={Boolean(busy)} onClick={() => setEditing(true)}>編輯標題／DOI</button>}
      {canRestart(job) && <button type="button" className="wb-button is-quiet" disabled={Boolean(busy)} onClick={restart}>{busy === "restart" ? "重新排隊中…" : "從頭重跑"}</button>}
      {canDelete(job) && <button type="button" className="wb-button is-danger" disabled={Boolean(busy)} onClick={remove}>{busy === "delete" ? "刪除中…" : "刪除任務"}</button>}
    </div>}
    {error && <div role="alert" className="wb-alert">{error}</div>}
  </div>;
}
