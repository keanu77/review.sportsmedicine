import { useState } from "react";
import { REVIEW_SEATS } from "../shared/quality.mjs";
import { errorText, privateApi } from "./privateApi";

export type SeatStat = { month: string; provider: string; runs: number; ran: number; findings: number; resolved: number; rejected: number; averageSeconds: number | null };

/** Confirmed share of settled findings; null until the owner settles any. */
export function precision(stat: SeatStat) {
  const settled = stat.resolved + stat.rejected;
  return settled ? Math.round(stat.resolved / settled * 100) : null;
}

/** Per-seat review record for the monthly seat review (1st of each month). Loaded on open. */
export default function ReviewerStats({ enabled }: { enabled: boolean }) {
  const [stats, setStats] = useState<SeatStat[] | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const load = async () => {
    if (loading || !enabled) return;
    setLoading(true); setError("");
    try { setStats((await privateApi<{ stats: SeatStat[] }>("/reviewer-stats")).stats); }
    catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  };
  return <details className="wb-panel wb-seat-stats" onToggle={event => { if ((event.target as HTMLDetailsElement).open && !stats) void load(); }}>
    <summary><strong>審稿席次統計</strong> <span className="wb-small">每月 1 號復盤</span></summary>
    <p className="wb-small">「已修正」算成立、「不採納」算誤判；只統計你處理過的意見。</p>
    {loading && <p className="wb-small" role="status">載入中…</p>}
    {error && <p className="wb-alert" role="alert">{error}</p>}
    {stats && (stats.length ? <div className="wb-table-wrap"><table className="wb-seat-table">
      <thead><tr><th scope="col">月份</th><th scope="col">席次</th><th scope="col">成功／次數</th><th scope="col">意見</th><th scope="col">成立</th><th scope="col">誤判</th><th scope="col">成立率</th><th scope="col">平均耗時</th></tr></thead>
      <tbody>{stats.map(stat => { const rate = precision(stat); return <tr key={`${stat.month}-${stat.provider}`}>
        <td>{stat.month}</td><td>{REVIEW_SEATS[stat.provider] ? `${REVIEW_SEATS[stat.provider].label}（${REVIEW_SEATS[stat.provider].role}）` : stat.provider}</td>
        <td>{stat.ran}／{stat.runs}</td><td>{stat.findings}</td><td>{stat.resolved}</td><td>{stat.rejected}</td><td>{rate === null ? "—" : `${rate}%`}</td>
        <td>{stat.averageSeconds === null ? "—" : `${Math.round(stat.averageSeconds / 6) / 10} 分`}</td></tr>; })}</tbody>
    </table></div> : <p className="wb-small">還沒有審核紀錄。</p>)}
    {stats && <button className="wb-button is-quiet" disabled={loading} onClick={() => void load()}>重新整理統計</button>}
  </details>;
}
