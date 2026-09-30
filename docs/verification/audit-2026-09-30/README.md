# 多模型稽核後的確認與修正

日期：2026-09-30。基底：`92a167e2414651fd8d928d66515c78b1bc550f11`。工作分支：`fix/audit-followup-20260930`。

## 已確認的問題與處理

1. **摘要／標籤的標題鍵無法區分不同來源識別碼。** 實際公開資料有 4 組標題鍵、8 筆不同 DOI 紀錄。搜尋、詳情、新增清單現在先以完整索引及已載入書目資料檢查 DOI／PMID／PMCID 衝突，有衝突就沿用各自原始摘要與分類，不套用該鍵的疊加摘要／新標籤。原始文獻、疊加檔案和醫療文案未刪除或改寫。
2. **月報未檢查摘要與標籤。** 月報現會列出檔案狀態、產生日期、唯一文獻覆蓋率、相較上月百分點變化與識別碼衝突；缺檔／壞檔與 0% 分開呈現，沒有上月資料時不虛構變化。自訂標籤覆蓋率不是以 100% 為目標。
3. **廣泛查詢的 CPU 與 DOM 成本。** 本機手機尺寸、6 倍 CPU 節流確認 `review` 命中 701 篇時延遲。分頁降至每頁 25 筆；排序分數每篇每次查詢計算一次；普通文字不再嘗試 URL 解析，缺省全文 URL 也不再觸發空字串解析例外。網址保留頁碼，支援重新整理／上一頁，變更查詢或篩選回第一頁，頁面上下均有分頁控制，換頁將焦點帶回結果區。
4. **深色 smoke 覆蓋不足。** 已新增深色 Chromium 的無障礙、公開工作流與分頁檢查；亮／深色現有檢查皆通過，未發現需要改色盤的缺陷。
5. **重新安裝發現的依賴公告。** 當時 npm audit 顯示 1 high、2 moderate（Wrangler → Miniflare → undici）。在現有相容範圍更新到 Wrangler 4.144.0、undici 7.29.1 後歸零；本機真實 Pages Functions／D1／R2 驗證亦通過。另加入 Node 24 型別與維護腳本的持續型別檢查。

## 摘要鍵碰撞的來源核對

不同 DOI **不是**不同研究、也不是醫學摘要錯誤的充分證據。補查一次來源後，這四組可找到下列關聯：

| 標題群組 | 原始紀錄 | 可確認的關聯 |
| --- | --- | --- |
| MPFL operative/nonoperative review | [AJSM / PubMed](https://pubmed.ncbi.nlm.nih.gov/41496495/)；[OJSM 會議摘要](https://journals.sagepub.com/doi/abs/10.1177/2325967126S00241) | 同作者、近同標題，第二筆位於會議增刊；不能稱為兩項獨立研究或已錯配摘要。 |
| AI in orthopedic surgery | [原紀錄](https://pubmed.ncbi.nlm.nih.gov/42017641/)；[出版社譯文紀錄](https://www.sciencedirect.com/science/article/pii/S1888441526000342) | 出版社標為譯文；兩個 DOI 並非足以證明內容不同。 |
| Cardiac imaging consensus Part 1 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/42332973/) | 來源紀錄說明獲准在兩本期刊共同發表。 |
| Cardiac imaging consensus Part 2 | [PubMed](https://pubmed.ncbi.nlm.nih.gov/42332984/) | 來源紀錄說明獲准共同發表。 |

本次沒有將上述四組宣告為醫學錯誤，也未改寫摘要。程式修正的是沒有識別碼約束的自動對應機制；8 筆紀錄暫用各自原始摘要。若要恢復加值摘要，應先保留可追溯的原摘要來源並建立明確 DOI／PMID 綁定，不能因標題相同便自動移除防護。此處核對的是出版關聯，並非完整臨床內容審查。

目前靜態資料：911 個原始項目、857 筆去重後文獻；可套用摘要 745/857（86.9%）、自訂標籤 119/857（13.9%），因上述歧義停用疊加摘要 8 筆。

## 搜尋量測

Chromium 153.0.8010.12，390×844，6 倍 CPU 節流，本機 preview，外部字體請求停用。每個查詢 5 次。從 input 事件開始，以雙 requestAnimationFrame 估計畫面呈現時間；這是受控實驗指標，**不是正式站 field INP，也不代表所有手機或網路**。

| 查詢 | 修正前結果完成中位數 | 修正後結果完成中位數 | 修正前 input-to-paint 中位數 | 修正後 input-to-paint 中位數 |
| --- | ---: | ---: | ---: | ---: |
| ACL | 403 ms | 74 ms | 317 ms | 29 ms |
| knee | 392 ms | 74 ms | 299 ms | 26 ms |
| review | 2,871 ms | 110 ms | 2,220 ms | 68 ms |

`review` 的 DOM 節點從 21,414 降至 917；701 篇總結果仍可逐頁存取。僅做分頁時延遲仍約 2.3 秒；後續才定位到反覆計分與 URL 解析例外，不能把整體改善只歸功於分頁。

原始資料：[before.json](before.json)、[pagination.json](pagination.json)、[cached-ranking.json](cached-ranking.json)、[after.json](after.json)。`before` 是摘要防護已加入、效能修正尚未開始的版本。對實際資料做 19 種查詢 × 2 種排序、共 38 組新舊演算法對照，命中集合及完整排序一致。

重做量測（在兩個終端機）：

```sh
npm run build
npm run preview -- --port 4182 --strictPort
# 另一個終端機，在 repo 根目錄：
node scripts/profile-public-search.mjs http://localhost:4182/ /tmp/review-search-profile.json
```

## 本機驗證

- `npm run typecheck`：通過，包含新增維護腳本的型別檢查。
- `npm run build`：通過。
- `npm test`：server 89、worker 92、frontend 53，共 234 通過。
- `npx playwright test --workers=2`：113 通過，含深色、分頁、摘要衝突與原有工作台回歸。
- `npm run test:local-api`：真實本機 Pages Functions／D1／R2 通過。
- `npm audit --audit-level=moderate`：0 vulnerabilities。
- 月報腳本在臨時資料夾用現有公開資料產出成功；未覆寫歷史月報。
- 上述驗證未寫入正式 D1／R2，也未部署至正式環境。SEO 獨立頁缺少需求與成效證據，本次沒有實作。
