# 30 篇原始來源核對紀錄

本次核對固定的 `data/kb-pilot/sources.json`，沒有擴大樣本。於 2026-11-19（臺北時間）讀取 Europe PMC 官方 REST API 的 MED core record，以 `EXT_ID:<PMID> AND SRC:MED` 查詢，每次最多四個並行請求。來源擷取的 UTC 時間為 `2026-11-18T18:32:04.675692Z` 至 `2026-11-18T18:32:59.032040Z`。

結果是 30 篇的 PMID、DOI、正規化題名全部吻合；29 篇可建立摘要層級的六欄改寫草稿，1 篇無摘要。所有草稿均為 `needs-clinical-review`，尚未完成全文方法評讀或臨床核准。完整原始摘要只暫存在 `/private/tmp/review-learning-evidence/`，不放入 Git 或公開資料。

## 交付與核對

| 資料 | 筆數 | 核對範圍 |
| --- | ---: | --- |
| `evidence-receipts.json` | 30 | 書目身分、來源網址、時間、摘要 SHA-256、數值 tokens、有無摘要 |
| `evidence-drafts.json` | 30 | 29 篇各六欄；1 篇 `missingReason` |
| `access-metadata.json` | 30 | 免費全文連結、Europe PMC OA 欄位、來源提供的授權名稱 |

六欄為研究設計、族群、介入、對照、結果及限制；每篇六欄合計 188–255 字元，採精簡繁體中文改寫，未逐字重刊原始摘要。所有阿拉伯數值均存在同篇 receipt，摘要 hash 與身分綁定一致。來源有章節時保留章節名稱，跨章節使用 `abstract:Methods; abstract:Results` 等格式；沒有 HTML 章節標籤時用 `abstract`。

草稿明示摘要資料不足的欄位包括族群 16 處、介入 2 處、對照 3 處、結果 2 處、限制 16 處。這些是欄位內資訊不足的提示次數，不代表整個欄位都沒有內容。沒有研究數、樣本、劑量、次群組、追蹤或偏差風險細節時，沒有以知識庫摘要補造。

五十肩新增的八篇候選均完成當次 PMID／DOI／題名核對，且都有摘要：`42982479`、`42770395`、`42248412`、`42631081`、`42446287`、`42340454`、`41780224`、`40273376`。這只確認固定候選來源，並不表示已寫入正式 Review 或知識庫。

## 原始來源的缺漏與疑義

- [PMID 42527106](https://europepmc.org/article/MED/42527106)：官方 core record 未提供摘要。保留缺漏說明及空字串 SHA-256，`hasAbstract=false`，不產生方法或療效內容。
- [PMID 42008192](https://europepmc.org/article/MED/42008192)：摘要的回場時間標準化差異，其信賴區間上下界格式不一致。草稿不引用該時間效應量，明示需核對原文；其餘觀察性比較保留因果限制。
- [PMID 40273376](https://europepmc.org/article/MED/40273376)：摘要將跨零的六個月疼痛信賴區間描述為顯著。草稿不採用該疼痛結論，保留其他可核對功能結果與來源疑義。
- [PMID 41107915](https://europepmc.org/article/MED/41107915)：使用獨立核對的 Wang／Yao 公開原始摘要。既有 Ethanai 錯配全文的隔離仍有效；這份草稿不來自該錯配全文或 KB 摘要。原始摘要中的模型及注射規格沒有被改寫成臨床處方。

未見顯著差異沒有被改寫成療效相等、沒有風險或確定無效。次群組與統合迴歸結果保留關聯性；只有原始摘要明示的證據確定性才以「作者報告」呈現，沒有自行推算等級。平均回場時間也沒有被改寫為個人許可門檻。

## 免費全文、OA 與授權

本次 16 篇有來源列明的免費全文 HTTPS 連結，14 篇未知；Europe PMC `isOpenAccess` 的 Y／N 各 15 篇，17 篇有來源提供的 license 字串。

`freeFullText=verified` 在本次核對的意義，是官方 `fullTextUrlList` 確實列出 `availabilityCode=OA` 或 `F` 的 HTTPS 連結，優先選 HTML。它不是已下載、打開或逐頁核對 PDF 的承諾。沒有免費連結時為 `unknown`，不等於付費；沒有因 DOI、PMCID 或期刊名稱自行生成連結。

`oaStatus` 僅忠實轉錄 Europe PMC 的 `isOpenAccess`，不應把 `no` 顯示成全球「非開放取用」或「付費」。[官方 OA 子集說明](https://dev.europepmc.org/downloads/openaccess)區分免費閱讀與其 OA 子集，並要求依各篇授權條款判定用途。具體邊界如下：

- [PMID 42282137](https://europepmc.org/article/MED/42282137) 有 `F` 免費全文連結，但 `isOpenAccess=N`，而且未提供 license。
- [PMID 41570285](https://europepmc.org/article/MED/41570285) 與 [PMID 42982479](https://europepmc.org/article/MED/42982479) 的 `isOpenAccess=N`，同時回傳 CC license。本次保留兩個原始欄位，不自行消除來源差異。
- license 只保留原始字串；不因 OA=Y 或可免費閱讀而授予重製、改作或訓練的權利。

## 指紋與數值的重現規則

Canonicalization 版本為 `htmlparser-whitespace-v1`：用 Python `HTMLParser(convert_charrefs=True)` 收集文字節點，以空格連接；再 `html.unescape`，將所有連續空白壓為單一空格並去掉首尾空白，最後對 UTF-8 位元組計算 SHA-256。不可用 `<[^>]+>` 去標籤，否則會吃掉含 `<` 的統計敘述。

```python
from html.parser import HTMLParser
import hashlib, html, re

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)

parser = Text()
parser.feed(raw_abstract or '')
parser.close()
canonical = re.sub(r'\s+', ' ', html.unescape(' '.join(parser.parts))).strip()
sha256 = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
numeric_text = re.sub(r'(?<=\d),(?=\d)', '', canonical)
numeric_tokens = sorted(set(re.findall(r'\d+(?:\.\d+)?', numeric_text)))
```

例如 `P < 0.05` 的不等號會保留；`1,326` 的 token 為 `1326`。數值 gate 只證明 token 曾出現在同篇摘要，不能證明它對應的樣本、正負號、單位、效果方向或臨床語意正確，這些仍須逐篇核對。

當次擷取、建置及核對腳本位於 `/private/tmp/review-learning-evidence/`：`fetch_sources.py`、`canonicalize.py`、`build_receipts.py`、`build_drafts.py`、`verify_artifacts.py`。`verification-result.json` 記錄當次資料檢查結果；這些暫存檔不屬於公開交付。公開建置使用版本化三份 JSON，沒有執行新的網路擷取、模型或 Actions。後續若更新來源，應重新核對、版本化 receipts 與草稿並更新試點版本，避免把舊回饋套到新證據。
