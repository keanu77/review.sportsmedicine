import { useState } from "react";
import { REVIEW_SEATS, withDisclaimer } from "../shared/quality.mjs";
import type { PlacedFinding } from "./findingTargets";

/** Review findings shown beside the draft field they concern. */
export function FieldFindings({ items }: { items?: PlacedFinding[] }) {
  if (!items?.length) return null;
  return <details className="wb-field-findings">
    <summary>⚑ {items.length} 條審核意見</summary>
    <ul>{items.map(item => <li key={`${item.provider}-${item.index}`}><strong>{REVIEW_SEATS[item.provider]?.label ?? item.provider}（{REVIEW_SEATS[item.provider]?.role ?? "審核"}）意見 {item.index + 1}</strong>：{item.claim}{item.suggestion && <span className="wb-small"> 建議：{item.suggestion}</span>}</li>)}</ul>
  </details>;
}

/** Copies the caption as exported: the disclaimer is always included. */
export function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(withDisclaimer(text)); setState("已複製（含免責聲明）"); }
    catch { setState("無法存取剪貼簿，請手動選取複製"); }
    window.setTimeout(() => setState(""), 3000);
  };
  return <span className="wb-copy"><button type="button" className="wb-button is-quiet" onClick={() => void copy()}>複製{label}</button>{state && <span className="wb-small" role="status">{state}</span>}</span>;
}
