# 運動醫學 Review 索引

用中文臨床用語或英文關鍵詞，查找運動醫學與復健相關文獻，核對資料來源，並在瀏覽器中整理自己的待讀清單。

[開啟網站](https://review.sportsmedicine.tw/) · [English](README.md) · [參與貢獻](CONTRIBUTING.md) · [資料來源](docs/data-sources.md)

![公開文獻索引操作畫面](docs/images/public-index.png)

[操作示範短片](docs/images/public-workflow.webm) · [手機版預覽](docs/images/public-mobile.png)

畫面擷取自此分支的本機建置，正式站需待發布後才會同步。瀏覽器支援目標為 Safari 16.4+、Chrome 111+、Firefox 128+；目前自動化瀏覽器驗證使用 Chromium。

## 先試一次

1. 搜尋 [五十肩](https://review.sportsmedicine.tw/?q=%E4%BA%94%E5%8D%81%E8%82%A9)、[frozen shoulder](https://review.sportsmedicine.tw/?q=frozen%20shoulder) 或 [PRP](https://review.sportsmedicine.tw/?q=PRP)。
2. 用部位、臨床主題、族群與發表期間縮小範圍，再開啟文獻詳情查看識別碼與來源欄位。
3. 收藏文獻、標記待讀或已讀，勾選後匯出 RIS／BibTeX；用 JSON 備份保存或移轉整份文獻庫。

介面使用繁體中文，搜尋支援中英文。公開索引不需要帳號或 API 金鑰。

## 功能

- **中英文臨床搜尋**：支援病名、常見縮寫、期刊、作者、DOI、PMID 與 PMCID；沒有結果時提供可執行的相關搜尋建議。
- **可追溯的文獻詳情**：區分書目來源、原文摘要或節錄，以及 AI 中文摘要；缺漏欄位保留提示，依標題推測的文體也會註明。
- **分開標示全文狀態**：區分來源列出的免費全文與上游推測。能免費閱讀，不代表可自由重製或再散布。
- **本機文獻庫**：保存收藏、閱讀狀態與書目／摘要快照，文獻離開滾動索引後仍能查閱已保存資料；支援 JSON 備份與批次引用匯出，不補造作者。
- **更新與分享**：分享搜尋條件、瀏覽新增文獻、查看資料完整度，或訂閱 [Atom feed](https://review.sportsmedicine.tw/feed.xml)。

文獻庫只存在目前瀏覽器，不會跨裝置同步；清除網站資料可能使收藏遺失，請定期備份。舊版收藏只有標題識別碼時，需在目前索引找到同篇文獻才能補快照，已消失的資料無法憑識別碼還原。

## 本機執行

使用 [.node-version](.node-version) 指定的 Node.js 24。

```sh
git clone https://github.com/keanu77/review.sportsmedicine.git
cd review.sportsmedicine
npm ci
npm run dev
```

開啟 Vite 印出的本機網址即可。Repo 已附公開索引資料，啟動公開頁面不需要模型、雲端帳號或憑證。

```sh
npm run typecheck
npm run test:frontend
npm run build
npm run preview
```

公開前端使用 React、TypeScript、Vite 與 Tailwind。瀏覽器測試與其他測試指令見 [貢獻指南](CONTRIBUTING.md)。

## 使用範圍

本工具供文獻探索、教育與研究參考，不提供個別病人的診斷或治療建議。AI 摘要、依標題推測的文體、缺漏書目與期刊近似指標可能有誤；引用和臨床判斷仍需回到原始文獻。書目欄位已核對，不代表研究品質或臨床結論已經評讀。

Repo 另含**擁有者限定的文獻與社群草稿工作台**。正式站沒有開放公眾使用 AI 工作台；上面的公開索引啟動步驟也不會設定私人服務。相關設定與維運指令見 [維護者操作](docs/maintainer-operations.md)。

## 歡迎貢獻

可從中英文搜尋用語、附來源的書目修正、鍵盤與螢幕閱讀器操作、回歸測試開始。Issue 可使用中文或英文，詳見 [貢獻指南](CONTRIBUTING.md) 與 [回報範本](https://github.com/keanu77/review.sportsmedicine/issues/new/choose)。

如果這個工具有助於你的閱讀或教學，歡迎在 GitHub 加星，讓其他人更容易找到。

## 授權與資料

專案程式碼採 [MIT 授權](LICENSE)。第三方摘要、文章、圖表與資料仍受各來源適用條款約束，不會因放進這個 repo 而變成 MIT 授權。詳見 [資料來源與再利用範圍](docs/data-sources.md)、[資安說明](SECURITY.md) 與 [維護者操作](docs/maintainer-operations.md)。
