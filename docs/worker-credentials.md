# Worker 憑證輪替與撤銷

`scripts/worker-credentials.mjs` 使用 Node 24 內建 API，產生 48 bytes CSPRNG、base64url bearer 憑證。主憑證自簽發日起有效 90 天；舊憑證最多重疊 60 分鐘，緊急輪替可設為零。worker 在到期前 14 天提示管理者，沒有自動續期。請在到期前完成一次輪替。

工具只修改 Cloudflare Pages **production** 的五個憑證設定；保留其他變數、D1／R2 bindings 和 preview。每次 `stage`、`retire`、`revoke` 後仍須另外部署，設定 API 成功不代表正式站已套用。部署後的 authenticated `GET /api/worker/health` 是唯讀驗證，不會領取任務；不要拿 `run --once` 或 claim API 測連線。

| 指令 | 行為與完成條件 |
| --- | --- |
| `status --env-file ABS` | 用本機憑證讀取 health；只輸出接受狀態、執行中任務數、到期日。 |
| `stage --plan ABS --env-file ABS --account ID --project NAME --worker-stopped` | 預設先確認舊憑證 health 成功、沒有執行中任務；保存新舊憑證於私人計畫，再寫 production 設定。預設重疊 60 分鐘。 |
| `activate --plan ABS --worker-stopped` | 新憑證 health 必須 200、到期日相符、`activeJobs: 0`；才原子替換本機 env 中的一個 token 設定，保留其餘內容。 |
| `retire --plan ABS` | 新憑證 health 成功且本機已啟用後，移除 production 的兩個舊憑證欄位；仍須部署。 |
| `verify --plan ABS` | 輪替要求新憑證 200、舊憑證 401；撤銷要求兩者皆 503 且錯誤碼為 `WORKER_NOT_CONFIGURED`。通過才刪除私人計畫；輸出只含到期日與接受狀態。 |
| `status --plan ABS` | 保留計畫、讀取新舊憑證的現場狀態，不做任何設定修改。 |
| `revoke --plan ABS` | 立即清除 production 主／舊憑證及日期五欄，要求再部署；不刪除 D1 任務、R2 產物或本機工作檔。 |

所有 Cloudflare 指令使用既有 `--wrangler-config ABS` OAuth 設定，或由私人環境提供 `CLOUDFLARE_API_TOKEN`。不接受 token 命令列參數、不啟動含秘密的 shell 子程序，也不輸出原始 API 回應或原生錯誤。OAuth 過期時，先用正常 Wrangler 登入流程更新，工具不保存或更新 Cloudflare 登入資料。

## 私人檔案與開始前檢查

本機 env 和計畫檔必須位於所有 Git checkout 之外，包含 ignored 路徑也不接受；直接父目錄為本人擁有的 `0700`，檔案為 `0600`，不得使用 symlink 或 hard link。工具使用原子寫入，不把新舊 token 放進 repo、日誌、命令列或輸出。Wrangler OAuth 檔同樣要求本人擁有、`0600`、非 symlink，父目錄無須 `0700`。路徑請用真實絕對路徑，例如 `/private/tmp` 而非 macOS 的 `/tmp` symlink。

在正式 checkout 執行下列設定；account ID 是非秘密的 Cloudflare 帳號識別碼，請以目前專案對應值替換。這些 shell 變數只存路徑或非秘密識別碼。

```sh
REVIEW_REPO="/Users/ethanwu/Documents/Vibe coding/claude/sportsmedicine review"
REVIEW_NODE="/opt/homebrew/opt/node@24/bin/node"
REVIEW_SERVICE="/Users/ethanwu/review-worker-service"
REVIEW_PLAN="$REVIEW_SERVICE/credential-rotation.json"
REVIEW_CF_ACCOUNT="REPLACE_WITH_32_CHARACTER_ACCOUNT_ID"
REVIEW_WRANGLER_AUTH="/Users/ethanwu/.wrangler/config/default.toml"
cd "$REVIEW_REPO"
"$REVIEW_NODE" scripts/worker-credentials.mjs status --env-file "$REVIEW_SERVICE/worker.env"
```

