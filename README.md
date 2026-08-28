# 運動醫學 Review 索引

運動醫學／復健文獻的系統性回顧、統合分析與臨床指引索引，供公開閱覽。
可依 **部位 / 臨床主題 / 族群** 三種方式瀏覽，標示期刊影響係數（IF 近似值）與免費全文。

線上：<https://review.sportsmedicine.tw/>（Cloudflare Pages）

## 技術

- Vite + React + TypeScript + Tailwind CSS
- 純靜態站，無後端。資料為建置時打包的 `public/data/reviews-index.json`
- 部署：Cloudflare Pages（Git 整合，push 即自動 build+deploy，綁 `review.sportsmedicine.tw`）
- 每月資料同步：GitHub Actions（見 `.github/workflows/sync-data.yml`）
- Node 版本由 `.node-version` 釘定（給 Cloudflare 建置環境）

## 本機開發

```bash
npm install
npm run dev        # 開發伺服器
npm run build      # 產出 dist/
npm run preview    # 預覽產出
npm run typecheck  # 型別檢查
```

## 資料來源與更新

> **給想學習的人**：這個 repo 只是**前端展示層**（一頁式資料驅動 UI + 部署）。
> 產生 `reviews-index.json` 的後端資料管線（知識庫抽取、hybrid 檢索、LLM 摘要、
> PubMed/Crossref 增補、IF 對應）**不在此 repo**，本站僅消費最終產出的靜態 JSON。

`public/data/reviews-index.json`（主索引資料）由上游的
RSS/知識庫 monorepo 產生（`scripts/reviews-index-*`：KB 抽取 + PubMed 補充 +
Crossref 期刊名解析 + IF 表），發布於公開 URL
`https://app.sportsmedicine.tw/data/reviews-index.json`。

本站的同步 workflow（`.github/workflows/sync-data.yml`）每月 1 日自該公開 URL
自動拉取最新資料、commit 回本 repo；該 commit 的 push 會觸發 Cloudflare Pages
自動重建（不需任何跨 repo token）。也可在 Actions 頁手動觸發（workflow_dispatch）即時同步。

### 本月新增文獻

上游是**固定容量的滾動視窗**（每月有新增也有汰除），且項目本身沒有收錄日期欄位，
因此「本月新增」無法從資料直接讀出，只能比對同步前後兩份快照。同步 workflow 會在覆寫前
留下舊快照，刷新後執行：

```bash
node scripts/build-new-items.mjs <舊快照> <新資料> public/data/new-items.json
```

產出 `public/data/new-items.json`（批次日期 + 逐篇新增清單，已去除同一篇文獻依多個疾病
重複列出的情形），由首頁最上方的「本月新增文獻」區塊讀取。該檔不存在或載入失敗時，
區塊靜默不顯示，不影響主索引。上游資料與現有版本相同時不重算，以免用空清單覆蓋上一批紀錄。

- 資料本質：IF 為 **近似值**（Clarivate JCR ~2023），僅供參考、逐年變動。
- 免費全文為啟發式判定（依來源網域），非逐篇 Unpaywall 驗證；引用前請循原文與 DOI。

### 本月新增文獻的中文摘要

上游的 PubMed 文獻沒有中文摘要（`tldr` 為空），卡片上只剩一行中位 127 字元的英文長標題。
`scripts/summarize-new-items.mjs` 從 PubMed 取回**摘要原文**，交給本機 ollama 模型
濃縮成一句繁體中文：

```bash
npm run summarize          # 預設 qwen3.8:27b-mlx，可用 --model 指定
```

只用標題生成等於改寫標題、不會增加資訊量，所以**取不到摘要就不寫**。產出前有機械檢查，
不通過就整篇捨棄而非硬寫：禁止療效絕對化語句（保證／治癒／完全預防…）、
禁止出現摘要原文查無實據的數字（防止模型自行生出效果量）、中文字須佔多數、長度上限。
通過的項目標記 `tldrSource: "local-llm"`，UI 上顯示「AI 摘要」，頁尾一併揭露。

這一步**依賴本機 ollama，GitHub Actions runner 上沒有**，因此每月同步後需要在本機補跑一次。

## 檢索與標示的實作邊界

- **搜尋**（`src/search.ts` + `src/aliases.ts`）比對標題、病名、中文摘要、期刊、PMID、
  年份、主題與族群。拉丁字母以詞界比對——短縮寫若用裸子字串，`at` 會命中 846/911 篇；
  漢字資訊密度高，維持子字串。縮寫別名表讓 `ACL`／`PRP`／`RTP` 命中中文病名的文獻。
- **證據類型**（`src/studyType.ts`）由標題自動推導（系統性回顧／統合分析／指引／共識／
  範疇回顧／傘狀回顧／敘述性回顧），涵蓋 91.7%，**未經人工核對**，無法判定則不標示。
- **唯一文獻計數**：上游同一篇會依多個疾病重複列出，也會同時收錄 DOI 版與出版社版兩個
  網址（41 組）。統計一律以正規化標題去重後計算，切換分類軸不會改變篇數。
- **色彩與字體**對齊主站 <https://sportsmedicine.tw/>：品牌色相 OKLCH 228（藍青），
  標題 Barlow Condensed、內文 Inter。色票以語意命名（`ink`／`body`／`muted`／`brand`／
  `surface`／`line`）定義在 `tailwind.config.js`，每一組明暗值都驗過對比——
  文字 ≥4.5:1、非文字元件 ≥3:1。分類色只表達解剖大類（5 組同 OKLCH 明度彩度、只換色相），
  且只用於圓點與邊框；文字一律用中性色。
- **檢索狀態進 URL**（`src/useUrlState.ts`）：`?q=`、`?axis=`、`?free=1` 可分享與加書籤。

## 授權

- **程式碼**：[MIT License](./LICENSE)，歡迎自由學習、修改、再利用。
- **資料**（`public/data/reviews-index.json`）：為第三方文獻的**書目 metadata** 與
  **機器生成之中文摘要**，僅供教育／研究參考。著作權屬各原始出版者所有；
  請勿當作權威內容重製或再散布，引用時務必回溯原始文獻與 DOI。

## 免責

本索引僅供教育與研究參考，不構成醫療建議。臨床決策請以原始文獻與專業判斷為準。
AI 摘要與 IF 近似值可能有誤，一切以原始文獻為準。
