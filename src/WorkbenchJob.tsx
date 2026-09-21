import { useEffect, useRef, useState } from "react";
import type { Artifact, Design, Draft, Job, JobStatus } from "../shared/contracts";
import { errorText, fetchArtifact, fileUrl, privateApi } from "./privateApi";

export const STATUS_LABELS: Record<JobStatus, string> = { queued: "排隊中", running: "處理中", needs_review: "待你審閱", completed: "輸出完成", failed: "執行失敗", cancelled: "已取消" };
const PALETTES: [Design["palette"], string][] = [["blue", "白藍 · 專業"], ["cyan", "青藍"], ["emerald", "翡翠綠"], ["orange-light", "柔橘"], ["gold", "金色"], ["orange", "暖橘"], ["sky", "天空藍"]];
const STAGES: Record<string, string> = { queued: "等待 Mac 接手", researching: "查核全文", research: "查核全文與建立草稿", resolving: "尋找開放全文", drafting: "撰寫草稿", reviewing: "模型審核", needs_review: "等待你確認草稿", rendering: "製作圖文", render: "製作圖文", completed: "素材已可下載", failed: "需要處理錯誤", cancelled: "已取消", lease_expired: "Mac 連線中斷，需要手動重試" };
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown): string { return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""; }
function safeUrl(value: unknown): string | null { const raw = string(value); try { const url = new URL(raw); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; } }

