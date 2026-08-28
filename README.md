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

## 授權

- **程式碼**：[MIT License](./LICENSE)，歡迎自由學習、修改、再利用。
- **資料**（`public/data/reviews-index.json`）：為第三方文獻的**書目 metadata** 與
  **機器生成之中文摘要**，僅供教育／研究參考。著作權屬各原始出版者所有；
  請勿當作權威內容重製或再散布，引用時務必回溯原始文獻與 DOI。

## 免責

本索引僅供教育與研究參考，不構成醫療建議。臨床決策請以原始文獻與專業判斷為準。
AI 摘要與 IF 近似值可能有誤，一切以原始文獻為準。
