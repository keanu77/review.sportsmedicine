import ReviewsIndex from "./ReviewsIndex.tsx";

// 公開閱覽站：外層提供 skip link 與 main landmark，內容全在 ReviewsIndex。
export default function App() {
  return (
    <div className="min-h-screen bg-page text-body dark:bg-page-dark dark:text-body-dark">
      <a
        href="#main-content"
        className="sr-only rounded bg-surface px-4 py-2 font-medium text-ink shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-brand"
      >
        跳至主要內容
      </a>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-6 focus:outline-none">
        <ReviewsIndex />
      </main>
    </div>
  );
}
