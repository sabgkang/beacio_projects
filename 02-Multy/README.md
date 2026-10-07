# Multy

Multy 是 ESP32-S3 N16R8 搭配網頁的 UART／I2C／SPI 通訊工具。PC 可透過 USB-to-serial 或 BLE 連線；iPhone Safari 透過 Beacio 使用 BLE。

正式網頁不提供模擬接收資料。韌體已燒錄至 COM4 的 ESP32-S3，USB 串列 hello、控制權取得、心跳及釋放測試通過。外部目標裝置及 iPhone／Beacio 的完整驗收仍需依[實機清單](docs/hardware-validation.md)執行。

## 啟動網頁

需要 Node.js 20 或更新版本。於 `02-Multy` 執行：

```powershell
npm start
```

開啟 http://localhost:3000。桌面 Chrome／Edge 可使用 Web Serial 與 Web Bluetooth。Node 只提供靜態網頁，硬體資料不經伺服器轉送。`npm run dev` 監看伺服器程式；前端修改需重新整理瀏覽器。

## 建置及燒錄韌體

於儲存庫根目錄執行：

```powershell
pio run --project-dir 02-Multy/firmware
pio run --project-dir 02-Multy/firmware --target upload
```

多個開發板連線時加入 `--upload-port COM5`，依實際連接埠調整。使用開發板的 USB-to-serial 接口，不是原生 USB 接口。本版不啟用 USB CDC。Web Serial 與 PlatformIO monitor 不可同時占用同一串列埠。

設定延續 `01-Test/platformio.ini` 的 16 MB Flash、8 MB OPI PSRAM、`qio_opi` 與 `default_16MB.csv`。固定 PlatformIO espressif32 7.1.3、ArduinoJson 7.4.3，其他硬體驅動採框架內建版本。UART0 固定 115200 8N1，與 UART1／2 的目標設定分開。

| 介面 | 腳位 |
|---|---|
| UART1 | TX17、RX18 |
| UART2 | TX15、RX16 |
| I2C1 | SDA4、SCL5 |
| I2C2 | SDA6、SCL7 |
| SPI1 | SCK12、MOSI11、MISO13、CS10 |
| SPI2 | SCK8、MOSI9、MISO21、CS14 |

全部為硬體控制器。GPIO43／44 保留給 USB-to-serial；GPIO19／20 保留給原生 USB。目標裝置使用 3.3 V 邏輯並共地，I2C 外接上拉至 3.3 V。UART 目標接線需 TX 對 RX、RX 對 TX。

## PC 連線與操作

1. 選擇 USB-serial 或 BLE，再按 Connect。
2. USB 選擇 ESP32 的橋接器連接埠；BLE 選擇 `Multy-ESP32S3-xxxxxx`。
3. 握手取得裝置識別、韌體與設定，取得控制權後才啟用操作。
4. UART 修改任何設定即自動套用；離線變更會在連線後套用，失敗時顯示錯誤並還原已知設定。一般卡片 TX／RX 每列顯示 8 bytes，最大化時每列顯示 32 bytes；HEX 靠左、ASCII 靠右，不可列印字元顯示 `.`，窄畫面可水平捲動。切換大小保留資料。Send 不附加 CR／LF。RX 持續更新，傳送成功不代表目標已回覆。
5. I2C 可輸入 7-bit 位址及 Read length；Write／Read 各自為 STOP 結束的交易，不支援 repeated START。
6. SPI Write 顯示全雙工收到的資料；Read 使用 Dummy byte 產生時脈。每次交易獨立控制 CS。
7. 斷線按 Disconnect；Busy 代表另一個使用端持有控制權，需等其釋放後再連線。

最大化 UART 的 HEX 每 8 bytes 以 ` - ` 分組（第 8／9、16／17、24／25 個 byte 之間）。分隔符只用於顯示，傳送時會移除；還原一般卡片後回到無分隔符的 8-byte 列。

