import ReviewsIndex from "./ReviewsIndex.tsx";
import Workbench from "./Workbench";

// 公開閱覽站：外層提供 skip link、製作者署名與 main landmark，內容全在 ReviewsIndex。
export default function App() {
  const isWorkbench = /^\/workbench(?:\/|$)/.test(window.location.pathname);
  return (
    <div className="min-h-screen bg-page text-body dark:bg-page-dark dark:text-body-dark">
      <a
        href="#main-content"
        className="sr-only rounded bg-surface px-4 py-2 font-medium text-ink shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-brand"
      >
        跳至主要內容
      </a>

      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 px-4 pt-3">
        <nav aria-label="主要導覽" className="flex flex-wrap gap-2 text-sm">
          <a href="/" aria-current={!isWorkbench ? "page" : undefined} className="inline-flex min-h-11 items-center rounded px-2 font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-brand-dark">公開文獻索引</a>
          <a href="/workbench/" aria-current={isWorkbench ? "page" : undefined} className="inline-flex min-h-11 items-center rounded px-2 font-medium text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-brand-dark">私人工作台</a>
        </nav>
        <a
          href="https://sportsmedicine.tw/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-muted-dark dark:hover:text-brand-dark"
        >
          <span>
            製作者　<span className="font-medium text-body dark:text-body-dark">運動醫學科 吳易澄醫師</span>
          </span>
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M14 5h5v5" />
            <path d="M19 5 11 13" />
            <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
          </svg>
          <span className="sr-only">（另開新分頁，前往 sportsmedicine.tw）</span>
        </a>
      </div>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-4 pb-6 focus:outline-none">
        {isWorkbench ? <Workbench /> : <ReviewsIndex />}
      </main>
    </div>
  );
}