export type EditorSnapshot = { draft: Draft | null; baseline: string; revision: number; design: Design; designBaseline: string };
export default function WorkbenchJob({ job, onUpdate, cache }: { job: Job; onUpdate: (job: Job) => void; cache: React.MutableRefObject<Map<string, EditorSnapshot>> }) {
  const cached = cache.current.get(job.id);
  const [draft, setDraft] = useState<Draft | null>(cached?.draft ?? job.draft);
  const [baseline, setBaseline] = useState(cached?.baseline ?? JSON.stringify(job.draft));
  const [revision, setRevision] = useState(cached?.revision ?? job.revision);
  const [design, setDesign] = useState(cached?.design ?? job.design);
  const [designBaseline, setDesignBaseline] = useState(cached?.designBaseline ?? JSON.stringify(job.design));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const editable = ["needs_review", "completed"].includes(job.status);
  const conflict = dirty && job.revision !== revision;
  const designDirty = JSON.stringify(design) !== designBaseline;
  const editableRef = useRef({ dirty, designDirty });
  editableRef.current = { dirty, designDirty };
  useEffect(() => { cache.current.set(job.id, { draft, baseline, revision, design, designBaseline }); }, [cache, job.id, draft, baseline, revision, design, designBaseline]);

  useEffect(() => {
    if (!editableRef.current.dirty) { setDraft(job.draft); setBaseline(JSON.stringify(job.draft)); setRevision(job.revision); }
    if (!editableRef.current.designDirty) { setDesign(job.design); setDesignBaseline(JSON.stringify(job.design)); }
  }, [job.revision, job.draft, job.design]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || designDirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, designDirty]);

  const operate = async (action: "draft" | "render" | "cancel" | "retry") => {
    if (busy) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(action); setError(""); setNotice("");
    try {
      const result = await privateApi<{ job: Job }>(`/jobs/${encodeURIComponent(job.id)}/${action}`, {
        method: action === "draft" ? "PATCH" : "POST", signal: controller.signal,
        ...(action === "draft" ? { body: { revision, draft } } : action === "render" ? { body: { revision, design } } : {}),
      });
      if (controller.signal.aborted) return;
      if (action === "draft") { setBaseline(JSON.stringify(result.job.draft)); setDraft(result.job.draft); setRevision(result.job.revision); }
      if (action === "render") { setDesign(result.job.design); setDesignBaseline(JSON.stringify(result.job.design)); }
      onUpdate(result.job);
      setNotice(action === "draft" ? "文字已儲存。可以排入圖文製作。" : action === "render" ? "已排入圖文製作。Mac 完成後即可預覽與下載。" : action === "cancel" ? "任務已取消。" : "已重新排入佇列。");
    } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
    finally { if (!controller.signal.aborted) setBusy(""); }
  };

  const edit = (field: "post" | "igCaption" | "notes", value: string) => setDraft(current => current ? { ...current, [field]: value } : current);
  const editPage = (pageIndex: number, field: "title" | "subtitle", value: string) => setDraft(current => current ? { ...current, pages: current.pages.map((page, index) => index === pageIndex ? { ...page, [field]: value } : page) } : current);
  const editCard = (pageIndex: number, cardIndex: number, field: "title" | "body", value: string) => setDraft(current => current ? { ...current, pages: current.pages.map((page, index) => index === pageIndex ? { ...page, cards: page.cards?.map((card, cardNumber) => cardNumber === cardIndex ? { ...card, [field]: value } : card) } : page) } : current);

  return <div className="wb-job" aria-busy={Boolean(busy)}>
    <section className="wb-panel">
      <div className="wb-section-heading"><p className="wb-eyebrow">CURRENT PROJECT</p><span className={`wb-status status-${job.status}`}>{STATUS_LABELS[job.status]}</span></div>
      <h2 className="wb-project-title">{job.title || job.input}</h2>
      <p className="wb-small wb-wrap">{job.input} · 版本 {job.revision}</p>
      <p className="wb-stage" role="status">{STAGES[job.stage] || `目前步驟：${job.stage}`}</p>
      {job.error && <div role="alert" className="wb-alert">{job.error.message}<span className="wb-small"> {job.error.code}</span></div>}
      <div className="wb-actions">
        {["queued", "running", "needs_review"].includes(job.status) && <button className="wb-button is-quiet" disabled={Boolean(busy)} onClick={() => void operate("cancel")}>{busy === "cancel" ? "取消中…" : "取消任務"}</button>}
        {["failed", "cancelled"].includes(job.status) && <button className="wb-button" disabled={Boolean(busy)} onClick={() => void operate("retry")}>{busy === "retry" ? "重新排隊中…" : "重試任務"}</button>}
      </div>
    </section>

    <SourceMetadata metadata={job.metadata} />

    {draft ? <section className="wb-panel" aria-labelledby="draft-heading">
      <div className="wb-section-heading"><h2 id="draft-heading">草稿編輯</h2><span className="wb-small">{dirty ? "有尚未儲存的文字" : "文字已同步"}</span></div>
      {!editable && <p className="wb-notice">{job.status === "queued" || job.status === "running" ? "任務執行期間草稿已鎖定。" : "此任務目前無法編輯；可重試後繼續。"}</p>}
      {conflict && <div className="wb-alert" role="alert"><p>遠端已更新至版本 {job.revision}；你的版本 {revision} 文字仍保留。請複製要保留的修改，再載入最新版本。</p><button className="wb-button" onClick={() => { setDraft(job.draft); setBaseline(JSON.stringify(job.draft)); setRevision(job.revision); setError(""); }}>捨棄本頁修改，載入最新版本</button></div>}
      <fieldset disabled={!editable || Boolean(busy)} className="wb-form">
        <label>Facebook 貼文<textarea rows={9} maxLength={30000} value={draft.post} onChange={event => edit("post", event.target.value)} /></label>
        <label>Instagram 說明<textarea rows={5} maxLength={15000} value={draft.igCaption} onChange={event => edit("igCaption", event.target.value)} /></label>
        <label>製作備註<textarea rows={3} maxLength={15000} value={draft.notes} onChange={event => edit("notes", event.target.value)} /></label>
        <h3>每頁圖卡文字</h3>
        {draft.pages.map((page, pageIndex) => <div key={page.id} className="wb-page-editor"><h4>第 {pageIndex + 1} 頁 · {page.layout === "cover" ? "封面" : page.layout === "outro" ? "結尾" : "內容"}</h4>
          <label>第 {pageIndex + 1} 頁標題<input value={page.title} maxLength={2000} onChange={event => editPage(pageIndex, "title", event.target.value)} /></label>
          <label>第 {pageIndex + 1} 頁副標<textarea rows={2} value={page.subtitle ?? ""} maxLength={6000} onChange={event => editPage(pageIndex, "subtitle", event.target.value)} /></label>
          {page.cards?.map((card, cardIndex) => <div className="wb-card-editor" key={cardIndex}><label>第 {pageIndex + 1} 頁重點 {cardIndex + 1} 標題<input value={card.title} maxLength={2000} onChange={event => editCard(pageIndex, cardIndex, "title", event.target.value)} /></label><label>第 {pageIndex + 1} 頁重點 {cardIndex + 1} 內文<textarea rows={3} value={card.body} maxLength={6000} onChange={event => editCard(pageIndex, cardIndex, "body", event.target.value)} /></label></div>)}
        </div>)}
      </fieldset>
      <div className="wb-actions"><button className="wb-button is-primary" onClick={() => void operate("draft")} disabled={!editable || Boolean(busy) || !dirty || conflict}>{busy === "draft" ? "儲存中…" : "儲存文字"}</button><span className="wb-small">先儲存，再製作圖片。</span></div>
    </section> : <section className="wb-panel"><h2>草稿尚未產生</h2><p className="wb-small">Mac 會先取得可用全文，再建立附有證據片段的草稿。無法取得時會顯示原因。</p></section>}

    {draft && <section className="wb-panel"><h2>主張與來源片段</h2><p className="wb-small">下列為生成時保存的依據。修改草稿後，請重新核對數字、族群與語意是否仍相符。</p>
      {draft.claims.length ? <ol className="wb-evidence">{draft.claims.map((claim, index) => <li key={index}><p>{claim.text}</p><span className="wb-small">{claim.locator || "未提供定位"}</span><blockquote>{claim.quote || "未提供來源引文"}</blockquote></li>)}</ol> : <p className="wb-notice">此草稿沒有可顯示的證據片段。</p>}
    </section>}

    <ReviewProvenance metadata={job.metadata} edited={dirty || job.metadata.reviewsStale === true} />

    {draft && <section className="wb-panel"><p className="wb-eyebrow">ART DIRECTION</p><h2>圖文製作</h2><p className="wb-small">套用目前已儲存文字。改色或更換版型後可重新輸出。</p>
      <fieldset className="wb-design" disabled={!editable || Boolean(busy)}>
        <label>版型<select aria-label="版型" value={design.style} onChange={event => setDesign({ ...design, style: event.target.value as Design["style"] })}><option value="clinical">Clinical · 醫療衛教</option><option value="editorial">Editorial · 雜誌編排</option></select></label>
        <label>色系<select aria-label="色系" value={design.palette} onChange={event => setDesign({ ...design, palette: event.target.value as Design["palette"] })}>{PALETTES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>圖片風格<select aria-label="圖片風格" value={design.imageStyle} onChange={event => setDesign({ ...design, imageStyle: event.target.value as Design["imageStyle"] })}><option value="photo">寫實照片</option><option value="illustration">插畫</option><option value="none">純文字設計</option></select></label>
        <label>尺寸<select aria-label="尺寸" value={design.format} onChange={event => setDesign({ ...design, format: event.target.value as Design["format"] })}><option value="portrait">直式 · 4:5</option><option value="square">正方形 · 1:1</option></select></label>
      </fieldset>
      <button className="wb-button is-primary" onClick={() => void operate("render")} disabled={!editable || Boolean(busy) || dirty || conflict}>{busy === "render" ? "正在排入製作…" : job.status === "completed" ? "重新製作圖文 →" : "確認已核對，製作圖文 →"}</button>
      {dirty && <p className="wb-small">還有文字尚未儲存，請先完成上方儲存。</p>}
    </section>}

    {(error || notice) && <div className={error ? "wb-alert" : "wb-notice"} role={error ? "alert" : "status"}>{error || notice}</div>}
    <Artifacts job={job} edited={dirty || designDirty} />
  </div>;
}

function SourceMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const paper = record(metadata.paper ?? metadata.source);
  if (!Object.keys(paper).length) return null;
  const url = safeUrl(paper.sourceUrl ?? paper.pdfUrl);
  const license = string(paper.license) || string(record(paper.license).name) || string(record(paper.license).url);
  const pdfReason = string(paper.pdfError) || string(record(paper.pdfError).message) || string(paper.pdfStatus);
  const xmlReason = string(paper.xmlError) || string(record(paper.xmlError).message) || string(paper.xmlStatus);
  // A verified readable source may be XML-only. Neither verification nor a URL
  // proves that a PDF was downloaded; legacy jobs deliberately remain unknown.
  const fullTextState = paper.fullTextAvailable === true ? "全文可讀" : paper.fullTextAvailable === false ? "全文未取得" : paper.fullTextVerified === true ? "原文已驗證（舊任務未記錄檔案取得狀態）" : "未提供全文取得紀錄";
  const pdfState = paper.pdfAvailable === true ? "PDF 已取得" : paper.pdfAvailable === false ? `PDF 未取得（${pdfReason || "未提供具體原因"}）` : "未提供 PDF 取得紀錄";
  const xmlState = paper.xmlAvailable === true ? "結構化全文 XML 已取得" : paper.xmlAvailable === false ? `結構化全文 XML 未取得${xmlReason ? `（${xmlReason}）` : ""}` : "未提供 XML 取得紀錄";
  return <section className="wb-panel" aria-label="論文來源"><h2>論文來源</h2><p className="wb-wrap">{string(paper.title)}</p><dl className="wb-metadata">
    <div><dt>全文狀態</dt><dd>{fullTextState}</dd></div>
    <div><dt>PDF</dt><dd>{pdfState}</dd></div>
    <div><dt>結構化全文</dt><dd>{xmlState}</dd></div>
    <div><dt>識別碼</dt><dd>{[paper.doi, paper.pmid, paper.pmcid].map(string).filter(Boolean).join(" · ") || string(paper.id) || "未提供"}</dd></div>
    <div><dt>授權</dt><dd>{license || "未取得"}</dd></div>
    <div><dt>來源／版本</dt><dd>{[paper.provider, paper.version].map(string).filter(Boolean).join(" · ") || "未提供"}</dd></div>
    {paper.checkedAt ? <div><dt>查核時間</dt><dd>{string(paper.checkedAt)}</dd></div> : null}
  </dl>{url && <a href={url} target="_blank" rel="noopener noreferrer" className="wb-text-link">開啟原始來源 ↗</a>}{string(paper.citation) && <p className="wb-small wb-wrap">{string(paper.citation)}</p>}</section>;
}

