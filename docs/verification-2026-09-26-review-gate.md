# 審核版本閘門與 CI 驗證紀錄

日期：2026-09-26。基準 commit：`3b2eef1`。分支：`fix/review-version-gate`。

## 行為變更

- 製作前，主審必須成功審核目前的草稿快照版本。
- 人工修改、模型修訂、還原舊版或版本不明的歷史審核，都必須重新審核。
- 批次把舊意見標為已修正、勾選接受警告，不能解除版本阻擋。
- 審核與草稿版本使用 `draftRevision`，不使用會因排隊、完成而遞增的任務 `revision`。
- 未改文字的儲存／reconciliation checkpoint，以及配色、尺寸、版型調整，保留審核效力。
- 前端共用同一閘門，未存檔的修改也不會顯示檢查通過；儲存提示不再暗示可直接製作。
- 月度 workflow 在 `npm test` 前安裝 Chromium／ffmpeg；新增 PR 與 main push 自動驗證 workflow，權限為 `contents: read`，沒有發布步驟。

## 回歸證據

先新增 9 項 API／前端測試，在修正前得到 6 失敗、3 通過。失敗涵蓋過期版本、未知版本、未儲存修改、批次處理舊意見、模型修訂、還原舊稿；API 原本錯誤地回傳 200 並排入製作。修正後全部通過。

更新既有 API／瀏覽器測試，讓修改後的製作流程明確經過重新審核；另外保留任務版本競爭、附件保護、舊輸出提示與警告確認的測試目的。

最終本機驗證（Node 24）：

| 檢查 | 結果 |
| --- | --- |
| TypeScript | 通過 |
| Server | 86/86 |
| Worker | 92/92 |
| Frontend | 49/49 |
| Chromium renderer | 10/10 |
| Worker → API → ZIP integration | 1/1 |
| 瀏覽器 smoke（包含重新 build） | 97/97 |
| 真實本機 Pages Functions + D1/R2 | 通過 |
| 3 份 workflow YAML 語法解析 | 通過 |
| `git diff --check` | 通過 |

合計 335 項測試，無略過；本機 API 檢查另計。模型輸出與私人 API 的瀏覽器資料採測試替身，沒有呼叫正式任務或付費模型。

## 重跑

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run test:renderer
npm run test:integration
npm run test:smoke -- --workers=2
npm run test:local-api
```

本機須備有 Playwright Chromium 與 ffmpeg；受限沙箱可能阻擋 Chromium／workerd 啟動。

這是本機驗證；新 workflow 尚未在 GitHub runner 驗證，也尚未部署。未變更正式 D1 資料，不需要資料庫 migration。版本不明的既有任務在更新後會要求重審。

本次開發目錄：`/private/tmp/review-gate-20260926`。原工作目錄仍在 `main`，原有 `skill-updates/` 保留。
