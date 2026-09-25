import type { Draft, Job } from "../shared/contracts";
import { checkDraft } from "../shared/quality.mjs";

type Issue = { code: string; where: string; message: string; overridable?: boolean };

export function gateResult(draft: Draft, job: Job): { errors: Issue[]; warnings: Issue[] } {
  return checkDraft(draft, { claimReview: job.metadata.claimReview, sourceNumbers: job.metadata.sourceNumbers });
}

/** Pre-render checks on the editor text; the server repeats them on the saved draft. */
export default function QualityGate({ result, accepted, onAccept }: { result: { errors: Issue[]; warnings: Issue[] }; accepted: boolean; onAccept: (value: boolean) => void }) {
  const hard = result.errors.filter(issue => !issue.overridable), soft = result.errors.filter(issue => issue.overridable);
  const list = (issues: Issue[]) => <ul className="wb-gate-list">{issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.where}</strong>：{issue.message}</li>)}</ul>;
  return <div className="wb-gate" aria-live="polite">
    {!result.errors.length && <p className="wb-gate is-pass" role="status">製作前檢查通過：主張已確認，沒有簡體字、§85 禁用語或找不到出處的數字。</p>}
    {hard.length > 0 && <div role="alert" className="wb-alert"><strong>需要先處理（{hard.length}）</strong>{list(hard)}</div>}
    {soft.length > 0 && <div className="wb-alert"><strong>需要你逐條確認（{soft.length}）</strong>{list(soft)}
      <label className="wb-check"><input type="checkbox" checked={accepted} onChange={event => onAccept(event.target.checked)} /> 我已回原文逐條確認，這些項目沒有問題</label></div>}
    {result.warnings.length > 0 && <details className="wb-notice"><summary>提醒（{result.warnings.length}）</summary>{list(result.warnings)}</details>}
  </div>;
}
