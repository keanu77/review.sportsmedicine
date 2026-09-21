# Mac／Studio worker 安裝與啟用

這個 worker 在自己的 Mac 上呼叫已登入的 Codex、Claude、Gemini、Grok CLI，沿用各工具可用的訂閱與額度，不需要模型 API key。網站放在 Cloudflare Pages；D1 保存私人任務狀態，私人 R2 保存原文、查核紀錄與產物。worker 只向網站領取任務和上傳檔案，不開放本機伺服器、不自動發佈 FB／IG。

本文與目前 `worker/cli.mjs`、`worker/client.mjs` 和 [API 設定](../server/README.md) 對應。以下指令是操作步驟，文件與 setup 工具本身都不會建立雲端資源、登入帳號或啟動服務。

## 1. 選擇執行機器與 macOS 使用者

先選本機或 Studio 作為主要 worker，在那台機器用**同一個 macOS 使用者**完成 CLI 登入與執行。訂閱存在不表示另一台機器的 CLI 已登入；不要複製登入憑證資料夾代替正常登入。

LaunchAgent 在使用者登入後執行。Mac 關機、睡眠或使用者登出時不會處理工作；重開機後尚未登入也不會工作。網站仍可接受排隊工作，但 Mac 要醒著、連網且 worker 執行中，任務才會前進。只透過 SSH 登入 Studio 不等於建立 GUI LaunchAgent 工作階段；第一次可用螢幕共享開啟該使用者的 Terminal 完成設定。[Apple LaunchAgent 說明](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

repo 請放固定位置，例如 `~/Projects/review.sportsmedicine`，避免 `/private/tmp`、會被清理的下載資料夾或依賴雲端隨需下載的目錄。兩台機器可各自有 checkout，但不要共用同一個 worker 工作目錄。第一版伺服器一次只允許一個執行中任務，並不提供多工加速。

## 2. 安裝依賴、驗證 CLI 登入

以下在選定機器的 repo 根目錄執行。使用支援 `--env-file` 的 Node.js；範例採用 Node 24 或更新版本。`pdftotext` 由 Poppler 提供，Mac 尚未安裝時可用 `brew install poppler`。

```sh
node --version
npm ci
npx playwright install chromium
command -v node codex claude gemini grok pdftotext
codex login status
claude auth status
```

| CLI | 必須完成的準備 |
| --- | --- |
| Codex | 用 `codex login` 登入自己的帳號；草稿可選 Codex，AI 生圖目前也由 Codex 負責。CLI 可執行不等於登入具備生圖能力。 |
| Claude | 用 `claude auth login` 登入原本的訂閱帳號，再確認 `claude auth status`。可作草稿來源，也用於敘事查核。 |
| Gemini | 在**這台機器**執行 `gemini`，完成 CLI 的 Google 帳號登入。瀏覽器已登入 Google、Antigravity 已登入、或其他機器已登入，都不能代替 Gemini CLI 登入。詳見 [Gemini 官方登入說明](https://geminicli.com/docs/get-started/authentication/)。 |
| Grok | 沿用已安裝且支援本專案參數的 `grok` CLI，依該 CLI 自己的登入說明完成訂閱登入。不要換成需要 xAI API key 的其他同名套件；本專案不提供 Grok 安裝器。 |

`doctor` 目前會確認 Codex／Claude 登入狀態，但 Gemini／Grok 只檢查 CLI 是否可執行；不能據此宣稱 Gemini／Grok 已成功登入或查核。第一次研究工作的 `reviews.json` 才能確認實際查核是否完成。三者 `status: ran` 表示有結果；`unavailable`／`failed` 都不代表通過。

模型子程序只繼承基本執行環境與使用者登入位置，worker bearer token、Cloudflare 憑證及模型 API key 不會轉交給它們。仍需留意各 CLI 自己保存的登入方式與額度；設定工具不會改動它們。

## 3. 產生可檢查的設定範本

先確認上一節的 `command -v` 都指向真正的執行檔；shell alias/function 不會在 launchd 環境生效。下面目錄必須尚未存在、父目錄必須存在。

```sh
REVIEW_SERVICE_DIR="$HOME/review-worker-service"
node worker/setup-launchagent.mjs \
  --repo "$PWD" \
  --output "$REVIEW_SERVICE_DIR"
```

工具使用此次執行的 Node 絕對路徑，產生：

- `tw.sportsmedicine.review-worker.plist`：只有路徑與非秘密設定，沒有 token。
- `worker.env.example`：沒有真實憑證的範本，工作目錄預填為輸出目錄下的 `workspace`。
- `logs/` 與 `README.txt`。

輸出目錄與 logs 為 `0700`，檔案為 `0600`；工具拒絕覆蓋現有目錄或 symlink。它只寫進 `--output`，不呼叫模型、不讀 token、不寫 `~/Library/LaunchAgents`，也不執行 `launchctl`。

PATH 會包含 Node 所在目錄、Homebrew 常見目錄與系統目錄。如果 CLI 在其他位置，例如 `~/.local/bin`，重新選一個新的輸出目錄並加上 `--bin-dir "$HOME/.local/bin"`；可重複指定。可用 `--node /absolute/path/to/node` 指定固定 Node，`--label` 指定另一個服務名稱。請勿直接把整份含未知內容的 shell 環境放進 plist。

```sh
cp "$REVIEW_SERVICE_DIR/worker.env.example" "$REVIEW_SERVICE_DIR/worker.env"
chmod 600 "$REVIEW_SERVICE_DIR/worker.env"
```

用本機編輯器修改 `worker.env`。它不放在 repo 內、不提交 Git；秘密只保存在本機 `0600` env 和對應的 Cloudflare secret，不放在 plist、命令列參數、截圖或日誌。

| 設定 | 填寫方式 |
| --- | --- |
| `REVIEW_API_URL` | 網站 HTTPS origin，例如 `https://review.sportsmedicine.tw`；不加 `/api`、query 或帳密。 |
| `REVIEW_WORKER_TOKEN` | 與 Pages 的 `WORKER_TOKEN` 完全相同，使用密碼管理器產生至少 32 個隨機字元後直接貼入兩處。範本留白，未設定不能啟動。 |
| `REVIEW_WORKSPACE` | 本機可寫的絕對路徑，建議沿用產生的 `workspace`。不要放在公開網站資產目錄。 |
| `REVIEW_WORKER_ID` | 如 `studio` 或 `macbook`，每台機器用不同英數／連字號名稱。 |
| `REVIEW_MODEL_PROVIDER` | `codex` 或 `claude`，必須已登入。 |
| `REVIEW_REVIEWERS` | 預設 `claude,gemini,grok`，中間不加空格。缺少工具時會記錄原因，不自動當成全部查核完成。 |
| `REVIEW_CONTACT_EMAIL` | Unpaywall 用的實際聯絡 email，部分全文搜尋需要；這不是 API key。 |
| `REVIEW_IMAGE_PROBE_DIR` | 第 5 節完成 image-probe 後填該資料夾的絕對路徑；未驗證時先留白。 |
| `PW_CHANNEL` | 預設不填，使用 Playwright Chromium；改用已安裝的系統 Chrome 時填 `chrome`。 |

env 由 Node `--env-file` 讀取，路徑中的空格請保留引號；**`$HOME`、`~` 不會自動展開**。已有 shell 環境變數會優先於 env 檔，切換設定時避免沿用舊的 `REVIEW_*` 環境。[Node env-file 說明](https://nodejs.org/api/cli.html#--env-filefile)

## 4. Cloudflare 外部設定

### 第一次開通與費用

使用者目前尚未建立 Zero Trust。先由帳號擁有人開啟 [Cloudflare dashboard](https://dash.cloudflare.com/)，進入 Zero Trust，依 [官方首次開通流程](https://developers.cloudflare.com/learning-paths/clientless-access/initial-setup/create-zero-trust-org/) 設定團隊名稱並選擇 Free。若名稱可用，可使用 `sportsmedicine-review`；實際網域以畫面回傳的 `…cloudflareaccess.com` 為準。首次方案／付款資訊需由帳號擁有人處理；不把 billing 畫面上的私人資料貼到聊天中。

目前的管理登入讀取組織設定回應403，尚不能代為完成這一步。完成後記下團隊網域；後續 Access application 可使用 email one-time PIN，Allow policy 唯一 email 是 `keanu.firefox@gmail.com`。

2026-09-21 官方價格：Access Free 最多50人；Functions每日10萬請求及D1免費配額可供小量使用。R2 Standard包含每月10 GB-month與一定操作額度，超量儲存US$0.015/GB-month，操作另按量計價。額度依帳號共用，不能保證此專案永遠零費用；目前沒有新增付費方案，也沒有開通這個專案的遠端資源。模型沿用既有CLI登入及其訂閱用量，不自動改走付費API。

來源：[Cloudflare方案](https://www.cloudflare.com/plans/)、[Functions](https://developers.cloudflare.com/pages/functions/pricing/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/)、[R2](https://developers.cloudflare.com/r2/pricing/)。

### 配置工作台資源

這部分需要 Pages、D1、R2 與 Zero Trust 的管理權限，由管理者在既有專案設定。尚未建立或驗證這些項目，就不能宣稱 worker 已連上正式站。

1. 建立 D1 `review-private-jobs` 與私人 R2 bucket `review-private-artifacts`。在 `wrangler.jsonc` 將零 UUID 換成實際 D1 ID，保留 binding 名 `DB`／`ARTIFACTS`，R2 不開公開存取。
2. 套用 `migrations/0001_private_jobs.sql`，例如 `npx wrangler d1 migrations apply DB --remote`。先確認 Wrangler 登入的是正確帳號與環境；本機測試使用 `--local`。
3. 在 Pages 正式環境設定下表；預覽環境另行設定，避免預覽端點使用不一致的認證。`WORKER_TOKEN` 用 secret 類型，值與本機 env 相同。
4. 在 Cloudflare Access 建立應用程式，保護 `/workbench`、`/workbench/*`、`/api/private/*`，Allow policy 只允許自己的 email。公開文獻索引保持公開。
5. `/api/worker/*` 必須可以直接到達 Pages Function，由應用程式驗 bearer token；不要讓它轉到瀏覽器 Access 登入。如果現有 Access 已涵蓋整個網域，需用適當的路徑範圍排除 worker API。這裡不使用 Access service token。
6. 依現有專案部署流程建置並部署 Pages Functions、D1／R2 bindings 與前端，再以第 5 節驗證。repo 的單元測試或本機 smoke 不等於正式環境已完成設定。

| Pages 變數／secret | 用途 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com` |
| `ACCESS_AUD` | 同一 Access application 的 audience tag |
| `OWNER_EMAIL` | 唯一允許的擁有者 email |
| `WORKER_TOKEN` | 至少 32 字元的隨機 bearer secret；不是 Cloudflare API token，也不是模型 API key |
| `APP_ORIGIN` | 建議設定正式 origin，限制擁有者修改請求的來源 |

Function 仍會驗 JWT 簽章、issuer、audience、有效期與 owner email；只有 Access 畫面設定不能取代伺服器驗證。[Cloudflare JWT 驗證說明](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

若需本機 owner API 測試，現有實作仍要求有效 Access JWT，不提供 dev bypass。`node tests/server/wrangler-smoke.mjs` 使用隔離的本機 D1／R2，不會替正式站配置 Access。私人產物的保留期限、舊版本清理與容量監控目前也需管理者另外安排。

## 5. 先以前景模式驗證

在 repo 根目錄執行；`doctor` 會建立指定工作目錄、檢查 CLI、瀏覽器與磁碟，不會自動呼叫模型或生成圖片。

```sh
node --env-file="$REVIEW_SERVICE_DIR/worker.env" worker/cli.mjs doctor
```

`run` 啟動時也會跑 doctor，草稿模型、`pdftotext` 或 renderer 不可用會停止。要啟用寫實／插畫製圖，還需**實際**完成一次生圖測試；這會使用訂閱額度。先下載一篇可取得合法全文的文獻，再使用同一資料夾：

```sh
REVIEW_PROBE_DIR="$REVIEW_SERVICE_DIR/image-probe"
node --env-file="$REVIEW_SERVICE_DIR/worker.env" worker/cli.mjs prepare \
  10.26603/001c.25754 --dir "$REVIEW_PROBE_DIR"
node --env-file="$REVIEW_SERVICE_DIR/worker.env" worker/cli.mjs image-probe \
  --dir "$REVIEW_PROBE_DIR"
```

在 env 中將 `REVIEW_IMAGE_PROBE_DIR` 填成這個資料夾的**實際絕對路徑**，再跑一次 doctor。只有圖片檔、hash 和生成來源驗證成功，且 Codex 登入可用，才會顯示 `imageGeneration.available: true`。這是生圖能力紀錄，不是未來額度保證；更換帳號或機器後應用新的資料夾重新驗證。不要搬移一張 PNG 假裝已完成 probe。

未提供或無法驗證 probe 時，worker 不領取 `photo`／`illustration` 製圖任務，這些工作會留在排隊狀態；研究工作與 `none` 純文字製圖仍可執行。選用 `none` 不需要生圖能力。

先在網站工作台準備一個想處理的任務，再執行：

```sh
node --env-file="$REVIEW_SERVICE_DIR/worker.env" worker/cli.mjs run --once
```

**`--once` 會領取並執行一個實際任務，不是只測連線**；沒有任務時顯示等待後結束。成功後可用 `run` 持續輪詢，每輪空閒約 30 秒。初次驗證請查看網站結果和 `reviews.json`，並開圖核對：文字可讀、圖片沒有不合理裁切、模型查核是否真的執行、醫療限定語是否完整。

## 6. 手動啟用 macOS LaunchAgent

完成前景驗證後，才做以下安裝。先用 `plutil -lint` 及編輯器檢查 plist；尤其是 repo、Node、CLI PATH。設定裡沒有 token，可安全閱讀 plist 本身。以下使用預設 label；若生成時更換過 label，請同步更換檔名。

```sh
plutil -lint "$REVIEW_SERVICE_DIR/tw.sportsmedicine.review-worker.plist"
mkdir -p "$HOME/Library/LaunchAgents"
install -m 600 "$REVIEW_SERVICE_DIR/tw.sportsmedicine.review-worker.plist" \
  "$HOME/Library/LaunchAgents/tw.sportsmedicine.review-worker.plist"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/tw.sportsmedicine.review-worker.plist"
launchctl print "gui/$(id -u)/tw.sportsmedicine.review-worker"
```

`bootstrap` 會立即啟動；`RunAtLoad` 和 `KeepAlive` 讓服務在登入後啟動、程序退出後重新啟動。這只維持 worker 程序，不會替失敗或過期任務自動重新消耗模型額度。

停止服務：

```sh
launchctl bootout "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/tw.sportsmedicine.review-worker.plist"
```

不要用 `sudo` 啟動這個 LaunchAgent，否則會換成另一個使用者的登入環境。要永久停用，在 bootout 成功後，把安裝的 plist 移出 `~/Library/LaunchAgents`。修改 env、更新 repo／Node、改變 CLI 路徑後，先停止，再檢查路徑與依賴、以前景 doctor 驗證，最後重新 bootstrap。啟動過的服務不要直接重複 bootstrap；第一次顯示 already loaded 時先看現況。

日誌位於 `$REVIEW_SERVICE_DIR/logs/worker.out.log` 與 `worker.err.log`。不要輸出整份 env 來除錯。launchd 範本設 `umask 077` 保護新檔；它沒有內建日誌輪替，使用一段時間後需安排保留期限和磁碟清理。

## 7. 日常工作流程與常見問題

1. 從文獻索引按「製作社群素材」，以 Access 登入自己的工作台，或輸入 DOI／PMID／PMCID 建立研究任務。
2. worker 尋找可合法取得的原文 PDF，核對文獻身分、擷取全文，產生草稿與可定位的引文；取不到全文時停止，不能把 abstract 冒充全文。
3. 在工作台閱讀研究筆記和各模型查核紀錄，修改並儲存草稿，選配色、版型、圖片形式與比例，再明確要求製圖。
4. worker 製作並上傳圖片、文案和 ZIP；人工檢視後下載，自行決定如何發佈。沒有自動社群發佈步驟。
5. 中斷、取消、額度不足或 120 秒租約過期的工作，先檢查既有紀錄，再由工作台明確重試。服務每 30 秒更新 heartbeat；Mac 睡眠可能使租約過期，喚醒不會自動恢復該任務。

| 現象 | 檢查方式 |
| --- | --- |
| API 回傳登入 HTML、302 或「未回傳 JSON」 | `/api/worker/*` 是否被 Access 瀏覽器登入攔住；API origin 是否正確。 |
| 401／worker 認證失敗 | 本機 `REVIEW_WORKER_TOKEN` 與該部署環境 `WORKER_TOKEN` 是否相同；不要把 token 貼入回報。 |
| 工作停在排隊 | Mac 是否醒著且已登入、worker 是否啟動、是否有其他執行中工作；有圖製作再確認 probe 和 imageGeneration capability。 |
| Gemini CLI 存在但查核失敗 | 在同一使用者互動執行 `gemini` 完成登入；查看 `review-gemini.json` 與私人原始輸出。 |
| 前景可用、LaunchAgent 找不到 CLI | alias 不會生效；把實際執行檔的目錄加入 `--bin-dir`，再產生並檢查 plist。 |
| renderer 找不到 browser | 在執行 worker 的同一使用者跑 `npx playwright install chromium`，或確認系統 Chrome 並填 `PW_CHANNEL=chrome`。 |
| 已有模型請求紀錄但無結果 | 先檢查私人工作日誌，避免盲目重試。手動 CLI 只有明確加 `--retry`／`--retry-reviews` 才重試相應步驟；網站則由使用者操作重試。 |
| 標題或卡片爆版 | 調整文字／分頁再重新製圖；渲染器會報錯，不會自動刪掉醫療限定語。 |

安裝文件與本機測試完成後，仍須外部完成：每台機器的 CLI 登入與生圖 probe、真實 Cloudflare 資源與 secret、Access 路徑及 owner policy、正式部署、一次端到端研究→審閱→製圖驗證，以及你自行啟用 LaunchAgent。
