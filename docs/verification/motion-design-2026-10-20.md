# Motion Graphics / GSAP 適用評估

本站是文獻檢索與閱讀工具。動態效果適合提示「條件已套用」「收藏已儲存」等狀態變化；長段落閱讀與搜尋結果需要立即可用。這是針對本站任務的設計判斷，不是動畫能提高 SEO 或 stars 的承諾。

| 情境 | 決定 | 實作／驗收 |
| --- | --- | --- |
| 新增篩選條件 | 低幅度位移與淡入 | `.motion-feedback`，160 ms、3 px，完整內容始終存在。 |
| 收藏 | 按下與完成回饋 | `.motion-action`，按下縮至 0.97，收藏圖示 180 ms；文字及 `aria-pressed` 同步更新。 |
| 搜尋結果 | 保持可立即閱讀 | 螢幕閱讀器即時狀態、結果計數、清楚分頁；不逐列延遲顯示。 |
| 手機篩選 | 以收合改善資訊密度 | 可操作的「篩選與排序」按鈕、`aria-expanded` 與 `aria-controls`；展開後欄位保留閱讀寬度。 |
| 文獻詳情與原文摘要 | 不加捲動綁定效果 | 可直接連結、無 JavaScript 仍可閱讀靜態正文。 |
| 將來的研究敘事頁 | 可評估 GSAP timeline | 僅在需要協調「研究問題 → 族群 → 結果 → 限制」多個圖形時導入，另測效能與 reduced-motion。 |

本輪沒有安裝 GSAP。現有互動只需要 CSS 的 `transform` / `opacity`；避免多一個執行依賴。全域 `prefers-reduced-motion: reduce` 關閉平滑捲動與過場，新增動畫只在 `no-preference` 下套用。

若將來使用 GSAP，應以官方 `gsap.matchMedia()` 管理斷點／減少動態需求，以 React 整合方式清理動畫及事件，避免重新掛載殘留。ScrollTrigger 僅用於確有敘事價值的區塊，不限制使用者正常捲動。

本機驗證：Chromium 桌機及 390×844 手機尺寸、減少動態效果、鍵盤操作、無水平溢出、淺／深色對比。這些不是實體 iPhone、Safari 或 Firefox 的測試證據。正式發布後仍應核對正式網址與目標裝置；本輪沒有部署。

來源：[GSAP matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/)、[GSAP React 整合](https://gsap.com/resources/React/)、[web.dev 動畫效能指南](https://web.dev/articles/animations-guide)。
