# 個人文獻工作台實測紀錄

日期：2026-09-21。這份紀錄區分本機功能、真實模型執行及尚未啟用的正式服務。

## 已完成的實際文獻流程

- 文獻：Napier C, Willy RW. *The Prevention and Treatment of Running Injuries: A State of the Art*. IJSPT. 2021;16(4):968–970. DOI `10.26603/001c.25754`，PMCID `PMC8329326`。
- 來源：[PMC 全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC8329326/) 與 [出版社](https://ijspt.scholasticahq.com/article/25754-the-prevention-and-treatment-of-running-injuries-a-state-of-the-art)。下載實際 PDF，以首頁標題、DOI 及檔案 signature 核對；PDF SHA-256：`ad7ffa0192c3ef8e727ebe548d66e93063c4359117d2d5215b30b1088239238a`。
- 授權 metadata 記錄 `cc-by-nc-sa`；來源原文與授權保存在個人輸出目錄，沒有放入 public 或社群 ZIP。
- 使用 pdftotext 依閱讀順序擷取；避免双欄 layout 模式讓原文引句跨欄混合。6 項 claims 均可定位到實際頁碼。
- Codex 使用既有 ChatGPT 登入，產出結構化繁中草稿及真實情境圖。圖像由 CLI 所回報的本次 session 目錄取回，檢查完成紀錄、時間、PNG 及 SHA-256；不是以佔位圖模擬。
- Claude 與 Grok 實際執行獨立審查，保留各自 JSON、原始輸出與引文驗證結果。Gemini CLI 尚未完成登入，記為 unavailable，未計為通過。
- 審查抓出下坡跑條件語、速度訓練的因果表述、骨壓力性傷害的適用範圍、架構歸屬。對照 PDF 正文後修正初稿，另記錄 editorialReview；原審查紀錄仍屬修訂前草稿，不宣稱模型已重新審查修訂稿。
- 實際排版 6 張 1080×1350 圖卡及 1200×630 封面，白底藍色、AI 寫實情境、分離中文字排版。檢視首圖、文字內容頁及橫式封面，並通過所有頁面幾何溢出及圖片載入檢查。
- ZIP 包含 FB/IG 文案、系列圖、封面、來源、alt text、manifest、AI 素材與生成提示、render report；沒有原文 PDF。

## 自動驗證範圍

- Backend（18項）：真實 SQLite 約束與簽章 JWT；正確／錯誤 owner、JWT issuer/audience/expiry、匿名下載、CSRF、並發領取、過期／取消 lease、文案 CAS、檔案配額／完整性、冪等上傳、過時查核紀錄。
- Worker（14項）：私人位址與 URL 防護、錯篇 PDF／HTML 拒絕、引文頁碼、訂閱 CLI 的 secret 隔離、子程序取消、不明模型結果防重跑、圖片來源與快取 hash、暫時性傳輸錯誤的最多三次重試。
- Renderer：實際 Chromium、方形及直式 PNG 尺寸、中文文字、圖片路徑、溢出時拒絕覆蓋、既有輸出備份。
- Worker→API：實際 worker 的製圖、檔案上傳、回應遺失後冪等重傳、任務完成與授權 ZIP 下載；原始研究資料與 R2 使用 fixtures，模型不在此測試執行。
- 本機 Cloudflare：真實 workerd、D1、R2；領取、上傳 hash、重傳、心跳、完成及匿名拒絕。這項不是正式部署。
- 前端單元（10項）與瀏覽器（37項）：公開索引與工作台桌面／360px 手機操作。工作台 API 為明確 fixture；另以 JWT/API 測試檢驗權限，不把前端 fixture 當成登入驗證。
- `npm run build` 與 `git diff --check` 通過；正式相依套件 `npm audit --omit=dev` 為 0 vulnerabilities。

執行命令與最新測試項目見 package.json、tests/。模型與生圖實際執行用量不納入一般測試套件。

## 已確認的正式服務缺項

唯讀查核既有 Cloudflare Pages `review-sportsmedicine`：網域 `review.sportsmedicine.tw`，GitHub main 自動部署；production/preview 沒有既有環境變數、D1 或 R2 bindings。沒有找到 review Access app，組織設定讀取回應 403。`wrangler.jsonc` 的 D1 UUID 仍為可辨識的零值佔位，owner 已設定為 `keanu.firefox@gmail.com`。

尚需：Access 團隊網域及 app/audience/唯一 owner policy、真實 D1/R2、worker secret、正式部署與本人登入實測。Mac 啟動模板已完成，尚未安裝常駐服務。未 push 或部署含佔位設定的版本，未對外發佈 FB/IG。

## 第一版限制

- 只分析可取得且可讀文字的 PDF；掃描 PDF、超過 160,000 字元全文、PMC 多個可用版本會明確停止，需人工處理。結構化 XML／表格解析尚未加入。
- 原文比對只證明引句存在，不能證明全部推論正確。不同模型意見須回到原文判斷。
- 人工修改不會自動重新呼叫模型；UI 標示舊查核及前次素材。
- 訂閱登入與額度可變；一次成功不保證日後可用。未完成生圖 probe 的 worker 不領取有圖任務。
- 失敗／過期／取消任務不自動重送模型；需本人檢查後重試。安全下載與相同 ID 上傳最多重試三次。
- 舊 attempt 的私人 R2 物件、工作目錄及日誌目前沒有自動清理排程。

追加本機 doctor 實測：Codex 顯示 ChatGPT 登入、Claude 顯示 claude.ai 登入；PDF工具、Chromium、可寫目錄、既有生圖proof hash均通過。Gemini/Grok的版本檢查僅證明CLI存在，其實際審查狀態以上文真實任務為準。
