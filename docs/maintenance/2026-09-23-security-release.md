# Review 安全改善上線驗證 — 2026-09-23

安全程式 `e7465e7` 已合併並推送 main。每月維護另產生 `317df89`，只更新相容的建置依賴鎖定檔與維護報告。以下驗證涵蓋正式部署 `2171b93e-0808-4112-895c-83cc9be6bd8d`（317df89），完成於 2026-09-23 02:49 UTC；本紀錄本身的提交只更新文件。

## 已生效的保護

- 「登出並清除本機草稿」含確認、跨分頁清理、取消私人請求、釋放圖片與下載 Blob。正式 UI 已顯示按鈕；真正的登出與休眠分頁競態以隔離測試驗證，沒有讓擁有者的正式登入失效。
- Worker 憑證已有簽發／到期日，最長 90 天；本次到期為 **2026-12-22 00:29:38 UTC**（台北 08:29／東京 09:29）。提前 14 天提醒，**不會自動續期**。Mac worker 已切換新憑證並恢復持續回報。
- 正式 worker health：新 bearer 200、activeJobs 0；舊 bearer 與無效 bearer 401。舊憑證設定已移除並重新部署。
- Worker API 只接受正式 APP_ORIGIN。主 pages.dev 網址回 403；部署別名另外由 Access 保護。
- 每月流程的驗證 job 為 contents:read；獨立發布 job 驗證白名單內容、檢查 main 未過期後才使用短暫 write token 推送。正式跑過完整發布。

## 歷史部署的額外處理

8 個保留舊憑證的舊部署已經由 Pages API 刪除，逐一查詢均回 404。實測其中 5 個刪除後的網址仍能執行舊 Functions，因此**不把刪除成功當作安全驗收**。

已透過 Pages「限制預覽」建立 `*.review-sportsmedicine.pages.dev` 的 Access 應用；UI 核對 allow 規則只有擁有者 email。再次帶舊 bearer 測試全部 8 個舊入口，均先回 302 Access 登入，無法只憑旧 bearer 使用。這層 Access 必須保留；不宣稱平台已抹除全部舊快照。正式自訂網域與公開索引未被預覽政策阻擋。

[Cloudflare 預覽存取說明](https://developers.cloudflare.com/pages/configuration/preview-deployments/)提供此保護方式；[官方 issue](https://github.com/cloudflare/developer-platform/issues/67)也有刪除後網址仍可存取的回報。以上結果以本專案實測為準。

## 正式站與資料檢查

- 公開首頁 200；正式 JS／CSS 與本機已驗證 build 位元組相同。
- 未登入 session、jobs、版本歷史、file 路徑皆轉往 Access；偽造 email／unsigned JWT 無法取得私人 session。
- R2 managed public access 為 false，custom domains 為空。
- 158 份原始碼、建置檔與正式 HTML／JS／CSS 的精確憑證比對，0 匹配。這是指定憑證值的檢查，非所有可能漏洞的保證。
- Edge 已登入工作台顯示 3 筆既有紀錄、Mac 已連線與到期日。已完成任務的 7 張圖片成功載入，ZIP 已經由受認證請求準備為「檔案已就緒」（2964 KB）並提供儲存連結；本次沒有另宣稱 OS 最終儲存成功。
- 未新增／重試正式製作任務，未呼叫生成模型、未變更既有任務、草稿、審核結果、D1 schema 或 R2 產物。兩筆既有全文取得失敗紀錄仍保留原狀。

## 測試與排程

- 本機本次重驗：server 57、worker 38、frontend 40，共 **135/135**；瀏覽器 **76/76**；TypeScript／build／diff check 通過；完整 npm audit **0 vulnerabilities**。
- [維護 run 35802365220](https://github.com/keanu77/review.sportsmedicine/actions/runs/35802365220)：verify 與 publish 都成功；Ubuntu 跑相同 135 個測試、76 個瀏覽器案例、真正 Pages Functions + D1/R2 smoke、實際 worker rendering → authenticated ZIP integration，以及完整 audit。發布產生 `317df89`。
- [文獻同步 run 35802366391](https://github.com/keanu77/review.sportsmedicine/actions/runs/35802366391)：`apply_updates=false`，驗證與 artifact 成功，publish 按設定略過；不把 dry-run 說成新文獻已發布。
- 文獻更新：每月 1 日 03:17 UTC（台北 11:17／東京 12:17）。維護：每月 3 日 03:37 UTC（台北 11:37／東京 12:37）。兩者的排程都會在驗證成功後發布，失敗保留現有內容與紀錄。