先核對 Wrangler OAuth 的實際路徑與檔案權限，不要 `cat` 它。如果 Wrangler 使用不同的全域設定目錄，改上面的路徑；不要複製 OAuth 資料進專案。開始後只允許一名操作者進行輪替；同時改 Dashboard secrets／另一份計畫會造成競爭。計畫中已固定 account、project、origin 與 env 路徑，重試不能換目標。

## 一般輪替

1. `status` 確認 `accepted: true` 且 `activeJobs: 0`，等目前任務完成。暫停新增／重試任務，使用已安裝的特定 LaunchAgent 停止 worker，再由 `stage` 檢查一次沒有執行中任務。若正好領到新工作，等待其租約／工作狀態妥善處理後再做輪替，不使用通用 `kill` 或 `pkill`。

```sh
launchctl bootout "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/tw.sportsmedicine.review-worker.plist"
"$REVIEW_NODE" scripts/worker-credentials.mjs stage \
  --plan "$REVIEW_PLAN" --env-file "$REVIEW_SERVICE/worker.env" \
  --account "$REVIEW_CF_ACCOUNT" --project review-sportsmedicine \
  --worker-stopped --wrangler-config "$REVIEW_WRANGLER_AUTH"
```

2. 依專案部署檢查完成測試、建置，再部署 **production/main**。必須部署包含新版 credential health API 的程式；以下例子使用已驗證的 `dist`，工具本身不執行部署。日期欄位亦以 `secret_text` 保存，避免 Wrangler 用設定檔 `vars` 取代 Dashboard plain variables 時遺失。

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx wrangler pages deploy dist \
  --project-name review-sportsmedicine --branch main
"$REVIEW_NODE" scripts/worker-credentials.mjs activate \
  --plan "$REVIEW_PLAN" --worker-stopped
```

`activate` 失敗時本機 env 保持原值；先查部署與 `status --plan`，保留計畫，不手動印出 token。活躍工作不為零時不會換本機憑證。`--worker-stopped` 是操作者對已停止服務的明確陳述，工具不自行呼叫 launchctl。

3. 重啟相同 LaunchAgent，使其讀取更新的 env；確認服務與新憑證，再移除舊憑證。

```sh
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/tw.sportsmedicine.review-worker.plist"
launchctl print "gui/$(id -u)/tw.sportsmedicine.review-worker"
"$REVIEW_NODE" scripts/worker-credentials.mjs status --env-file "$REVIEW_SERVICE/worker.env"
"$REVIEW_NODE" scripts/worker-credentials.mjs retire \
  --plan "$REVIEW_PLAN" --wrangler-config "$REVIEW_WRANGLER_AUTH"
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx wrangler pages deploy dist \
  --project-name review-sportsmedicine --branch main
"$REVIEW_NODE" scripts/worker-credentials.mjs verify --plan "$REVIEW_PLAN"
```

`verify` 成功會刪除包含舊 token 的私人計畫，輸出例如 `{"credentialExpiresAt":"…","currentAccepted":true,"previousAccepted":false}`。只把這份無秘密結果記入維護紀錄，保留到期提醒；不備份或提交計畫。檔案刪除不保證抹除已存在的系統備份，私人目錄應納入自己的敏感資料備份政策。

## 首次升級、異常重試與到期

舊版部署可能沒有 `/api/worker/health`。404、401、503 或 HTML 均不算健康成功，工具不會默默放行。首次升級時，操作者需先以擁有者工作台或唯讀 D1 查詢確認沒有執行中任務，再停止 LaunchAgent；例：

```sh
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx wrangler d1 execute DB --remote \
  --command "SELECT count(*) AS active_jobs FROM jobs WHERE status='running' AND lease_expires_at > unixepoch('now')*1000"
