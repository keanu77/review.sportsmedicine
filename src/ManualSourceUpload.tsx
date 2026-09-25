import { useEffect, useRef, useState } from "react";
import type { Job } from "../shared/contracts";
import { isPrivateSessionActive } from "./draftRecovery";
import { errorText, uploadSourcePdf } from "./privateApi";

/** Only research that never produced a draft can take an owner-supplied PDF. */
export function canUploadSource(job: Job): boolean {
  return ["failed", "cancelled"].includes(job.status) && job.phase === "research" && !job.draft;
}

export default function ManualSourceUpload({ job, onUpdate }: { job: Job; onUpdate: (job: Job) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const upload = async () => {
    if (!file || busy || !isPrivateSessionActive()) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const updated = await uploadSourcePdf(job, file, controller.signal);
      if (!controller.signal.aborted && isPrivateSessionActive()) onUpdate(updated);
    } catch (cause) { if (!controller.signal.aborted && isPrivateSessionActive()) setError(errorText(cause)); }
    finally { request.current = null; if (!controller.signal.aborted && isPrivateSessionActive()) setBusy(false); }
  };

  return <div className="wb-upload">
    <h3 className="wb-upload-title">上傳自己下載的全文 PDF</h3>
    <p className="wb-small">用你自己的瀏覽器、圖書館連結或館際互借取得這篇的 PDF 後上傳。Mac 會先核對 PDF 首頁的標題與 DOI，符合才會開始製作；檔案只存放在私人儲存，不會公開。</p>
    <label>選擇 PDF（最大 32 MB）
      <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} />
    </label>
    <button className="wb-button" disabled={!file || busy} onClick={() => void upload()}>{busy ? "上傳中…" : "上傳並重新製作"}</button>
    {error && <div role="alert" className="wb-alert">{error}</div>}
  </div>;
}
