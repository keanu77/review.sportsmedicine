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

- Backend（19項）：真實 SQLite 約束與簽章 JWT；正確／錯誤 owner、JWT issuer/audience/expiry、匿名下載、CSRF、並發領取、過期／取消 lease、文案 CAS、檔案配額／完整性、冪等上傳、過時查核紀錄、私人 XML 上傳／下載及 HTML 偽裝拒絕。
- Worker（37項）：私人位址與 URL 防護、錯篇 PDF／HTML 拒絕、PDF／XML 引文定位、JATS 表格上下文、DTD／entity 拒絕、雙格式獨立保存、訂閱 CLI 的 secret 隔離、子程序取消、不明模型結果防重跑、圖片來源與快取 hash、暫時性傳輸錯誤的最多三次重試。包含新增的 8 項真實 CLI 子程序測試：XML-only 恢復、原始檔／文字雜湊、抽取快取修改、PDF-only 相容、製圖入口及未核對來源拒絕；測試不呼叫模型。
- Renderer：實際 Chromium、方形及直式 PNG 尺寸、中文文字、圖片路徑、溢出時拒絕覆蓋、既有輸出備份。
- Worker→API：實際 worker 的製圖、檔案上傳、回應遺失後冪等重傳、任務完成與授權 ZIP 下載；原始研究資料與 R2 使用 fixtures，模型不在此測試執行。
- 本機 Cloudflare：真實 workerd、D1、R2；領取、上傳 hash、重傳、心跳、完成及匿名拒絕。這項不是正式部署。
- 前端單元（10項）與瀏覽器（41項）：公開索引與工作台桌面／360px 手機操作，以及 XML-only／PDF-only／舊任務／全文失敗狀態。工作台 API 為明確 fixture；另以 JWT/API 測試檢驗權限，不把前端 fixture 當成登入驗證。
- `npm run build` 與 `git diff --check` 通過；正式相依套件 `npm audit --omit=dev` 為 0 vulnerabilities。

執行命令與最新測試項目見 package.json、tests/。模型與生圖實際執行用量不納入一般測試套件。

## 正式服務啟用與驗收

Cloudflare Pages `review-sportsmedicine` 已由 GitHub main 自動部署至 `review.sportsmedicine.tw`。程式提交 `ba2879a`，正式 deployment `5055f8b0-85cb-4e22-8790-3a3f90ab4a52` 的 build/deploy 均成功（2026-09-21 05:16 UTC）。Production 已核對 5 個設定名稱與 `DB`／`ARTIFACTS` bindings；preview 尚未配置私人服務。D1 `review-private-jobs` 的 migration list 沒有待套用遷移，R2 `review-private-artifacts` development URL 關閉。

沿用 Zero Trust 團隊 `sportsmedicine-tw.cloudflareaccess.com`。新增 Access application `sportsmedicine-review-workbench`（`4fa3e76e-b91f-47d9-ab18-7f73499ef076`），保護 `/workbench`、`/workbench/*`、`/api/private/*`；唯一 Allow email 是 `keanu.firefox@gmail.com`。既有 4 個其他網站應用未更動。

Cloudflare 管理頁的電子郵件規則編輯器持續出現 `Maximum call stack size exceeded`，因此在本人明確批准後，建立僅限本帳戶 Access Apps and Policies 編輯權限的臨時 Token，經官方 API 完成設定。設定驗證後立即撤銷；API 驗證回傳 `401 Invalid API Token`，本機 Token 暫存檔已刪除。`WORKER_TOKEN` 是另外產生的應用程式連線密鑰，僅存於 Pages production secret 與本機 `0600` env，不在 Git 或日誌中。

正式 smoke：公開首頁與實際索引 JSON 為 200；工作台與私人 API 未登入為 Access 302；Pages 原始網域私人 session 及沒有／錯誤 bearer 的 worker API 為 401 JSON 且 no-store。本人已在 Edge 完成 email 驗證碼登入，工作台確認 email 正確並顯示「Mac 已連線」。

Mac 前景 `run --once` 成功連接正式 API，當時回傳「等待網站任務」。LaunchAgent `tw.sportsmedicine.review-worker` 已安裝並啟動，確認 `state = running` 且日誌正常輪詢。私有服務設定位於 `/Users/ethanwu/review-worker-service`，Node 固定為 Homebrew Node 24，PATH 包含 Grok 實際安裝位置。Codex/Claude 訂閱登入、PDF 工具、Chromium 與已完成生圖 proof 通過；probe 原始生成紀錄與 PNG 複製後再次核對 hash，未重新消耗生圖額度。