function ReviewProvenance({ metadata, edited }: { metadata: Record<string, unknown>; edited: boolean }) {
  const reviews: Record<string, unknown>[] = Array.isArray(metadata.reviews) ? metadata.reviews.map(record) : Object.entries(record(metadata.reviews)).map(([provider, review]) => ({ ...record(review), provider }));
  return <section className="wb-panel"><h2>模型審核紀錄</h2><p className="wb-small">「已執行」表示模型回傳結果，不代表內容已通過醫學查核。下方保留未執行與失敗紀錄。</p>
    <p className={edited ? "wb-notice" : "wb-small"}>這些模型意見針對生成時的初稿；人工修改後尚未重新查核。</p>
    <div className="wb-reviewers">{["claude", "gemini", "grok"].map(provider => {
      const review = reviews.find(item => string(item.provider).toLowerCase() === provider);
      const status = string(review?.status);
      const findings = Array.isArray(review?.findings) ? review.findings.map(record) : [];
      return <details key={provider} className="wb-review"><summary><strong>{provider === "claude" ? "Claude" : provider === "gemini" ? "Gemini" : "Grok"}</strong><span className="wb-small">{status === "ran" ? `已執行 · ${findings.length} 項意見` : status === "failed" ? "執行失敗" : "未執行／無法使用"}</span></summary>
        {review ? <div className="wb-review-body"><p className="wb-small">{string(review.role)} {string(review.checkedAt)}</p>{(review.summary || review.error) ? <p>{string(review.summary) || string(review.error) || string(record(review.error).message)}</p> : null}
          {findings.map((finding, index) => <div key={index} className="wb-finding"><p><strong>{string(finding.severity)}</strong> · {string(finding.claim)}</p><p>{string(finding.reason)}</p>{finding.suggestion ? <p>建議：{string(finding.suggestion)}</p> : null}{finding.quote ? <blockquote>{string(finding.quote)}</blockquote> : null}<p className="wb-small">{string(finding.locator)} · {finding.sourceVerified === true ? "來源片段已比對" : "模型意見，未核對來源"}</p></div>)}
          {status === "ran" && findings.length === 0 && <p className="wb-small">本次沒有回傳問題項目，仍需人工確認。</p>}
        </div> : <p className="wb-review-body wb-small">這個任務沒有此模型的執行紀錄。</p>}
      </details>;
    })}</div>
  </section>;
}

