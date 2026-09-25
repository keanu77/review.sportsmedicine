import { useState } from "react";
import type { Job } from "../shared/contracts";
import { claimKey } from "../shared/quality.mjs";
import { isPrivateSessionActive } from "./draftRecovery";
import { errorText, privateApi } from "./privateApi";

type Decision = { status: "locked" | "rejected"; note?: string };

/** Gate A: the owner locks or rejects every claim before anything is rendered. */
export default function ClaimsPanel({ job, editable, onUpdate }: { job: Job; editable: boolean; onUpdate: (job: Job) => void }) {
  const claims = job.draft?.claims ?? [];
  const decisions = ((job.metadata.claimReview as { decisions?: Record<string, Decision> } | undefined)?.decisions) ?? {};
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notes, setNotes] = useState<Record<string, string>>({});
  const decide = async (key: string, status: Decision["status"] | "pending") => {
    if (busy || !isPrivateSessionActive()) return;
    setBusy(key); setError("");
    try { onUpdate((await privateApi<{ job: Job }>(`/jobs/${encodeURIComponent(job.id)}/claims`, { method: "PATCH", body: { key, status, ...(status === "rejected" && notes[key]?.trim() ? { note: notes[key].trim() } : {}) } })).job); }
    catch (cause) { if (isPrivateSessionActive()) setError(errorText(cause)); }
    finally { if (isPrivateSessionActive()) setBusy(""); }
  };
  const decided = claims.filter(claim => decisions[claimKey(claim)]).length;
  const locked = claims.filter(claim => decisions[claimKey(claim)]?.status === "locked").length;
  return <section className="wb-panel" aria-labelledby="claims-heading">
    <div className="wb-section-heading"><h2 id="claims-heading">研究主張（製作前先鎖定）</h2><span className={decided === claims.length && locked ? "wb-status status-completed" : "wb-status status-needs_review"}>{locked} 鎖定 · {decided}/{claims.length} 已確認</span></div>
    <p className="wb-small">每條主張都附原文逐字片段。請核對後鎖定；不正確的就駁回，再用「依審核修訂草稿」把相關文字移除。鎖定的主張是修訂時不能更動的事實底線。</p>
    <ol className="wb-evidence">{claims.map((claim, index) => {
      const key = claimKey(claim), decision = decisions[key];
      return <li key={key} className={decision ? `is-${decision.status}` : ""}>
        <p>{claim.text}</p><span className="wb-small">{claim.locator || "未提供定位"}</span><blockquote>{claim.quote || "未提供來源引文"}</blockquote>
        {decision?.status === "rejected" && decision.note && <p className="wb-small">駁回理由：{decision.note}</p>}
        {editable && <div className="wb-actions">
          {decision ? <>
            <span className="wb-small">{decision.status === "locked" ? "✓ 已鎖定" : "✕ 已駁回"}</span>
            <button type="button" className="wb-button is-quiet" disabled={Boolean(busy)} onClick={() => void decide(key, "pending")}>{busy === key ? "處理中…" : "改回待確認"}</button>
          </> : <>
            <button type="button" className="wb-button is-primary" disabled={Boolean(busy)} onClick={() => void decide(key, "locked")}>{busy === key ? "處理中…" : `鎖定主張 ${index + 1}`}</button>
            <input aria-label={`主張 ${index + 1} 駁回理由`} maxLength={500} placeholder="駁回理由（選填）" value={notes[key] ?? ""} disabled={Boolean(busy)} onChange={event => setNotes(current => ({ ...current, [key]: event.target.value }))} />
            <button type="button" className="wb-button is-danger" disabled={Boolean(busy)} onClick={() => void decide(key, "rejected")}>駁回主張 {index + 1}</button>
          </>}
        </div>}
      </li>;
    })}</ol>
    {!claims.length && <p className="wb-notice">此草稿沒有可顯示的證據片段。</p>}
    {error && <div role="alert" className="wb-alert">{error}</div>}
  </section>;
}
