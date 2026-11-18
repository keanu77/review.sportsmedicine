# Review × 知識庫閱讀試點 v2

固定 30 篇、三主題各 10 篇。公開資料包含 29 篇來源綁定的摘要閱讀草稿；PMID 42527106 無摘要，保留缺漏。23 篇對應 RSS KB、8 篇對應 Ethanai（後者均在前者內）；Review 已收錄 22 篇，另有 8 篇 metadata 候選。這是可重建的本機試點，尚未臨床核准或部署。

## 使用

```sh
npm ci
npm run data:kb-learning
npm run build
npm run preview -- --host 127.0.0.1 --port 4181 --strictPort
```

開啟 `http://127.0.0.1:4181/?view=kb-pilot`。下載雙向差異報告、待收錄 metadata 清單，或提出單篇來源綁定的閱讀卡修正。

本機批註可透過搭配的知識庫 repository 中 `scripts/review_kb_feedback.py` 接受後匯出，載入頁面；撤回後重新匯出／載入會清除。批註不傳送、不持久化、不加入醫學證據。詳盡操作及兩 repo patch 在知識庫 repo 的 `docs/runbooks/review-kb-learning.md` 與 `docs/verification/review-kb-learning-2026-11-19/`。

## 驗證

```sh
npm run typecheck
npm test
REVIEW_KB_FEEDBACK_CLI='/path/to/AIKnowSystem3.0/scripts/review_kb_feedback.py' npx playwright test tests/smoke/kb-pilot.spec.ts tests/smoke/kb-learning.spec.ts tests/smoke/kb-learning-integration.spec.ts
```

整合測試使用獨立測試佇列，不做臨床核准；未提供 companion CLI 變數時該一項會 skip。Playwright 自行 build 並啟動 4180。

來源核對、摘要 canonicalization、兩處來源統計疑義及免費／OA／授權差異，見 [來源紀錄](review-kb-source-checks.md)。草稿及 receipts 更新須同時升級 `manifest.version` 並重建；數值 token 檢查不取代語意與臨床評讀。`baseline-v1.json` 僅保留 ID 與指紋，供版本差異比較。

既有錯配 Ethanai 全文仍隔離；原始摘要、私人全文與本機批註均未放入公開生成物。此版本不新增 Actions 排程或模型呼叫，也不變更現有正式索引收錄範圍。
