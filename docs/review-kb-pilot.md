# Review × 知識庫試點

入口：`/?view=kb-pilot`。這是固定 30 篇的候選與評讀流程試點，沒有正式 KB 寫入、模型訓練或新排程。PRP 膝 OA、ACL 重返運動、五十肩各 10 篇；22 篇在 Review，8 篇五十肩文獻為待收錄候選。本次 Ethanai 抽樣精確對應 8 篇，1 篇全文錯配已在試點隔離；未對應不代表知識庫沒有收錄。

`data/kb-pilot/sources.json` 為逐篇 Europe PMC PMID 查詢的公開書目快照；`queryUrl` 與 `sourceCheckedAt` 可追溯查核。`kb-metadata.json` 只有比對需要的書目，未包含 KB summary、全文、AI 長摘要、私人閱讀狀態。`source-conflicts.json` 保留錯配身分及原內容 hash，不含全文。

```sh
npm ci
npm run data:kb-pilot
npm run typecheck
npm test
npx playwright test tests/smoke/kb-pilot.spec.ts
npm run build
npm run preview -- --host 127.0.0.1 --port 4181
```

Builder 不呼叫網路或模型，同一輸入產生相同 JSON 和來源指紋。正常索引不載入試點 JSON。為保留固定版本，builder 為明確執行的命令，不掛入每月同步或 CI 的資料更新；調整候選需更新 manifest 版本、來源快照並重建，不能把舊來源查核時間改成現在來假裝重新查核。

閱讀卡的研究範圍來自題名，結果、偏差風險、臨床適用性均待逐篇評讀。下載的修正檔只有提案狀態，綁定 `pilotVersion` 及來源指紋；不傳送收藏、筆記或修正內容。上游 RSSAIsystem 的 `scripts/review_kb_feedback.py` 可匯入本機 queue，再依 `data/kb-pilot/feedback-snapshot.json` 審核與撤回，尚無正式資料庫 adapter。

已知錯配：Ethanai 13271 書目為 Wang/Yao 的 PRP 膝 OA 療效回顧（PMID 41107915），全文卻是 Nakagawa 等人的 MIBO 報告品質回顧（PMID 39754417）。隔離僅作用於本試點，原始知識庫未被修改。

移除試點入口、元件與靜態 JSON 即可撤回網站試點；本機 queue 的 withdraw 會移除 accepted overlay 的項目並保留稽核事件。操作者具名接受仍非平台驗證身分或臨床核准。
