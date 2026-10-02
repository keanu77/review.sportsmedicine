import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Design, Job, JobPage, JobSummary } from "../shared/contracts";
import { errorText, latestJob, mergeJobList, privateApi, PrivateApiError } from "./privateApi";
import { reconcileFirstPage } from "./jobList";
import WorkbenchJob, { STATUS_LABELS, type EditorSnapshot } from "./WorkbenchJob";
import { clearExpiredRecoveries, isPrivateSessionActive, logoutPrivateSession, removeRecovery, watchPrivateSession } from "./draftRecovery";
import ReviewerStats from "./ReviewerStats";
import JobThumb, { thumbArtifact } from "./JobThumb";
import { useCompletionNotices } from "./useCompletionNotices";
import { DONE_LABELS } from "./completion";
import { REVIEW_SEATS } from "../shared/quality.mjs";
import "./workbench.css";

interface Session { email: string; worker: { lastSeen: string; capabilities: unknown } | null; workerCredentialExpiresAt?: string }
export const DEFAULT_DESIGN: Design = { palette: "blue", style: "clinical", imageStyle: "photo", format: "portrait" };
// A background tab polls the list slowly (completion notices still arrive) and pauses the open job.
const LIST_POLL_MS = 8000, HIDDEN_LIST_POLL_MS = 60000, DETAIL_POLL_MS = 5000;
// Same-origin tabs hear about deletes at once instead of waiting for the next list poll.
const JOB_CHANNEL = "review-workbench-jobs";
const listLabel = (item: JobSummary) => item.stage === "deleting" ? "刪除未完成" : STATUS_LABELS[item.status];