```

確認目標 DB、任務數為零且 worker 已停止後，才在一般 `stage` 指令加 `--bootstrap-reviewed`。這個選項明確代表手動完成舊版的 idle 檢查；仍必須部署新版 server，再通過 `activate` 的新憑證 health 檢查。它不適合掩蓋新版認證失敗。

新憑證與計畫先存檔，再送 Cloudflare。網路逾時或 API 失敗可能發生在伺服器已接受修改之後，因此不要刪除計畫重新生成。先使用 `status --plan`，必要時用同一計畫重試 `stage`；新 token 不會改變。`activate` 可以恢復「env 已換成功、計畫狀態未寫完」的中斷情況。若重疊窗口已過，stage 拒絕延長舊 token；保留計畫，先釐清 deployment/config 狀態，若新 token 已上線可繼續 `activate`。無法完成原計畫時，以撤銷流程處理，勿回滾到已曝光的憑證。

主憑證到期後 health 為 401，正常 stage 前置檢查不會放行。確認 worker 已停止後，可使用下節零重疊的緊急輪替流程恢復服務。

## 緊急輪替與完全撤銷

需要保留服務且舊 token 不可再接受時，建立新的私人計畫，在 stage 指令加 `--emergency --overlap-minutes 0 --worker-stopped`。這明確略過舊憑證的 health 前置檢查、移除舊欄位；後續仍走部署 → activate → 重啟 → retire → 部署 → verify。新憑證部署前不保證舊 token 已失效；應盡快完成部署。

需要先完全關閉 worker API 時，用目前計畫執行 `revoke`；沒有計畫時提供建立計畫所需的非秘密參數：

```sh
"$REVIEW_NODE" scripts/worker-credentials.mjs revoke \
  --plan "$REVIEW_PLAN" --env-file "$REVIEW_SERVICE/worker.env" \
  --account "$REVIEW_CF_ACCOUNT" --project review-sportsmedicine \
  --wrangler-config "$REVIEW_WRANGLER_AUTH"
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx wrangler pages deploy dist \
  --project-name review-sportsmedicine --branch main
"$REVIEW_NODE" scripts/worker-credentials.mjs verify --plan "$REVIEW_PLAN"
```

緊急撤銷不等待 idle，以避免延誤停用；操作者應停止特定 LaunchAgent。執行中任務可能因租約過期失敗，既有私人資料仍保留，由工作台人工決定後續重試。缺少主憑證時 server 刻意回應 503 `WORKER_NOT_CONFIGURED`；一般站台 503 不能通過驗收。恢復服務需新建計畫、執行零重疊緊急輪替，永不重新啟用已撤銷的 token。

驗收只涵蓋 env 中設定的 production origin。歷史 Pages deployment URL／其他域名可能保留舊版本與憑證，應另外確認這些路徑的 Access／域名保護與部署保留政策；本工具不刪除歷史部署或變更路由。

API 依據：[Cloudflare Pages project 更新](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)、本專案安裝的 Wrangler `pages secret`（逐欄 PATCH、`null` 移除、保留 `wrangler_config_hash`）。

## 測試

```sh
/opt/homebrew/opt/node@24/bin/node --test tests/server/worker-credentials-tool.test.mjs
```

測試只用 `/private/tmp` 中的 fixture token／env／OAuth 檔與注入的假 HTTP，涵蓋分段部署、idle 檢查、重試、錯誤訊息保密、權限／symlink／hard link／Git 路徑、無重疊輪替及撤銷。測試不讀實際憑證、不呼叫 production。

新版 worker API 只接受 `APP_ORIGIN` 指定的正式網域，所有 `*.pages.dev` 部署副本回覆 403。輪替時仍需移除加入此限制以前的舊部署，否則那些部署可能繼續接受舊 bearer token。移除的是舊建置入口；D1、R2 與 Git 歷史保留。