正式任務 `49c6d0a5-da15-4eb9-bb64-6d441acafcb5` 由本人登入的工作台建立，使用上述跑步文獻。背景 worker 實際重新取得 PDF 並核對相同 SHA-256；本次 Unpaywall 來源未提供 XML，如實記為未取得。Codex 生成新草稿，Claude 回傳 8 項意見、Grok 回傳 5 項意見；Gemini 缺少 CLI 登入，記為 unavailable。

對照 PDF 第 1–2 頁，透過正式 UI 修正骨壓力性損傷情境、生物力學因素範圍、既有框架歸屬、下坡跑加入條件、非線性關係的可能解釋語氣及觀點文章稱呼。草稿由版本 2 儲存為 3，重新載入確認仍保留修改；原始 claims 與模型審查紀錄保留，UI 明示修改後尚未重新查核。再由版本 4 排入製圖，worker 實際生成新情境圖並完成排版、R2 上傳與任務完成。

產物：6 張 1080×1350 圖卡、1 張 1200×630 封面、兩平台文案、來源與替代文字、ZIP。正式頁面 7 張私人圖片均完成載入且尺寸正確，並實際檢視封面與條件語內容頁。所有排版檢查通過；ZIP 共 15 個檔案，沒有原文 PDF，CRC 檢查無錯。大小 3,367,414 bytes，SHA-256 `5da5e3ad40a510d1136165dd9eba6fb4429697b3b21800de0ba5c1ad18609f34`。本機產物在 `/Users/ethanwu/review-worker-service/workspace/49c6d0a5-da15-4eb9-bb64-6d441acafcb5/versions/a25487200d9aefd44fe95c8a/`。

下載驗收追蹤：本人確認舊版連結在 Edge 顯示「無法下載」。直接 attachment 連結未將 HTTP／登入錯誤帶回工作台；新增的 401 瀏覽器回歸測試先確認此缺陷（頁面沒有 alert），再改為同源驗證下載，核對內容類型、長度與 SHA-256 後交給瀏覽器儲存。頁面保留可再次明確點擊的儲存連結，並顯示登入失效、檔案過期、網路及完整性錯誤。Access、私人 R2 與伺服器安全標頭未放寬。

下載修正提交 `4eaca6f`，正式 deployment `f9afb3ba-7fa8-469c-b346-adbea1be3c2a` 已於 2026-09-21 07:22:25 UTC 完成。15 項前端單元測試、43 項瀏覽器測試及 production build 通過；瀏覽器測試實際儲存 fixture ZIP，檔名與每個位元組一致。正式公開首頁與索引 JSON 為 200；未登入工作台／API／ZIP 為 Access 302，Pages 原始網域私人端點為 401/no-store，錯誤與缺少 worker bearer 皆為 401。

本人另將正式任務重製為版本 7（Editorial／翡翠綠／插畫），新 ZIP 有 15 個檔案、3,034,885 bytes，SHA-256 `2ca984319d7a075a62a049ff62fd84e3a0cb47eb1e3f8fe4c3224b06b31ce17d`。正式 Edge 點擊新版下載後，頁面完成長度／SHA-256 驗證並顯示「檔案已就緒（2964 KB）」。下載資料夾的 `.crdownload` 實際收到相同大小、相同 SHA-256 的完整 ZIP，15 項 CRC 全部正常；但 Edge 尚未完成最後儲存，因此不能宣稱端到端下載已驗收。已請本人點擊新出現的「儲存 social-materials.zip」回報結果。原先 Edge 直接附件下載失敗的具體原因尚未確定。工具禁止開啟內部下載頁，未繞過此限制或更改瀏覽器保護設定。隔離診斷伺服器已停止，未對外發佈 FB/IG。

## 第一版限制

- 可分析已核對的 PMC JATS XML，保留章節、段落與可讀表格；PDF 獨立下載與核對。掃描 PDF、影像表格、超過 160,000 字元全文、PMC 多個可用版本需人工處理。XML-only 不捏造 PDF 頁碼或取得紀錄。
- 原文比對只證明引句存在，不能證明全部推論正確。不同模型意見須回到原文判斷。
- 人工修改不會自動重新呼叫模型；UI 標示舊查核及前次素材。
- 訂閱登入與額度可變；一次成功不保證日後可用。未完成生圖 probe 的 worker 不領取有圖任務。
- 失敗／過期／取消任務不自動重送模型；需本人檢查後重試。安全下載與相同 ID 上傳最多重試三次。
- 舊 attempt 的私人 R2 物件、工作目錄及日誌目前沒有自動清理排程。

追加本機 doctor 實測：Codex 顯示 ChatGPT 登入、Claude 顯示 claude.ai 登入；PDF工具、Chromium、可寫目錄、既有生圖proof hash均通過。Gemini/Grok的版本檢查僅證明CLI存在，其實際審查狀態以上文真實任務為準。