export default function Workbench() {
  const initial = new URLSearchParams(window.location.search);
  const [input, setInput] = useState(initial.get("input") ?? "");
  const [title, setTitle] = useState(initial.get("title") ?? "");
  const [session, setSession] = useState<Session | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [locked, setLocked] = useState(!isPrivateSessionActive());
  const [storageNotice, setStorageNotice] = useState("");
  const createController = useRef<AbortController | null>(null);
  const editorCache = useRef(new Map<string, EditorSnapshot>());
  const selectedRef = useRef(selected);
  // A poll started before a delete must not bring the deleted job back.
  const deleted = useRef(new Set<string>());
  // Jobs this tab created recently: a list fetched before creation must not drop them.
  const created = useRef(new Map<string, number>());
  const olderPagesLoaded = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  selectedRef.current = selected;
  // Effects registered once (polls, the tab channel) read the current list and owner through refs.
  const jobsRef = useRef(jobs), ownerRef = useRef("");
  jobsRef.current = jobs;
  const notices = useCompletionNotices(jobs, !locked);

  useEffect(() => {
    setStorageNotice(clearExpiredRecoveries() || "");
    return watchPrivateSession(() => {
      createController.current?.abort();
      editorCache.current.clear(); selectedRef.current = null;
      setLocked(true); setJob(null); setJobs([]); setSelected(null); setSession(null);
      setInput(""); setTitle(""); setError(""); setDetailError(""); setNotice(""); setCreating(false);
    });
  }, []);

  useEffect(() => {
    if (locked || !isPrivateSessionActive()) return;
    const controller = new AbortController();
    let timer: number, inFlight = false;
    const poll = async () => {
      if (!isPrivateSessionActive() || inFlight) return;
      inFlight = true; clearTimeout(timer);
      const startedAt = Date.now();
      try {
        const [nextSession, list] = await Promise.all([
          privateApi<Session>("/session", { signal: controller.signal }),
          privateApi<JobPage>("/jobs", { signal: controller.signal }),
        ]);
        if (controller.signal.aborted || !isPrivateSessionActive()) return;
        if (!nextSession.email || !Array.isArray(list.jobs)) throw new Error("私人服務回應格式無法辨識。");
        setSession(nextSession);
        for (const [id, at] of created.current) if (at < startedAt - 60000) created.current.delete(id);
        const visible = list.jobs.filter(item => !deleted.current.has(item.id));
        const keep = new Set(created.current.keys());
        setJobs(current => reconcileFirstPage(current, visible, !list.nextCursor, keep).filter(item => !deleted.current.has(item.id)));
        if (!olderPagesLoaded.current) setMoreCursor(list.nextCursor ?? null);
        setSelected(current => current ?? visible[0]?.id ?? null);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted && isPrivateSessionActive()) setError(errorText(cause));
      } finally {
        inFlight = false;
        if (!controller.signal.aborted && isPrivateSessionActive()) { setLoading(false); timer = window.setTimeout(poll, document.hidden ? HIDDEN_LIST_POLL_MS : LIST_POLL_MS); }
      }
    };
    const onVisibility = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh, locked]);

  useEffect(() => {
    setJob(current => current?.id === selected ? current : null);
    setDetailError("");
    if (!selected || locked || !isPrivateSessionActive()) return;
    const controller = new AbortController();
    let timer: number, inFlight = false;
    const poll = async () => {
      if (!isPrivateSessionActive() || inFlight) return;
      inFlight = true; clearTimeout(timer);
      try {
        const result = await privateApi<{ job: Job }>(`/jobs/${encodeURIComponent(selected)}`, { signal: controller.signal });
        if (controller.signal.aborted || selectedRef.current !== selected || !isPrivateSessionActive()) return;
        setJob(current => latestJob(current, result.job));
        setDetailError("");
      } catch (cause) {
        if (controller.signal.aborted || !isPrivateSessionActive()) return;
        if (cause instanceof PrivateApiError && cause.status === 404) forgetJob(selected, "這個任務已在其他分頁或裝置刪除。");
        else setDetailError(errorText(cause));
      } finally {
        inFlight = false;
        if (!controller.signal.aborted && isPrivateSessionActive() && !document.hidden) timer = window.setTimeout(poll, DETAIL_POLL_MS);
      }
    };
    const onVisibility = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [selected, refresh, locked]);

  useEffect(() => {
    if (locked || typeof BroadcastChannel === "undefined") return;
    const bus = new BroadcastChannel(JOB_CHANNEL);
    channel.current = bus;
    bus.onmessage = event => { if (event.data?.type === "deleted" && typeof event.data.id === "string") forgetJob(event.data.id, "這個任務已在其他分頁刪除。"); };
    return () => { bus.close(); channel.current = null; };
  }, [locked]);

  useEffect(() => () => createController.current?.abort(), []);

  const updateJob = (next: Job) => {
    if (!isPrivateSessionActive()) return;
    if (deleted.current.has(next.id)) return;
    if (selectedRef.current === next.id) setJob(current => latestJob(current, next));
    setJobs(current => mergeJobList(current, [next]));
  };
  // Removes a job from this tab, whether it was deleted here, in another tab or on another device.
  function forgetJob(id: string, message: string) {
    if (!isPrivateSessionActive() || deleted.current.has(id)) return;
    deleted.current.add(id);
    editorCache.current.delete(`${ownerRef.current}/${id}`);
    if (ownerRef.current) removeRecovery(ownerRef.current, id);
    setJobs(current => current.filter(item => item.id !== id));
    if (selectedRef.current === id) {
      const next = jobsRef.current.find(item => item.id !== id)?.id ?? null;
      setJob(null); selectedRef.current = next; setSelected(next);
    }
    setNotice(message);
  }
  const deleteJob = (id: string) => {
    forgetJob(id, "任務已刪除。");
    channel.current?.postMessage({ type: "deleted", id });
  };
  const loadMore = async () => {
    if (!moreCursor || loadingMore || !isPrivateSessionActive()) return;
    setLoadingMore(true);
    try {
      const page = await privateApi<JobPage>(`/jobs?cursor=${encodeURIComponent(moreCursor)}`);
      if (!isPrivateSessionActive()) return;
      olderPagesLoaded.current = true;
      setJobs(current => mergeJobList(current, page.jobs.filter(item => !deleted.current.has(item.id))));
      setMoreCursor(page.nextCursor ?? null);
    } catch (cause) {
      setNotice(errorText(cause));
    } finally { setLoadingMore(false); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || creating || !isPrivateSessionActive()) return;
    const controller = new AbortController();
    createController.current = controller;
    setCreating(true); setNotice("");
    try {
      const result = await privateApi<{ job: Job }>("/jobs", { method: "POST", body: { input: input.trim(), ...(title.trim() ? { title: title.trim() } : {}), design: DEFAULT_DESIGN }, signal: controller.signal });
      if (controller.signal.aborted || !isPrivateSessionActive()) return;
      created.current.set(result.job.id, Date.now());
      updateJob(result.job); setSelected(result.job.id);
      setNotice("任務已加入佇列。Mac 連線後會先查核全文，再產生待審草稿。");
    } catch (cause) {
      if (!controller.signal.aborted) setNotice(errorText(cause));
    } finally { if (!controller.signal.aborted) setCreating(false); }
  };
  const logout = () => {
    if (!window.confirm("登出並清除本機草稿？\n\n這會移除此瀏覽器所有工作台分頁的未儲存草稿與本機復原副本，並鎖定其他工作台分頁。伺服器上已儲存的資料會保留。\n\n也會登出此 Cloudflare Access 組織的其他應用程式；登入憑證撤銷可能需要約 20–30 秒。")) return;
    let failure: string | null = null;
    // Commit the lock and unmount private editors/downloads before navigating.
    flushSync(() => { failure = logoutPrivateSession(); setStorageNotice(failure || ""); });
    if (!failure) window.location.assign("/cdn-cgi/access/logout");
  };
  ownerRef.current = session?.email || "";
  const workerDate = session?.worker ? Date.parse(session.worker.lastSeen) : NaN;
  const workerOnline = Number.isFinite(workerDate) && Date.now() - workerDate < 120000;
  const credentialExpiry = Date.parse(session?.workerCredentialExpiresAt || "");
  const credentialExpiresSoon = Number.isFinite(credentialExpiry) && credentialExpiry - Date.now() <= 14 * 86400000;
  const capabilities = session?.worker?.capabilities as { imageGeneration?: { available?: boolean }; reviewers?: Record<string, { available?: boolean; fix?: string }> } | undefined;
  const reviewers = Object.entries(capabilities?.reviewers ?? {});
  const REVIEWER_NAMES = Object.fromEntries(Object.entries(REVIEW_SEATS).map(([name, seat]) => [name, `${seat.label}（${seat.role}）`]));

  if (locked) return <section className="workbench wb-panel" aria-labelledby="workbench-locked-heading">
    <h1 id="workbench-locked-heading">工作台已鎖定</h1>
    <p>此工作台已鎖定。{!storageNotice && "本機草稿已清除。"}伺服器上已儲存的資料仍保留。</p>
    {storageNotice && <p role="alert" className="wb-alert">{storageNotice}</p>}
    <a className="wb-button" href="/cdn-cgi/access/logout">繼續登出 Cloudflare Access</a>
  </section>;

  return <div className="workbench">
    <header className="wb-hero">
      <p className="wb-eyebrow">PAPER TO SOCIAL · PRIVATE STUDIO</p>
      <h1>讓研究，成為看得懂的內容。</h1>
      <p>從一篇開放取用論文開始，在 Mac 產生草稿、核對證據，最後輸出 FB／IG 圖文。</p>
      <ol className="wb-steps" aria-label="製作流程"><li><span>01</span> 取得全文</li><li><span>02</span> 編輯與審核</li><li><span>03</span> 輸出圖文</li></ol>
    </header>

    <div className="wb-connection" aria-live="polite">
      <span className={`wb-dot ${workerOnline ? "is-online" : ""}`} aria-hidden="true" />
      <div>{loading ? "正在確認私人服務…" : session ? <><strong>{workerOnline ? "Mac 已連線" : "等待 Mac 連線"}</strong><span className="wb-small"> {session.email}</span></> : <strong>私人服務尚未連線</strong>}
        {session && <p className="wb-small">{session.worker ? `最後回報：${new Date(session.worker.lastSeen).toLocaleString("zh-TW")}` : "尚無 Mac 回報紀錄"}{!workerOnline && "。已排隊任務會等待 worker 啟動。"}</p>}
        {Number.isFinite(credentialExpiry) && <p className={credentialExpiresSoon ? "wb-small wb-alert" : "wb-small"}>憑證到期：{new Date(credentialExpiry).toLocaleString("zh-TW")}{credentialExpiresSoon && (credentialExpiry <= Date.now() ? "（已到期，請輪替）" : "（14 天內到期，請輪替）")}</p>}
        {capabilities?.imageGeneration?.available === false && <p className="wb-small">Mac 圖片生成功能尚未就緒；需要情境圖的任務（寫實、插畫、扁平、水彩、底片）會等待可生圖的 Mac，純文字版型不受影響。</p>}
        {reviewers.length > 0 && <p className="wb-small wb-reviewer-status">審核模型：{reviewers.map(([name, status]) => <span key={name} className={status.available ? "is-ok" : "is-off"}>{REVIEWER_NAMES[name] ?? name} {status.available ? "可用" : "不可用"}</span>)}</p>}
        {reviewers.filter(([, status]) => !status.available && status.fix).map(([name, status]) => <p key={name} className="wb-small wb-alert">{REVIEWER_NAMES[name] ?? name} 目前無法審核：{status.fix}</p>)}
      </div>
      <button className="wb-button is-quiet" onClick={() => setRefresh(value => value + 1)}>重新整理</button>
      <button className="wb-button is-quiet" onClick={logout}>登出並清除本機草稿</button>
    </div>
    {storageNotice && <p role="alert" className="wb-alert">{storageNotice}</p>}
    {notices.finished.length > 0 && <div className="wb-notice wb-finished" role="status"><strong>剛完成：</strong>{notices.finished.map(item => <button key={item.id} type="button" className="wb-button is-quiet" onClick={() => { setSelected(item.id); notices.dismiss(item.id); }}>{item.title || item.input} · {DONE_LABELS[item.status]}</button>)}<button type="button" className="wb-button is-quiet" onClick={() => notices.dismiss()}>知道了</button></div>}
    {session && notices.permission === "default" && <p className="wb-small">想在切到其他分頁時收到完成通知？<button type="button" className="wb-button is-quiet" onClick={() => void notices.request()}>開啟桌面通知</button></p>}
    {error && <div className="wb-alert" role="alert"><p>{error}</p><a href={`/workbench/${window.location.search}`}>重新登入／開啟工作台</a></div>}

    <div className="wb-layout">
      <aside className="wb-sidebar">
        <section className="wb-panel" aria-labelledby="new-job-heading">
          <p className="wb-eyebrow">NEW PROJECT</p><h2 id="new-job-heading">從一篇論文開始</h2>
          <form onSubmit={create} className="wb-form">
            <label>DOI、PMID 或 PMCID<input required maxLength={512} value={input} onChange={event => setInput(event.target.value)} placeholder="10.1234/example 或 PMC1234567" disabled={creating} aria-describedby="source-help" /></label>
            <p id="source-help" className="wb-small">也接受標準 DOI、PubMed、PMC 連結。全文與授權將由 Mac 查核。</p>
            <label>文獻標題（選填）<textarea rows={2} maxLength={1000} value={title} onChange={event => setTitle(event.target.value)} disabled={creating} placeholder="保留來源標題，方便辨識" /></label>
            {title && !input && <p className="wb-small">索引未提供可用識別碼，請先補上 DOI、PMID 或 PMCID。</p>}
            <button type="submit" className="wb-button is-primary" disabled={!session || Boolean(error) || creating || !input.trim()}>{creating ? "正在建立…" : "取得全文與草稿 →"}</button>
            {creating && <button type="button" className="wb-button is-quiet" onClick={() => { createController.current?.abort(); setCreating(false); setNotice("已停止等待。請重新整理任務，確認伺服器是否已收到這次建立請求。"); }}>停止等待</button>}
            <p className="wb-small">預設白藍色系 · 寫實照片 · 直式。草稿完成後可調整。</p>
          </form>
          {notice && <p className="wb-notice" role="status">{notice}</p>}
        </section>

        <section className="wb-panel" aria-labelledby="jobs-heading"><div className="wb-section-heading"><h2 id="jobs-heading">製作紀錄</h2><span className="wb-small">{jobs.length}{moreCursor ? "+" : ""} 件</span></div>
          {jobs.length ? <ul className="wb-job-list">{jobs.map(item => <li key={item.id}><button onClick={() => { setSelected(item.id); notices.dismiss(item.id); }} aria-pressed={selected === item.id} className={`${selected === item.id ? "is-selected" : ""}${thumbArtifact(item) ? " has-thumb" : ""}`}>{thumbArtifact(item) && <JobThumb job={item} />}<span className="wb-job-text"><span className="wb-job-name">{item.title || item.input}</span><span className="wb-small">{listLabel(item)} · {new Date(item.updatedAt).toLocaleDateString("zh-TW")}</span></span></button></li>)}</ul> : null}
          {moreCursor && <button type="button" className="wb-button is-quiet" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "載入中…" : "載入更早的任務"}</button>}
          {!jobs.length && <p className="wb-small">{session ? "還沒有任務。加入一篇論文，開始製作。" : "登入私人工作台後顯示製作紀錄。"}</p>}
        </section>
        <ReviewerStats enabled={Boolean(session)} />
      </aside>

      <div className="wb-main">
        {detailError && <div role="alert" className="wb-alert">{detailError}</div>}
        {job ? <WorkbenchJob key={job.id} job={job} onUpdate={updateJob} onDelete={deleteJob} cache={editorCache} owner={session?.email || ""} /> : selected ? <div className="wb-panel" role="status">{detailError ? "無法取得任務，請重新整理後再試。" : "正在取得任務…"}</div> : <section className="wb-empty"><div aria-hidden="true" className="wb-paper-icon">↗</div><p className="wb-eyebrow">YOUR NEXT STORY</p><h2>把重點，留給讀者。</h2><p>這裡會保留論文來源、草稿與每次審核結果。<br />確認文字後，再生成可以下載的社群素材。</p><div className="wb-empty-cards" aria-hidden="true"><div /><div /><div /></div></section>}
      </div>
    </div>
    <p className="wb-footer">私人檔案只提供登入者下載。工作台輸出檔案，由你確認後自行發布至 FB／IG。</p>
  </div>;
}