function Preview({ artifact, jobId }: { artifact: Artifact; jobId: string }) {
  const [failed, setFailed] = useState(false);
  return <figure>{failed ? <div className="wb-notice">預覽無法載入，請重新登入或使用下載連結。</div> : <img src={fileUrl(jobId, artifact, true)} alt={artifact.name} loading="lazy" onError={() => setFailed(true)} />}<figcaption>{artifact.name}</figcaption></figure>;
}
function Artifacts({ job, edited }: { job: Job; edited: boolean }) {
  const [downloading, setDownloading] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [ready, setReady] = useState<{ url: string; name: string; size: number } | null>(null);
  const active = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const artifactIds = job.artifacts.map(file => file.id).join("|");
  useEffect(() => {
    setDownloading(""); setDownloadError(""); setReady(null);
    return () => {
      active.current?.abort(); active.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
  }, [job.id, artifactIds]);

  const download = async (event: React.MouseEvent<HTMLAnchorElement>, file: Artifact) => {
    // Preserve ordinary new-tab / save-link actions, but keep normal failures in this page.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null; setReady(null); setDownloadError(""); setDownloading(file.name);
    try {
      const blob = await fetchArtifact(job.id, file, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); objectUrl.current = url;
      setReady({ url, name: file.name, size: blob.size });
      const link = document.createElement("a");
      link.href = url; link.download = file.name;
      document.body.appendChild(link); link.click(); link.remove();
      // Keep the URL alive for the browser and an explicit, user-initiated retry.
    } catch (cause) { if (!controller.signal.aborted) setDownloadError(errorText(cause)); }
    finally { if (active.current === controller) { active.current = null; setDownloading(""); } }
  };

  if (!job.artifacts.length) return null;
  const images = job.artifacts.filter(file => ["image/png", "image/jpeg"].includes(file.contentType));
  const zip = job.artifacts.find(file => file.contentType === "application/zip" || file.name.toLowerCase().endsWith(".zip"));
  // Completion increments revision after render. Status + local edits describe
  // freshness without mistaking that normal revision increment for a stale output.
  const hasRenderOutput = Boolean(zip || images.length || job.metadata.render);
  const previousOutput = hasRenderOutput && (edited || job.status !== "completed");
  return <section className="wb-panel" aria-label="預覽與下載"><div className="wb-section-heading"><h2>預覽與下載</h2>{zip && <a className="wb-button is-primary" href={fileUrl(job.id, zip)} download={zip.name} aria-disabled={Boolean(downloading)} onClick={event => void download(event, zip)}>{downloading === zip.name ? "正在下載 ZIP…" : previousOutput ? "下載前次 ZIP" : "下載完整 ZIP"}</a>}</div>
    {downloading && <p className="wb-notice" role="status">正在取得 {downloading}，請稍候…</p>}
    {downloadError && <p className="wb-alert" role="alert">{downloadError}</p>}
    {ready && <div className="wb-notice" role="status">檔案已就緒（{Math.max(1, Math.round(ready.size / 1024))} KB）。若未自動儲存，請按 <a href={ready.url} download={ready.name}>儲存 {ready.name}</a>，並查看瀏覽器的下載面板。</div>}
    {previousOutput && <p className="wb-notice" role="status">圖卡與 ZIP 為前次輸出，未包含目前文字／設計變更。{job.status === "queued" || job.status === "running" ? "新一輪製作尚未完成。" : "請完成重新製作後，再下載更新素材。"}</p>}
    {images.length > 0 && <div className="wb-previews">{images.map(file => <Preview key={file.id} artifact={file} jobId={job.id} />)}</div>}
    <ul className="wb-files">{job.artifacts.map(file => <li key={file.id}><a href={fileUrl(job.id, file)} download={file.name} aria-disabled={Boolean(downloading)} onClick={event => void download(event, file)}>{file.name}<span aria-hidden="true"> ↓</span></a><span className="wb-small">{Math.max(1, Math.round(file.size / 1024))} KB</span></li>)}</ul>
  </section>;
}
