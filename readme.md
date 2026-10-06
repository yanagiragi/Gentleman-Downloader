# Gentleman Downloader

![](https://i.imgur.com/cLk0Xwz.png)

以 Web UI 為主要入口的圖庫搜尋與下載工具。可以在瀏覽器搜尋多個來源、將結果加入 Clipboard、由伺服器批次下載，並在進度視窗中查看圖片下載、壓縮與失敗重試狀態。

## 目錄

- [支援網站](#支援網站)
- [快速開始：Web UI](#快速開始web-ui)
- [Web 使用方式](#web-使用方式)
- [環境變數](#環境變數)
- [ExHentai 設定](#exhentai-設定)
- [下載輸出](#下載輸出)
- [失敗與重試](#失敗與重試)
- [CLI 相容用法](#cli-相容用法)
- [PM2](#pm2)
- [Disclaimer](#disclaimer)
- [License](#license)

## 支援網站

| 來源 | 搜尋 | 下載 | 備註 |
| --- | :---: | :---: | --- |
| E-Hentai | ✓ | ✓ | 未設定 EX cookie 時，Web 預設顯示 EH 搜尋結果 |
| ExHentai | ✓ | ✓ | 需要專案根目錄的 `ex-cookie.json` |
| Wnacg | ✓ | ✓ | 下載來源 ZIP 後自動解壓成圖片資料夾 |
| NHentai | ✓ | ✓ |  |
| Ahri8 | ✓ | ✓ |  |

## 快速開始：Web UI

需求：Node.js 20 或更新版本。

```bash
npm install
GDW_PASSWORD='請換成自己的密碼' node www/index.js
```

接著開啟：

```text
http://localhost:3004
```

登入驗證預設開啟。若沒有設定 `GDW_PASSWORD`，預設密碼為 `pass`；請勿在對外服務中保留預設密碼。

## Web 使用方式

1. 在 `Inputs` 輸入關鍵字，按下搜尋按鈕。
2. 搜尋結果會依來源分區顯示；每個來源最多回傳前 20 筆結果。
3. 按卡片上的購物車按鈕，將圖庫加入左側 `Clipboard`。
4. 開啟左側選單：
   - `Copy List`：複製圖庫 URL。
   - `Download List`：在伺服器開始下載 Clipboard 內的圖庫。
   - `Retry Failed`：重新處理 `Storage/err.json` 中的失敗項目。
5. 下載進度視窗會顯示目前圖庫、已完成頁數、失敗數量與建立 ZIP 的狀態。下載期間再次按 `Download List` 可重新開啟進度視窗。

若要依序處理多個搜尋關鍵字，可以每行輸入一個關鍵字後按 Task 按鈕加入右側 `TaskList`，再使用右上方的上一個／下一個按鈕切換搜尋。

## 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PORT` | `3004` | Web 伺服器連接埠 |
| `GDW_PASSWORD` | `pass` | Web 登入密碼 |
| `GDW_AUTH_ENABLED` | `true` | 是否啟用登入驗證 |

專案不會自動讀取 `.env`，需透過 shell、服務管理器或 PM2 設定環境變數。

## ExHentai 設定

ExHentai 需要已登入帳號的瀏覽器 cookie。將瀏覽器匯出的 cookie 陣列存成專案根目錄的 `ex-cookie.json`：

```json
[
  {
    "name": "igneous",
    "value": "...",
    "domain": ".exhentai.org",
    "expirationDate": 1893456000
  }
]
```

檔案必須包含仍有效的下列 cookie：

- `igneous`
- `ipb_member_id`
- `ipb_session_id`
- `ipb_pass_hash`

當 `ex-cookie.json` 存在時：

- Web 搜尋會以 EX 取代 EH 作為主要搜尋來源。
- EX 縮圖會經由本機的受限代理載入，cookie 不會直接暴露給瀏覽器。
- EX cookie 只會送往 `exhentai.org`。

## 下載輸出

所有輸出都位於專案根目錄的 `Storage/`：

```text
Storage/
├── 漫畫標題/
│   ├── 1.jpg
│   ├── 2.webp
│   └── ...
├── 漫畫標題.zip
├── err.json
└── .download-index.json
```

- 資料夾預設直接使用圖庫標題，不加來源前綴。
- 只有名稱衝突時才會在新資料夾名稱附加來源識別。
- 每個完整下載的圖片資料夾都會另外建立同名 ZIP。
- Wnacg 的來源 ZIP 會先解壓，讓資料夾內容與其他爬蟲一樣直接包含圖片。
- 已存在且驗證有效的圖片會跳過；空檔或損壞的 JPEG、PNG、WebP、ZIP 會重新下載。

## 失敗與重試

下載失敗時，項目會記錄到 `Storage/err.json`，包含：

- 原始圖庫 URL 與標題
- 圖片頁碼或 archive 標記
- 當次取得的圖片 URL
- 目標檔案或解壓目錄

按 Web UI 的 `Retry Failed` 後，程式會先依原始圖庫 URL 重新解析圖片網址，再重試下載；如果圖庫暫時無法重新解析，則保留舊圖片 URL 作為備援。當資料夾已沒有待處理的錯誤且 ZIP 尚未建立時，也會補建 ZIP。

重試期間，進度視窗只顯示圖庫名稱與頁碼，不會將伺服器的完整儲存路徑暴露到網頁。

## CLI 相容用法

Web UI 是目前建議的使用方式，CLI 仍可用於腳本、自動化或除錯。

下載一個或多個圖庫：

```bash
node bin/cli.js \
  'https://e-hentai.org/g/123456/abcdef1234/' \
  'https://nhentai.net/g/123456/' \
  'https://wnacg.com/photos-index-aid-123456.html'
```

重試 `Storage/err.json`：

```bash
node bin/cli.js err.json
```

搜尋關鍵字並輸出 JSON：

```bash
node bin/search.js 'keyword' 'another keyword'
```

CLI 搜尋目前查詢 EH、NH、WNACG 與 Ahri8；需要 EX 搜尋與縮圖時請使用 Web UI。

## PM2

可複製範例設定並修改密碼：

```bash
cp www/ecosystem.example.js www/ecosystem.config.js
cd www
pm2 start ecosystem.config.js
```

## Disclaimer

本專案僅供技術研究與個人學習。使用者應自行確認下載及保存內容符合所在地法律、來源網站條款與內容授權；專案作者不擁有由本工具取得的內容。

## License

[MIT License](LICENSE) © 2019 yanagiragi