每次操作 1～256 bytes，輸入為十六進位。Ctrl+Enter／Cmd+Enter 傳送，Enter 換行。Clear 只清除顯示，Copy 包含該通道全部仍保留資料。每通道最多保留 64 KiB，畫面顯示最後 1024 bytes，並顯示截斷與遺失計數。

UART：baud 9600～230400（指定選項）、資料位元 5～8、None／Even／Odd、停止位元 1／2。I2C：100／400 kHz。SPI：100 kHz、500 kHz、1／4／8 MHz，Mode 0～3，MSB first。

## iPhone 的 HTTPS 與 Beacio

PC 與 iPhone 需能透過區域網路連線。一般 LAN HTTP 不能替代 HTTPS。

先安裝 [mkcert](https://github.com/FiloSottile/mkcert)，然後在 `02-Multy` 執行：

```powershell
./scripts/setup-https.ps1 -Names 192.168.1.10
```

請改成 PC 的實際 LAN IP；也可省略 `-Names`，從腳本列出的網卡選擇。既有憑證需明確指定 `-Force` 才能覆寫。

腳本使用 mkcert 安裝本機 CA，將伺服器憑證與私鑰放在公開目錄外的 `certs/`（Git 忽略），並顯示啟動指令：

```powershell
$env:TLS_CERT_FILE = './certs/server.pem'
$env:TLS_KEY_FILE = './certs/server-key.pem'
$env:HOST = '0.0.0.0'
node server.js
```

TLS 必須同時設定 cert 與 key，HTTPS 預設 3443；沒有 TLS 時預設 HTTP 3000。`PORT` 可覆寫，預設監聽 `0.0.0.0`，可透過 localhost 或 PC 的 LAN IP 存取；`HOST` 可覆寫監聽位址。Windows 防火牆需允許相應連線。

只將 `certs/iphone-rootCA.crt` 傳至 iPhone，安裝描述檔後，在「設定 → 一般 → 關於本機 → 憑證信任設定」啟用根憑證完整信任。不要傳送伺服器私鑰或 mkcert CA 私鑰。腳本不會自動設定手機。

在 Safari 啟用 Beacio 擴充功能與網站權限，開啟 `https://<PC-LAN-IP>:3443`，按 Connect 選擇 Multy。原生 Safari 沒有此 BLE 工作流程；Beacio 缺少時介面會提示。LAN IP 變更需重新產生伺服器憑證；CA 不變時不必重裝根憑證。

Cloudflare Tunnel 對外提供 HTTPS 時也可使用該網域；Beacio 必須獲准存取該網站，且首次使用可能需要另行啟用 Bluetooth。Multy 在按 Connect 當下取得最新 Bluetooth API，避免保存較早載入的擴充功能啟動物件。狀態會區分裝置選擇、GATT 連線、服務探索、通知訂閱及握手；裝置選擇等待超過 60 秒或單一步驟 GATT 超過 15 秒會顯示錯誤，請關閉選擇視窗、重新載入 Safari 後再試。擴充功能網站權限與 Bluetooth 首次啟用是不同步驟；請依 [Beacio 文件](https://beacio.com/docs)操作。

## 連線與錯誤處理

iPhone 主頁的 **Scan** 現在只掃描 BLE 廣播：使用 `navigator.bluetooth.requestLEScan()`，列出名稱包含 `Multy`（不分大小寫）的附近裝置與 RSSI，不呼叫裝置選擇、不連線 GATT、不取得控制權。掃描 15 秒後自動停止，可按 Stop scan 提前停止；啟動 10 秒無回應會顯示錯誤。PC 的 Connect／Disconnect 與 USB-Serial、BLE 操作保持原樣。獨立掃描 API 若不可用，會直接提示，不退回 requestDevice。

Safari「要求桌面網站」模式下，iOS 也使用 Scan。掃描區顯示 `Frontend 20261007-ios-auth5 · Scan → authorize → GATT`；如果未看到此標記，先確認伺服器更新並重新載入頁面。BLE 診斷頁包含平台、觸控點數與預期主頁行為，可用來檢查裝置辨識。

收到其他 BLE 廣播但找不到 Multy，與完全收不到廣播會顯示不同提示。掃描找到 Multy 可證明此網站的廣播掃描路徑可用；零廣播本身不能證明一定是掃描故障。

掃描結果每台裝置都有 **Connect**：點選後先停止掃描，依官方 [getBluetoothAPI](https://github.com/wklm/beacio-sdk/blob/main/packages/core/src/platform.ts) 的順序，優先使用 `navigator.beacio`（需有 `__beacio` 標記與 requestDevice）；否則使用非 SDK stub 的 `navigator.bluetooth`。在按鈕手勢內，以完整名稱篩選並列出 Multy optionalServices，授權完成後才連線。實機已確認掃描物件直接 GATT 會得到 Device was not authorized，所以不再使用未授權的掃描物件連線。授權 20 秒、GATT／服務／通知各 15 秒逾時，不自動重試。

畫面保留授權 API 來源、GATT 連線、服務探索、通知訂閱、Multy 握手與結果紀錄。握手取得控制權後啟用 UART／I2C／SPI，主按鈕變成 **Disconnect**；斷線後回到 **Scan**。Busy 時不能操作匯流排，可 Disconnect 後再試。iOS 使用獨立的傳輸適配器，PC 的 transport.js 與服務篩選流程沒有修改。診斷頁另有「Beacio API 授權」用來比較官方 API 優先順序與標準 API；選擇視窗仍未出現時，複製包含 CSP 違規的診斷紀錄。未將 API 來源差異或 CSP 判定為已證實的根因。

iPhone／iPad Safari 會額外載入本機固定版本的官方 Beacio SDK 2.2.0；PC 不載入 SDK，USB-Serial 與 BLE 傳輸流程維持原樣，伺服器 CSP 也維持原設定。此整合仍需實際 iPhone 驗證。

若停在 Selecting BLE device，使用頁尾的「BLE 診斷」，或開啟 `https://gk3pro.makerkang.com/ble-diagnostics.html`。先測試「選擇所有 BLE 裝置」，再測試「只選擇 Multy 服務」，最後複製診斷紀錄。診斷只開啟選擇視窗，不連接 GATT 或取得 ESP32 控制權；紀錄包含 SDK 狀態、網站來源、API 與 CSP 資訊，可用來區分網站橋接與服務篩選問題。

- 一次只允許一個控制端，兩種傳輸共用控制權；每五秒心跳，20 秒失聯釋放。
- BLE 先以 20-byte 分段握手，再以無副作用測試驗證較大分段；失敗後重連使用相容模式。每個完整通知訊息需 ACK。
- 逾時可能表示硬體操作已完成但回覆遺失；網頁結束連線，不自動重送。請先檢查目標狀態。
- I2C 逾時最多自動恢復一次，不重送原命令。線路卡住時排除接線問題，再按 Recover bus。NACK 不觸發清理。
- 持續高速 UART 可能超過 USB／BLE 吞吐量。佇列採有界限的丟棄，顯示遺失 byte 及 UART 錯誤事件；不能保證無遺失。
- 斷線保留瀏覽器紀錄並標示 Ended session；新取得控制權後開始新紀錄，重新讀取目前 UART 設定。
- PWA 尚未啟用，iPhone 背景串流不在本版驗收範圍。

## 測試與文件

診斷頁版本 `20261007-diag8` 顯示裝置選擇倒數與「取消等待」，並在呼叫前、requestDevice 回傳時與完成／逾時時記錄狀態。選擇按鈕等待期間停用，以避免重複請求，20 秒逾時後恢復。逾時或取消後自動開啟最上層的「診斷紀錄與恢復操作」視窗，提供文字框、複製、全選與重新載入；也可按「顯示診斷紀錄」開啟。剪貼簿操作超過 1.5 秒仍未完成時，使用已全選的文字框長按並手動複製。紀錄會收集複製／重新載入按鈕上方的元素、dialog、iframe、inert 與 pointer-events 狀態，只讀取遮擋資訊，不操作或移除擴充功能的授權介面。取消僅結束網頁等待，不會撤銷擴充功能內部請求；再次測試前重新載入。如果倒數停止，紀錄是否包含「requestDevice 已回傳」可協助判斷是否卡在同步呼叫或後續 Promise。

diag8 新增「官網流程 A：標準服務」與「官網流程 B：加入 Multy UUID」；A 採用 beacio.com 實際 API 與選擇參數，B 只增加 Multy UUID。兩者都不連線 GATT，測試間請重新載入。若恢復視窗也不能操作，逾時時會嘗試自動儲存紀錄；另開 Safari 分頁，從網址列直接開啟 `https://gk3pro.makerkang.com/ble-diagnostic-report.html`。此頁不載入 SDK、不呼叫 BLE，讀取同網站、同瀏覽模式的上次本機紀錄。完整比對與判讀方式見 [Beacio 比對紀錄](docs/beacio-comparison.md)。

目前診斷版本為 `20261007-diag9`。實機 A／B 都逾時，紀錄確認 userActivation=true、navigator.beacio 已回傳 Promise，但內嵌樣式被 CSP 阻擋且 body.inert=true。更新後另開 Safari 分頁直接進入 `https://gk3pro.makerkang.com/ble-diagnostics.html?beacioStyles=1`，先測 A，重新載入同一網址後測 B。這個指定診斷網址加入 `style-src-elem 'self' 'unsafe-inline'`，只允許 style 元素；腳本、style 屬性、其他頁面與預設 CSP 維持限制。紀錄會包含測試網址與實際 CSP。若新模式成功，再依實測結果處理 iPhone 主頁；本次沒有變更主頁或韌體。

使用者已確認樣式相容模式的 A／B 都可顯示選擇清單，選 Multy 後成功返回。主頁最新版本 `20261007-ios-style10` 在載入應用程式前，讓 iPhone／iPad Safari 自動進入帶 `?beacioStyles=1` 的主頁，伺服器對該文件提供相同 style 元素相容政策；iOS 桌面網站模式也適用。正常 PC 入口不導向、不更換 Bluetooth API，維持原 CSP 與 USB／BLE 傳輸。iPhone 更新後確認版本標記，再 Scan 並點清單中的 Connect，授權時選擇相同 Multy 裝置。GATT、服務探索、通知與握手仍待主頁實機驗證，尚未因診斷頁選擇成功而判定全部連線完成。

目前主頁版本為 `20261007-ios-picker11`。iPhone Connect 改用已成功的診斷 B 相同參數：acceptAllDevices、標準服務與 Multy optionalServices，不使用名稱篩選。選擇視窗可能顯示其他裝置，請選擇掃描清單中同名 Multy；授權回傳名稱不同或缺失時不建立 GATT。只對授權回傳物件連線，不直接使用廣播物件。主頁 BLE 診斷連結也帶樣式相容參數。更新後重新載入主頁，Scan，再點一次 Connect；逾時後先重新載入，避免重疊第三方尚未完成的選擇請求。PC BLE／USB、韌體及樣式政策未改。

```powershell
npm test
# 在目前 Node 執行環境需要停用測試隔離時：
node --test --test-isolation=none
```

自動測試以測試專用週邊模擬器驗證串流、協定及傳輸行為，不等於硬體驗收。韌體建置成功也不等於已燒錄或完成實際匯流排測試。

- [計畫](plan.md)
- [協定格式、命令與 BLE ACK](docs/protocol.md)
- [本次實作驗證紀錄](docs/validation.md)
- [實體硬體驗收清單](docs/hardware-validation.md)

主要目錄：`public/` 為前端；`server.js` 為 HTTP／HTTPS 伺服器；`firmware/` 為 PlatformIO 韌體；`scripts/` 為 HTTPS 輔助腳本；`test/` 與 `test-support/` 僅供測試。
