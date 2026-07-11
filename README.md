# 運動醫學 Review 索引

運動醫學／復健文獻的系統性回顧、統合分析與臨床指引索引，供公開閱覽。
可依 **部位 / 臨床主題 / 族群** 三種方式瀏覽，標示期刊影響係數（IF 近似值）與免費全文。

線上：<https://review.sportsmedicine.tw>（Cloudflare Pages）
備援鏡像：<https://keanu77.github.io/review.sportsmedicine/>（GitHub Pages）

## 技術

- Vite + React + TypeScript + Tailwind CSS
- 純靜態站，無後端。資料為建置時打包的 `public/data/reviews-index.json`
- 主要部署：Cloudflare Pages（Git 整合，push 即自動 build+deploy，綁 `review.sportsmedicine.tw`）
- 備援部署：GitHub Actions → GitHub Pages（見 `.github/workflows/deploy.yml`）
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

`public/data/reviews-index.json`（本站唯一資料）由上游的
RSS/知識庫 monorepo 產生（`scripts/reviews-index-*`：KB 抽取 + PubMed 補充 +
Crossref 期刊名解析 + IF 表），發布於公開 URL
`https://app.sportsmedicine.tw/data/reviews-index.json`。

本站的部署 workflow（`.github/workflows/deploy.yml`）每月 1 日自該公開 URL
自動拉取最新資料、commit 回本 repo 並重新部署（不需任何跨 repo token）。
也可在 Actions 頁手動觸發（workflow_dispatch）即時同步。

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
