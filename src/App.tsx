import ReviewsIndex from "./ReviewsIndex.tsx";
import Topics, { TOPICS, type TopicData } from "./Topics";
import PaperDetails from "./PaperDetails";
import PublicShell from "./PublicShell";
import { lazy, Suspense } from "react";

const Workbench = lazy(() => import("./Workbench"));
export default function App() {
  const isWorkbench = /^\/workbench(?:\/|$)/.test(window.location.pathname);
  let topic: TopicData | null = null;
  try { topic = JSON.parse(document.getElementById("topic-data")?.textContent || "null"); } catch { /* Invalid bootstrap falls back to the index. */ }
  const knownPath = TOPICS.some(entry => window.location.pathname.replace(/\/$/, "") === `/topics/${entry.slug}`) || window.location.pathname === "/" || /^\/papers\/[a-z0-9-]+\/?$/.test(window.location.pathname);
  return <PublicShell isWorkbench={isWorkbench}>{isWorkbench ? <Suspense fallback={<p role="status" className="px-4 py-8 text-center">正在載入工作台…</p>}><Workbench /></Suspense> : topic ? <Topics data={topic} /> : knownPath ? <ReviewsIndex /> : <PaperDetails item={undefined} />}</PublicShell>;
}
