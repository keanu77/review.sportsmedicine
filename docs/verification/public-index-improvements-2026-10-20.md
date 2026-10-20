# 公開索引修正與 repo launch 準備

驗證日期：2026-10-20。分支 `feat/public-index-improvements`，基準 `eaaf756`。以下是本機實作／驗證；本輪沒有部署正式站、建立公開 release 或發送社群貼文。

## 已完成

- 搜尋：中英文臨床同義詞雙向展開、片語與 AND 處理、精確識別碼邊界、PRP/PRF 區分、正向肌骨相關性加分、可點擊的修正建議。五十肩／冰凍肩／frozen shoulder 查到相同 2 篇；PRP 仍保留 75 篇，肌骨主題優先。來源標籤中仍有其他領域／PRF 的 PRP 歸類，未藉排序隱藏。
- 篩選：部位、疾病、介入／主題、族群可與查詢、日期、文體合併。URL 保留條件；文獻詳情可回到原搜尋。手機進階篩選收合，展開後不擠壓選單。
- 閱讀：856 篇獨立靜態文獻頁、各自 canonical／OG、860 個公開 sitemap URL、3 個主題入口與 404。保留舊 hash 詳情連結；未啟用 JavaScript 仍可閱讀文獻正文。
- 收藏：待讀／已讀、書目與摘要快照、JSON 備份／還原、批次 RIS／BibTeX。資料僅在瀏覽器；舊收藏沒有快照且已離開索引時，不能補造原資料。備份有結構、URL、容量與識別碼衝突檢查。
- 來源：完整書目來源刷新、免費全文來源狀態、摘要授權與節錄界線、逐篇完整度／待辦原因；摘要生成只讀已核對完整來源，不以標題或節錄猜結論。
- 介面：精簡首頁、搜尋優先、清楚的載入錯誤與恢復、160–180 ms 操作回饋與 reduced-motion。未加入 GSAP，詳見 [動態設計評估](motion-design-2026-10-20.md)。
- 相依套件：Wrangler 相容更新與 Tailwind 4.3.3／PostCSS 整合，移除有漏洞的 Tailwind 3 建置依賴；維持既有色盤。支援目標 Safari 16.4+、Chrome 111+、Firefox 128+，本輪自動化瀏覽器實測為 Chromium。
- Repo：英文與繁中 README、真實桌機／手機截圖與短片、CONTRIBUTING、Issue／PR 範本、資料來源與授權說明。維運指令移至獨立文件，MIT 程式碼授權未變更。

## 資料結果與實際限制

856 篇唯一文獻；810 篇書目核對完成，46 篇仍未解（34 篇缺年份，12 篇無精確來源匹配）。仍缺 52 篇作者、42 篇識別碼、46 篇完整日期；這些欄位保留缺值與待辦原因。

來源摘要 787 篇：245 篇有來源授權標示而保留完整摘要，542 篇僅公開最多 25 字詞節錄；69 篇來源沒有摘要。全文 472 篇為來源列出可免費存取的連結、5 篇僅上游推定、379 篇未知。這不是逐篇 PDF 下載成功或授權法律審查的證明。

新增 42 篇本機摘要，逐篇比對來源，23 篇修正術語或因果／適用範圍表述。可見摘要 849/856；餘下 7 篇缺來源摘要，沒有來源已就緒卻仍缺可見摘要的項目。這不是醫師逐篇臨床審查，也沒有重新評讀所有舊摘要。可用持久摘要 overlay 761/856，另有 95 篇 overlay 待辦，部分仍有上游摘要；4 組衝突標題保持隔離。

## 驗證證據

- `npm ci`：乾淨安裝成功。`npm run dev`：本機正常啟動，無需模型／雲端憑證。
- `npm run typecheck`、`npm run build`、`git diff --check` 通過。
- Server 126、Worker 95、Frontend 95 項通過。Frontend 包含兩項新靜態 HTML 編碼／JSON bootstrap 安全測試。
- 完整 smoke 123 項通過；之後新增兩項開發模式 fallback 測試，連同文獻、備份、靜態 HTML 與手機流程共 14 項再次通過。
- Renderer 10 項、整合 1 項通過；真實本機 Pages Functions＋D1/R2 smoke 通過。這不是正式環境或私人 worker 自然排程驗證。
- `npm audit --audit-level=moderate`：0 個已知漏洞。
- 截圖實際檢視：1280×900 桌機、390×844 手機尺寸；手機未水平溢出，搜尋框頂端約 242 px，腳本未收集到 page error。未聲稱實體手機或 Safari／Firefox 已測。
- 搜尋書目投影排除原文摘要：原完整 bibliography gzip 397,507 bytes，首頁投影 gzip 135,840 bytes，約減少 66%。這是資料傳輸量比較，不是正式站 Core Web Vitals 測量。

## 發布素材

- [GitHub 參考與發布草稿](repo-launch-research-2026-10-20.md)
- [英文 README](../../README.md)／[繁中 README](../../README.zh-TW.md)
- [桌機畫面](../images/public-index.png)／[手機畫面](../images/public-mobile.png)／[操作短片](../images/public-workflow.webm)

發布時應使用合併後的 commit／CI、正式站回歸結果和一致的 demo；本輪素材來自本機分支。尚未宣稱星數、搜尋排名、臨床品質或正式服務可用性有所提升。
