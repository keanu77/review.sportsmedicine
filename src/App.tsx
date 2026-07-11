import ReviewsIndex from "./ReviewsIndex.tsx";

// 公開閱覽站：外層只提供置中容器，內容全在 ReviewsIndex（純讀 public/data 的 JSON）。
export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <ReviewsIndex />
      </div>
    </div>
  );
}
