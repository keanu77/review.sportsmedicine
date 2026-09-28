# 資安與憑證管理

## 本專案的資料邊界

公開文獻索引與私人工作台是不同的權限範圍。私人 API 必須驗證 Cloudflare Access JWT 的簽章、issuer、audience、期限與 owner；worker 使用獨立且有期限的 Bearer credential，不能與前端共用。worker.env／OAuth 資料保留在 repo 外的私人路徑；不要把它們複製到建置環境、瀏覽器或測試截圖。ACCESS_AUD 是驗證 token 的應用識別碼，本身不是登入憑證。

## Key 與部署

- 真實 Key、服務存取碼、worker credential 不進 Git、前端 bundle、URL、範例資料或錯誤日誌。範例設定只放變數名稱與明確占位文字。
- 記錄錯誤類別、受控狀態碼與可追蹤資訊即可；不要列印完整 SDK／HTTP 錯誤、headers、request body 或含查詢參數的上游 URL。
- 憑證由後端部署環境或 repo 外的私人環境檔提供。公開 repo 不代表要公開執行中的服務權限。
- 發現真實憑證外洩時，先在供應商撤銷／輪替並檢查使用紀錄，再處理 Git 歷史。單純刪除目前檔案無法清除歷史中的憑證。請勿在公開 Issue 貼入秘密原值。

## 自動檢查

`.github/workflows/security-secrets.yml` 在 push／PR 或手動觸發時掃描完整取得的 Git 歷史。Gitleaks 固定 v8.30.1，下載檔案比對固定 SHA-256；checkout action 釘定提交，只有 contents:read 權限。掃描輸出遮蔽命中內容，不上傳含秘密的完整報告。

本機安裝同版 Gitleaks 後，在 repo 根目錄執行：

```sh
gitleaks git --log-opts="--all --full-history" --ignore-gitleaks-allow --redact=100 --no-banner --no-color .
```

掃描通過只代表該次規則沒有發現尚未排除的秘密，不保證沒有未辨識的憑證或部署設定問題。例外需逐筆驗證；不得整批排除所有測試、環境設定或歷史提交。

## 本輪範圍

2026-09-28 的本輪變更加入秘密掃描 CI 與憑證管理說明，未更動應用程式、私人工坊、worker 或資料庫。實際發布以 GitHub commit、CI 與線上驗證紀錄為準。repo 可見性與正式憑證維持既有設定；掃描通過不代表所有正式 AI 供應商、帳務或結果品質均已驗收。
