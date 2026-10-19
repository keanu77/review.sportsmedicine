# GitHub 參考專案與發布準備

查核日期：2026-10-20。範圍：官方 GitHub／官方文件、此工作樹的 README 與公開設定，以及 GitHub API 的唯讀 metadata、release、community profile。沒有發文、建立 release、變更 repo 可見性或授權。此報告的產品建議是依目前需求作出的判斷，不代表參考專案已證實某項功能能增加 stars。

**建議定位：讓臨床讀者從中英文關鍵字找到運動醫學文獻、核對來源，再保存與引用。** 優先展示這條完整路徑。公開索引與擁有者私人工作台應各有清楚入口；本輪功能尚須主流程完成整合與線上驗證，才可用下方新版發布稿。

## 7 個值得借鏡的專案

| 專案與已查閱來源 | 可確認的設計 | 適合本站採用的做法 |
| --- | --- | --- |
| [Zotero](https://github.com/zotero/zotero)；[官方入門](https://www.zotero.org/support/quick_start_guide) | 文件沿著資料收藏、整理、引用與分享說明；文獻、附件與 collections 有不同角色；collections 可指向同一筆文獻。 | README 用「搜尋 → 檢查來源 → 收藏 → 引用」四步導覽。詳情頁保留 DOI／PMID 與書目來源；收藏以唯一文獻識別碼連結，避免同一篇被多個分類拆開。不要把收藏、已下載全文、可再散布全文混成同一狀態。 |
| [JabRef](https://github.com/JabRef/jabref)；[貢獻指南](https://github.com/JabRef/jabref/blob/main/CONTRIBUTING.md) | README 將功能分成 Collect／Organize／Cite；明列識別碼補書目、去重、讀過狀態，以及使用文件、bug 回報與貢獻入口。 | 用實際 BibTeX 匯出範例展示用途；為「錯誤文獻配對」「遺漏同義詞」「來源連結失效」分別設回報欄位。讀過狀態與 metadata 缺漏應明確可見。 |
| [Papis](https://github.com/papis/papis)；[資料結構](https://papis.readthedocs.io/en/latest/database_structure.html) | 每筆資料用可讀的 YAML 保存；README 提供從 DOI 加入、開啟、搜尋、匯入／匯出的短命令流程。 | 文獻庫備份提供帶 schema version 的可讀 JSON，另有 BibTeX；文件解釋資料只在此瀏覽器、備份怎麼恢復、跨裝置如何搬移。沒有同步服務時不要寫「自動同步」或「離線 app」。 |
| [PaperQA](https://github.com/Future-House/paper-qa) | README 展示附文內引用的回答、來源 metadata、全文檢索與可調模型設定；也明列預設依賴及版本遷移。 | 借鏡來源可追溯與可重現範例：每個 AI 中文摘要旁保留原文入口、來源與取得狀態。若將來做問答，先建可核對答案的評測集；目前不應把索引宣稱為已驗證的醫療 RAG。 |
| [ASReview LAB](https://github.com/asreview/asreview)；[官方文件](https://asreview.readthedocs.io/en/latest/) | 清楚呈現匯入、人工標記、進度與匯出的工作流程；提供模擬驗證、方法論引用、文件與 demo 入口。 | 說明本站「收錄、分類、摘要」各自如何產生、哪些未經人工核對。搜尋回歸可公開一組 query／預期文獻／錯配案例，讓別人能改進。本站目前不是完整系統性回顧篩選工具，不借用它的驗證或效能宣稱。 |
| [MiniSearch](https://github.com/lucaong/minisearch) | README 首段即提供 demo、API 文件；支援瀏覽器記憶體索引、欄位權重、前綴、模糊搜尋及建議詞，並說明資料須能放入本機記憶體。 | 先公開本站的三個 demo query 與搜尋規則。本輪同義詞／排序修正可沿用目前程式；日後只有在實測需求出現時才評估替換引擎。若試用 MiniSearch，需另外驗證中文分詞、DOI 精確比對與 PRP／PRF 邊界。 |
| [Open WebUI](https://github.com/open-webui/open-webui)；[授權原文](https://github.com/open-webui/open-webui/blob/main/LICENSE) | README 將文件、功能、不同安裝路徑與資料持久化要求寫清楚，區分本機與遠端模型連線。 | 借鏡「公開 demo」「本機靜態索引」「私人工作台部署」三條上手路徑；第一條不要求模型憑證。只參考呈現與部署說明，不直接複製其授權或品牌規則。 |

閱讀方法：以 repo 當日可見 README／官方文件為準，不用 stars 數量評斷品質，也不把文件宣稱當成本站實測結果。ASReview 的 README 與部分文件頁版本標示不同，本報告只採用共同可確認的流程，沒有依其版本號給安裝建議。

## 此 repo 的發布基礎與缺口

以下缺口是本次查核時的快照；同一工作樹的文件改善正平行進行。發布前應依最終 README、文件與 GitHub 主分支重新核對，不把已修正項目繼續列為未完成。

GitHub API 當日確認：[keanu77/review.sportsmedicine](https://github.com/keanu77/review.sportsmedicine) 已是 **public**，預設分支 `main`，MIT，homepage 已指向正式站，Issues 已啟用、Discussions 未啟用。目前沒有 GitHub releases。既有 topics 為 `clinical-guidelines`、`evidence-based-medicine`、`meta-analysis`、`react`、`rehabilitation`、`sports-medicine`、`systematic-review`、`typescript`、`vite`。`package.json` 的 `private: true` 是套件設定，不表示 GitHub repo 是 private。

| 優先度 | 查核所得 | 建議交付與驗收 |
| --- | --- | --- |
| P0 | 已有 `LICENSE`、`SECURITY.md`、`CITATION.cff`；本輪改動仍在獨立分支整合。 | 保留 MIT 程式碼授權；發布使用最終 commit 的 CI、建置與正式站可操作證據。此報告未驗收私人服務或線上部署。 |
| P0 | README 的英文介紹後很快進入私人 workbench；另有 `- # 運動醫學 Review 索引` 排版錯誤。 | 首屏只放定位、公開 demo、實際截圖與四步流程；私人工作台移至獨立章節／文件，明示正式站只供擁有者登入，公開原始碼不附部署帳號或權限。 |
| P0 | README 仍有「資料沒有作者欄位」「免費全文只是網域推測」等未反映新書目／來源狀態的描述；固定篇數易過期。 | 以最終實作更新 README。將總數與覆蓋率連到有日期的資料健康／維護紀錄；AI 摘要與來源摘要分開，已確認來源連結與推測免費全文分開。 |
| P0 | README 的資料授權段將第三方 metadata、摘要放在同一段，未逐一列出資料檔、上游及原文內容權利。 | 增加資料來源／再利用說明，列書目事實、來源摘要、AI 摘要、標籤與期刊指標各自的來源及限制。不要將程式碼 MIT 延伸為所有論文內容均可再散布。 |
| P1 | GitHub community profile 與本機檔案確認缺少 `CONTRIBUTING`、`CODE_OF_CONDUCT`、Issue／PR templates；不是缺 license。 | 最小貢獻指南列 Node 版本、`npm ci`、公開模式啟動、相關測試；Issue 模板收 query、預期 DOI、實際結果與瀏覽器。維護者願意承擔社群處理流程時再採用行為準則。 |
| P1 | README 沒有應用截圖或示範影片；已有網站 OG 圖，但未查核 GitHub social preview 設定。 | 製作桌機與手機各一張真實截圖及 20–30 秒 demo；GitHub social preview 可另準備 1280×640、低於 1 MB 的圖片並在設定中核對，不能假設網站 OG 會自動套用。 |
| P1 | 公開索引依賴已產出的 JSON；完整上游抓取管線不在此 repo。 | 保留可在無 API key 下跑的靜態 demo，寫清楚「可重現前端與測試」「不能在此重建完整上游資料」；提供小型合成測試資料與 schema，避免新貢獻者先卡在私人管線。 |
| P1 | 無正式 release。 | 在功能與文件完成後建立一次有版本／commit、demo、已知限制、測試證據的 release；不要用尚未部署的新功能截圖代表目前正式站。更新 `CITATION.cff` 的版本／日期時以實際 release 為準。 |
| P2 | 既有 topics 已涵蓋臨床與技術；缺乏能直接領取的小任務。 | 可補 `literature-search`、`bibliography`、`traditional-chinese`；建立 3–5 個有驗收案例的問題，例如同義詞 fixture、BibTeX round-trip、鍵盤／行動版缺陷。先把現有 Issues 管好，無需急著另開 Discussions。 |

GitHub 官方說明支持用 README 交代用途、上手與支援入口，以及透過 topics 改善分類；這些是清楚呈現專案的工具，不能視為 stars 成長的保證。[README 文件](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)、[topics 文件](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)、[social preview 文件](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)、[行為準則文件](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-code-of-conduct-to-your-project)。

## 資料與公開／私人邊界

- **程式碼與論文內容分開授權。** Crossref 說明大部分書目 metadata 是可再利用的事實資料，而 abstracts 保留出版者／作者著作權；因此目前 README 不宜把所有 metadata 一概寫成相同權利狀態。[Crossref metadata licensing](https://www.crossref.org/documentation/retrieve-metadata/)
- **免費可讀不等於取得再散布許可。** PMC 的 OA 子集合有逐篇不同授權；其他 PMC 全文不一定允許相同用途。NLM 也沒有替 PubMed abstracts 授予統一再散布權。本次查核沒有替個別資料檔完成權利審查，不能宣稱整份 corpus 已獲開放授權。[PMC OA subset](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/)、[NCBI usage policies](https://www.ncbi.nlm.nih.gov/home/about/policies/)、[Europe PMC copyright help](https://europepmc.org/help)
- **展示 public app，不展示 owner 的帳號與任務。** `src/App.tsx` 把工作台作為獨立路由，`SECURITY.md` 說明私人 API／worker 權限；`.gitignore` 排除 env、worker state、outputs 與交班資料。這是已有設計與文件證據，不是此報告重新完成安全稽核。展示使用公開書目或合成資料，不把私人全文、工作任務與憑證放入 demo。
- **可公開部署架構，範例應可移植。** `wrangler.jsonc` 有現行部署專用設定；提供範例部署說明時應使用明確占位與自行建立資源的步驟，不將正式環境設定當成任何 clone 都能直接使用的預設。此報告不複製該設定值。
- **不要以臨床驗證作為宣傳語。** AI 摘要、分類與閱讀工具不構成臨床審查；目前 PRP 標籤仍涵蓋部分 PRF／其他領域文獻，來源分類修正可作為公開貢獻題目。這種已知限制應能在資料回報路徑找到。

## 可直接使用的英文定位

以下新版文字待本輪功能正式部署、截圖及連結驗收後使用。

**GitHub About**

> Search and read sports medicine reviews with Chinese–English clinical terms, source-linked metadata, local reading lists, and citation exports.

**README opening**

> Sports Medicine Review Index helps clinicians and researchers find reviews, meta-analyses, and guidelines in sports medicine and rehabilitation.
>
> Search with common Chinese or English clinical terms, inspect the original source, save papers in your browser, and export citations. The interface is in Traditional Chinese. AI-generated summaries are labeled and should be checked against the original publication.
>
> Try the public app: https://review.sportsmedicine.tw/
>
> The public index requires no account. This repository also contains an owner-operated private workbench; access to that hosted service is not included. The application code is MIT-licensed. Third-party article content retains its own rights and license terms.

**Demo 腳本**

1. 搜尋 `冰凍肩`，再以 `frozen shoulder` 示範同一組結果。
2. 搜尋 `PRP`，說明是相關度排序、仍可改成年份排序。
3. 打開一篇詳情，指出來源書目與摘要狀態，回到原搜尋條件。
4. 收藏、標記已讀、匯出引用／備份。只有本輪實際驗收成功的操作才放入錄影。

## 發布順序與草稿

**第一步：GitHub release 與現有專業讀者回饋。** 先用一條完整 demo 路徑邀請試用，提供可點擊 repo／站台與明確回報範例。回覆得到的查詢失敗、來源錯配與操作困難，再擴大發表；不以星數交換功能或回覆。

Release title:

> Search and reading workflow improvements

Release body:

> This update improves the path from a clinical question to a saved, citable paper.
>
> - Chinese and English clinical synonyms now share search results.
> - Generic PRP searches prioritize explicit sports and musculoskeletal context; other papers remain searchable.
> - Paper details preserve the path back to the search, with clearer source and full-text access information.
> - Reading lists support saved papers, reading status, citation export, and portable backups.
>
> Try the public app: https://review.sportsmedicine.tw/
>
> Known boundaries: coverage is selective; AI summaries and automatic tags can be wrong; browser data needs a backup; article reuse depends on the original license. Please report a search problem with the query and the DOI of the paper you expected to find.

**第二步：適合的研究工具／前端社群。** 使用下方短稿，依社群當時規則發表；這次沒有代為張貼，也未查核個別論壇的最新投稿規則。

> I built a browser-based literature index for sports medicine and rehabilitation. It connects Chinese and English clinical search terms, keeps source metadata visible, and lets readers save papers and export citations.
>
> The interface is in Traditional Chinese, and the code is available under MIT. I would especially value feedback on missing search synonyms, incorrect paper matches, and the reading workflow.
>
> Demo: https://review.sportsmedicine.tw/
> Code: https://github.com/keanu77/review.sportsmedicine
>
> If it is useful to you, a GitHub star is welcome. Specific bug reports and reproducible examples are equally helpful.

**第三步：可選的 Show HN。** 以可操作 app 為主，讓訪客直接搜尋與保存文獻；純連結清單不符合 Show HN 的主旨。正式公開試用就緒後才提交，維護者需能回答問題，不組織投票。這些限制來自 [Show HN 官方規則](https://news.ycombinator.com/showhn.html)。

Suggested title:

> Show HN: Search and save sports medicine reviews in your browser

Suggested first comment:

> I work with sports medicine literature and built this to make the path from a clinical term to an original review easier to follow. Readers often search in Chinese while paper titles are in English, so the search includes explicit clinical synonym groups and regression cases for terms such as frozen shoulder and PRP.
>
> The public app runs without a sign-up. It includes source links, citations, and a browser reading list. The upstream catalog-generation pipeline is separate from this repository, and this is a selective index rather than a comprehensive systematic-review service.
>
> I would appreciate examples where a query finds the wrong paper or misses one you expected. The code and tests are here: https://github.com/keanu77/review.sportsmedicine

**發布後評估。** 在一週與一個月分別整理：有效錯誤回報、首次外部 PR、使用者是否完成搜尋到來源／收藏／引用的任務，再記錄 stars／forks 作為附帶訊號。若要新增遙測，需另定資料收集範圍；此報告沒有部署追蹤，也沒有用既有曝光推估轉換率。
