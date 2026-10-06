# Multy 網頁應用程式與 ESP32 韌體實作計畫

## 1. 目標與系統架構

將現有 `02-Multy` 網頁應用程式擴充為可操作六組硬體通訊介面的工具，並在 `02-Multy/firmware/` 建立對應的 PlatformIO Arduino 韌體專案。

| 使用端 | 連線方式 | 實作路徑 |
|---|---|---|
| PC Chrome／Edge | 開發板 USB-to-serial 接口 | Web Serial → UART0 |
| PC Chrome／Edge | BLE | Web Bluetooth → Multy 自訂 GATT 服務 |
| iPhone Safari | 透過 Beacio 使用 BLE | 同一套 Web Bluetooth 程式 → 同一個 GATT 服務 |

Node.js 伺服器只負責提供網頁；控制命令與資料直接在瀏覽器和 ESP32 之間傳輸，不需要 ESP32 Wi-Fi。

已確認的範圍：

- 兩組獨立硬體 UART，持續接收資料。
- 兩組硬體 I2C 主控端。
- 兩組硬體 SPI 主控端。
- 提供基本原始資料讀寫，不加入暫存器讀取輔助功能。
- USB 與 BLE 共用單一控制權，同一時間只允許一個使用端操作。
- 使用 PC 上的本機 HTTPS 伺服器供 iPhone 存取。
- 本版不包含原生 USB CDC、I2C／SPI 從屬模式、被動監聽或 PWA 安裝功能。
- 保留 `01-Test`，不修改既有心率 BLE 測試韌體。
- 後續說明、文件與回覆一律使用繁體中文；網頁介面本版維持現有英文。

## 2. ESP32 韌體與硬體介面

### 建置設定

以 `01-Test/platformio.ini` 為參考，建立獨立韌體專案：

- 開發板：`esp32-s3-devkitc-1`。
- 框架：Arduino。
- Flash：16 MB；PSRAM：8 MB OPI。
- 記憶體模式：`qio_opi`。
- 分割表：`default_16MB.csv`。
- 定義 `BOARD_HAS_PSRAM`。
- 不啟用原生 USB CDC。
- 將 `espressif32` 固定為本機已安裝的 `7.1.3`。
- 使用 ArduinoJson `7.4.3` 解析命令。
- 使用框架內建 BLE 實作，不額外引入另一套 BLE 協定堆疊。

韌體分成傳輸層、協定與控制權管理、硬體匯流排三個部分。BLE 回呼只將接收資料加入佇列，不直接執行硬體交易。

### 固定腳位配置

| 網頁介面 | 硬體控制器 | GPIO 配置 |
|---|---|---|
| UART1 | UART1 | TX 17、RX 18 |
| UART2 | UART2 | TX 15、RX 16 |
| I2C1 | I2C0 | SDA 4、SCL 5 |
| I2C2 | I2C1 | SDA 6、SCL 7 |
| SPI1 | SPI2／Arduino FSPI | SCK 12、MOSI 11、MISO 13、CS 10 |
| SPI2 | SPI3／Arduino HSPI | SCK 8、MOSI 9、MISO 21、CS 14 |

GPIO43／44 保留給 UART0 與 USB-to-serial 橋接器；GPIO19／20 保留給原生 USB。

ESP32-S3 的 SPI0／SPI1 用於 Flash／PSRAM，SPI2／SPI3 為通用 SPI 控制器。因此保留表中的兩組獨立硬體控制器與腳位，不將兩組 SPI 共用 SPI3。GPIO Matrix 負責硬體訊號路由，不會增加控制器數量；GPIO10～13 不因 N16R8 的 OPI PSRAM 而被占用。參考 [Espressif SPI 文件](https://docs.espressif.com/projects/esp-idf/en/v5.0.1/esp32s3/api-reference/peripherals/spi_master.html)。

全部使用 `HardwareSerial`、`TwoWire` 與 `SPIClass`，明確指定腳位，不使用軟體模擬通訊。

接線採 3.3 V 邏輯並共地。文件需說明 I2C 外接上拉電阻至 3.3 V。SPI CS 為低電位有效，每次交易結束後恢復高電位。

### 各介面操作定義

#### UART

- 預設：115200 baud、8 資料位元、無同位元檢查、1 停止位元。
- Baud 選項：9600、19200、38400、57600、115200、230400。
- 資料位元：5／6／7／8。
- 同位元檢查：None／Even／Odd。
- 停止位元：1／2。
- Send 原樣傳送輸入資料，不自動附加 CR／LF。
- 傳送成功代表 ESP32 UART 驅動已接受資料，不代表目標裝置已回覆。
- 接收資料透過非同步事件更新對應 UART 面板。
- 任何 UART 設定變更後自動套用，顯示套用狀態；失敗時回復已知設定。

UART 選項依照 [Arduino ESP32 硬體串列 API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/serial.html)。

#### I2C

- 預設：位址 `0x3C`、時脈 400 kHz、讀取長度 1 byte。
- 位址輸入接受一般 7-bit 目標位址 `0x08`～`0x77`。
- 時脈選項：100／400 kHz。
- Write 傳送輸入資料，最後產生 STOP。
- Read 讀取指定長度，最後產生 STOP，不使用傳送欄位內容。
- 每次讀寫長度：1～256 bytes；同步調整兩個 `TwoWire` 緩衝區。
- 匯流排逾時為 100 ms，分別回報 NACK、逾時與讀取長度不足。
- 分開按 Write 與 Read 代表兩次獨立交易，不會在兩次操作之間產生 repeated START。

本版維持基本原始操作。需 repeated START 的裝置不列入本版基本操作相容性承諾；未來可新增選用的 `writeBeforeRead` 與合併交易，但本版不加入此欄位或 UI。

#### I2C 故障恢復

- 使用 `setTimeOut(100)` 設定交易逾時。NACK 不自動觸發 bus-clear；逾時後才檢查匯流排狀態。
- 由匯流排工作程序暫停該通道操作，使用 `TwoWire.end()` 釋放驅動，恢復後以原腳位、緩衝區大小、時脈及逾時設定重新初始化。已安裝框架沒有 `Wire.reconnect()`，不得使用不存在的 API。
- 若 SCL 可釋放為高電位但 SDA 持續低電位，以開漏方式最多送出九個 SCL 脈衝，再嘗試產生 STOP。高電位透過釋放腳位及外接上拉形成，不主動推挽拉高。
- 每次等待 SCL 拉高最多 1 ms，整個 GPIO bus-clear 嘗試最多 20 ms；遇到 SCL 持續低電位即停止，不無限等待或反覆恢復。
- 每次失敗交易最多自動恢復一次，不重送原本讀寫命令。成功恢復仍回報原交易逾時，並附上恢復狀態。
- 若線路仍卡低，回報 `I2C_BUS_STUCK` 並封鎖該通道交易。使用者排除接線問題後，可按該卡片的 Recover bus 按鈕執行 `i2c.recover`，再次進行一次有界限的恢復；另一組 I2C 不受影響。
- bus-clear 不能修復實體短路，也不保證將外部裝置還原至交易前狀態。九個恢復時脈屬於故障清理，正常 I2C 交易仍使用硬體控制器。

恢復流程參考 [NXP I2C bus-clear 規範](https://cache.nxp.com/docs/en/user-guide/UM10204.pdf)。

#### SPI

- 預設：1 MHz、Mode 0、MSB first、讀取長度 1 byte、dummy byte 為 `00`。
- 時脈選項：100 kHz、500 kHz、1 MHz、4 MHz、8 MHz。
- 模式：0／1／2／3。
- Write 以全雙工方式傳送輸入資料，並顯示同時收到的所有資料。
- Read 重複傳送 dummy byte，產生指定數量的時脈並顯示收到的資料。
- 每次資料長度：1～256 bytes。
- 整次操作期間 CS 維持低電位，完成後恢復高電位。
- 每次按鈕操作都是獨立交易，不跨操作維持 CS。

### 排程與緩衝區

- UART 以預設值初始化；I2C／SPI 收到命令後才執行交易。
- 使用單一命令工作程序，依 FIFO 順序處理，最多容納八個待處理命令。
- UART 接收處理獨立於匯流排交易。
- 每組 UART 使用 4 KiB 接收緩衝區；每批最多送出 128 bytes，累積滿批或經過 20 ms 即送出。
- 傳輸層待送資料總量限制為 16 KiB。
- 命令回覆優先於尚未開始傳送的 UART 資料事件；超載時只丟棄尚未開始傳送的完整 UART 訊息，並回報遺失 byte 計數。已開始傳送的 JSON 必須完整送完，不能丟棄尾段或插入其他訊息。
- 不保證透過固定速率 USB-serial 或 BLE 進行無遺失的持續高速擷取。

## 3. 共用通訊協定與連線管理

### 訊息格式

協定版本為 1，USB-serial 與 BLE 都使用 UTF-8、以換行分隔的 JSON。

目標裝置資料採大寫十六進位字串，不包含空格。每個編碼後的訊息最多 2,048 bytes，包含結尾換行。

解析器需支援：

- 一個訊息分多次收到。
- 一次收到多個訊息。
- 超長訊息丟棄至下一個換行後重新同步。
- 收到結尾換行後才解析完整 JSON，不把傳輸分段直接交給 JSON 解析器。本版不加入 `more`，因 UART 已採小批次事件、單次匯流排操作最多 256 bytes；傳輸分段與多訊息串流是不同層次。

命令範例：

```json
{"v":1,"id":42,"op":"i2c.read","channel":1,"settings":{"address":60,"clockHz":400000},"length":4}
```

成功回覆：

```json
{"v":1,"id":42,"ok":true,"data":"00112233","count":4}
```

錯誤回覆：

```json
{"v":1,"id":42,"ok":false,"error":{"code":"I2C_NACK","message":"Target did not acknowledge"}}
```

UART 非同步事件：

```json
{"v":1,"event":"uart.rx","channel":2,"seq":17,"data":"48656C6C6F"}
```

支援的命令：

- `hello`：取得協定版本、裝置識別、韌體版本、能力、腳位、限制、目前設定與控制權狀態。
- `session.claim`、`session.ping`、`session.release`。
- `uart.configure`、`uart.write`。
- `i2c.read`、`i2c.write`、`i2c.recover`。
- `spi.read`、`spi.write`。
- `transport.probe`：無硬體副作用，回傳測試資料的 byte 數與雜湊，用於驗證 BLE 分段，不能操作目標匯流排。

建立固定錯誤代碼，涵蓋無效命令／設定、不支援的協定版本、控制權被占用、佇列已滿、I2C 錯誤（含 `I2C_BUS_STUCK`）、驅動錯誤與傳輸緩衝區溢位。

每個命令只產生一次最終回覆。瀏覽器等待回覆的逾時為 10 秒。逾時或重新連線後不得自動重送硬體操作，避免同一筆資料被寫入兩次。

### USB-serial

- UART0 固定使用 **115200、8N1**，不受 UART1／2 設定影響。
- 實作持續讀取與依序寫入。
- 完成 `hello` 與控制權取得後，才顯示 Connected。
- 忽略不是有效協定訊息的開機輸出。
- 韌體初始化後，UART0 只傳輸協定訊息；診斷資訊以結構化事件輸出。
- 斷線時取消讀取、釋放讀寫鎖定、關閉連接埠，並結束所有等待中的命令。

### BLE

廣播名稱使用 `Multy-ESP32S3` 加上穩定裝置識別後綴。

固定自訂 UUID：

| 項目 | UUID | 功能 |
|---|---|---|
| Service | `6d756c74-7900-4000-8000-000000000001` | Multy 服務 |
| Command characteristic | `6d756c74-7900-4000-8000-000000000002` | Write with response |
| Output characteristic | `6d756c74-7900-4000-8000-000000000003` | Notify |

先訂閱輸出通知，再傳送 `hello`。

**廣播與裝置發現**

- 明確呼叫 `addServiceUUID()`，將上述 128-bit 服務 UUID 放入主要廣播資料；完整裝置名稱放 scan response，避免超過傳統廣播每份資料 31 bytes 的上限。
- 網頁使用相同服務 UUID 呼叫 `requestDevice()` 進行篩選，驗證實際廣播內容與 iPhone 的搜尋結果。
- 第一階段直接驗證 Multy 自訂服務，不暫時改用不符合裝置功能的標準服務。既有 `01-Test` 可獨立協助排查 Beacio 環境。
- 區分找不到廣播裝置與連線後 GATT 快取過期。版本 1 固定服務結構；未來改變 GATT 結構時需另訂快取失效策略，不以任意改 MAC 作為常態處理方式。

**分段大小與 MTU**

- 握手先使用 20-byte 分段；ESP32 設定本機 ATT MTU 上限為 247，從 MTU 事件及 `getPeerMTU()` 取得實際協商值，未協商時按 MTU 23 處理。
- 標準 Web Bluetooth 沒有網頁端 MTU 查詢或要求協商 API，不假設 iOS 一定會協商到特定值。參考 [Web Bluetooth 規格](https://webbluetoothcg.github.io/web-bluetooth/#bluetoothremotegattserver)。
- BLE `hello` 回報 `ble.mtu`、`ble.maxChunkBytes` 與 `ble.chunkBytes`；應用分段上限為 244 bytes，候選大小為 `min(實際 MTU - 3, 244)`。協商值變更後，網頁透過下一次 `hello` 重新取得資訊，並只在完整訊息邊界切換分段大小。
- 大分段啟用前，以 `transport.probe` 驗證完整資料往返；在候選大小以下依序測試 64、128 與候選大小（去除重複值），採用最大成功值。命令參數包含 `chunkBytes` 及已知內容的 `data`，回覆包含接收 byte 數與 SHA-256；韌體以測試中的大小送出回覆，網頁比對內容與雜湊。
- 測試失敗不執行任何目標操作。若產生半包、逾時或 GATT 錯誤，結束該連線並清除解析器，重新由使用者連線；該頁面後續對此裝置使用 20-byte 相容模式，不在同一個受損串流中盲目重試。
- 通知大小不得超過當下 MTU - 3；韌體依實際 MTU 自動縮小通知分段。瀏覽器寫入限制需以 PC 與 Beacio 實測確認，不能只根據 ESP32 的 MTU 推定。

**傳輸流量控制**

- 網頁依序呼叫 Write with response，等待上一段完成後才傳下一段，不使用大量平行 GATT 寫入。
- 韌體的 BLE 輸出每次只允許一個完整 JSON 訊息等待應用層確認；每個輸出訊息附帶該連線單調遞增的 `transportSeq`。
- 網頁完整解析訊息後立即傳送 `{"v":1,"op":"transport.ack","seq":17}`。這是傳輸控制訊息，不帶 `id`、不產生回覆、不操作硬體，亦不需要取得控制權。
- `transport.ack` 與心跳由獨立控制路徑處理，不排在匯流排操作後方；網頁寫入佇列在完整訊息邊界優先傳送 ACK 與心跳。通知 ACK 不等待 UI 渲染或使用者操作。
- 完整訊息送完後等待 ACK 最多 10 秒；逾時或通知送出錯誤即結束 BLE 工作階段，清除半包與待送資料，不重播已執行命令或已送出訊息。
- UART 資料依有界限的佇列及遺失計數處理，慢速使用端不能讓待送資料無限制累積。ACK 只確認訊息接收，不表示外部目標裝置已接受資料。

PC 與 iPhone 共用標準 Web Bluetooth API。Beacio 文件提供特徵值寫入與訂閱能力，但必須先以實際 iPhone 驗證自訂服務。參考 [Beacio 文件](https://beacio.com/docs)。

使用開發板穩定 BLE 識別，不複製心率測試韌體的隨機公開 MAC 機制。

### 單一控制權

- 連線成功不代表取得控制權；需完成 `session.claim`。
- 第一個成功取得控制權的使用端控制全部六組介面。
- 其他使用端可以連線並讀取 `hello`，但申請控制權或操作硬體時收到 `DEVICE_BUSY`。
- UART 資料事件只送給目前控制端。
- 控制端每五秒傳送心跳；20 秒未收到心跳即釋放控制權。
- 正常斷線立即釋放；BLE 斷線也立即釋放。USB 突然拔除則依租期逾時處理。
- 已套用設定保留至 ESP32 重開機。
- 新控制端取得控制權時，清除待送 UART 資料與計數，再回報目前設定。
- 重連後重新讀取設定並申請控制權，不自動套用瀏覽器保留的舊設定。

### 控制權撤銷與硬體清理

- 每次取得控制權產生新的世代編號；命令入列時記錄來源連線與世代，執行前重新驗證。舊世代的待處理命令不得在新控制端取得權限後執行。
- 釋放、斷線或租期到期時立即撤銷操作授權，取消尚未開始的命令。連線仍存在時回覆 `SESSION_ENDED`，已斷線時直接清除。
- 已開始的匯流排交易由原工作程序完成或依逾時結束，再進行清理；不得由 BLE 回呼或心跳程序同時操作 CS 或重設匯流排。
- SPI 在所有成功、錯誤與撤銷出口確保 CS 回到 HIGH。I2C 若逾時，依上述恢復流程處理。
- 清除舊工作階段的 UART RX、尚未開始提交給驅動的 TX 命令，以及待送事件。已提交給 UART 驅動或已送上線路的資料不能保證撤回；不將 `flush()` 當成通用的丟棄 TX 操作。
- 新控制端需等待硬體清理完成，期間 `session.claim` 回覆 `DEVICE_BUSY`；不得先取得權限再與舊交易並行。
- 20 秒租期用於判定失聯，不是 SPI CS 的保持時間。每次硬體交易本身需有界限，且與租期監測獨立。

## 4. 網頁介面與本機 HTTPS

### 擴充既有 UI

保留參考圖片與現有介面行為：

- 明亮／深色主題。
- PC 六張卡片與手機協定、介面編號分頁。
- 最大化／還原、Clear、Copy、多行輸入與快捷鍵。
- 六組介面各自保存設定與資料。

新增或調整：

- 每張卡片顯示實際 GPIO。
- UART 改用有效設定，變更後自動套用並顯示狀態；一般卡片 TX／RX 每列 8 bytes，最大化時每列 32 bytes，HEX 靠左、ASCII 靠右，不可列印字元顯示 `.`。I2C 三個設定與 SPI 四個設定各排在同一列。
- I2C 位址可輸入，加入 Read length。
- I2C 匯流排卡住時顯示故障狀態與 Recover bus 按鈕，不自動重送失敗操作。
- SPI 加入 Read length 與 Dummy byte。
- PC 可選 USB-serial 或 BLE；iPhone 只顯示 BLE。
- 顯示裝置識別、韌體版本、控制權與連線狀態。
- 各卡片顯示操作錯誤及資料長度。

正式操作不顯示模擬回覆或預填接收資料；模擬傳輸器只用於自動測試。

接收資料採累加方式，不覆蓋前一次結果：

- 每個通道最多保留 64 KiB。
- 超過上限時移除最舊資料並顯示截斷計數。
- 批次更新畫面，只渲染近期資料。
- Copy 複製全部仍保留的資料。
- Clear 只清除瀏覽器顯示資料，不改變硬體狀態。

連線狀態包含 Disconnected、Connecting、Handshaking、Connected、Busy 與 Error。取得控制權前停用硬體操作；斷線後保留資料，並標示資料屬於已結束的連線。

### 本機 HTTPS

現有 Node.js 伺服器加入可選 TLS：

- `TLS_CERT_FILE` 與 `TLS_KEY_FILE` 必須一起提供。
- HTTPS 預設使用 3443。
- 未設定 TLS 時，保留 localhost HTTP 3000。
- 預設只監聽 localhost；LAN 存取需明確設定 `HOST=0.0.0.0`。
- 憑證與私鑰放在公開目錄之外，並將本機憑證存放位置加入 Git 忽略規則。
- 保留既有路徑限制及安全標頭。

文件提供以下設定步驟：

- 使用本機 CA 工具建立憑證。
- 憑證包含 PC LAN IP／主機名稱。
- iPhone 安裝 CA 並啟用完整信任。
- Windows 防火牆允許連線。
- 啟用 Beacio Safari 擴充功能及網站權限。

提供 `scripts/setup-https.ps1`，使用已安裝的 mkcert 建立本機測試憑證：

- 接受明確的 LAN IP／主機名稱參數；未指定時列出可用 IPv4 位址供選擇，避免自動選到 VPN 或虛擬網卡。
- 檢查 mkcert 是否存在，缺少時顯示安裝說明，不自動安裝工具。使用 mkcert 建立／安裝本機 CA，再產生包含 localhost、127.0.0.1、指定 IP／主機名稱的憑證。
- 輸出至專案的 `certs/` 目錄，位於 `public/` 之外且納入 Git 忽略；既有檔案需明確指定覆寫選項才可取代。
- 顯示可複製的 `TLS_CERT_FILE`、`TLS_KEY_FILE`、`HOST` 設定及啟動指令。
- 只提供 CA 公開憑證供 iPhone 安裝，絕不公開或複製 CA 私鑰。iPhone 的憑證安裝與完整信任需手動完成，腳本不宣稱能自動設定手機。
- LAN IP 改變時提示重新產生伺服器憑證；未更換 CA 時，不需要重新安裝手機的根憑證。

iPhone 工作流程使用 HTTPS；LAN IP 的一般 HTTP 不足以支援此流程。先驗證 Beacio 與既有 Content Security Policy 的相容性，再判斷是否需要局部調整。

## 5. 實作順序與驗收

### 第一階段：協定與相容性

- 建立協定、腳位、設定、限制及操作語意文件。
- 建立共用 JSON 測試資料與瀏覽器解析器測試。
- 完成最小韌體：`hello`、控制權與自訂 BLE 服務。
- 驗證 iPhone HTTPS＋Beacio 的自訂特徵值寫入及通知往返。
- 檢查自訂 UUID 位於主要廣播、名稱位於 scan response，並確認沒有廣播資料截斷。
- 建立 PowerShell 憑證腳本，驗證 PC 與 iPhone 的信任及 Beacio 在目前 CSP 下的注入行為。

### 第二階段：USB 與 UART

- 完成 Web Serial 訊息傳輸、UART 設定、傳送及持續接收。
- 分別測試 UART1／2 的 TX–RX 回接，再測試外部 UART 裝置。
- 確認修改 UART1／2 設定不會改變 USB-serial 連線速率。

### 第三階段：I2C 與 SPI

- 完成各兩組硬體控制器及 UI。
- I2C 使用已知裝置驗證讀寫，涵蓋不存在的位址、NACK、短讀與逾時。
- SPI 使用 MOSI–MISO 回接及已知裝置驗證。
- 使用邏輯分析儀確認時脈、模式、資料與 CS 時序。
- 確認基本 I2C Read／Write 為各自以 STOP 結束的交易。
- 模擬 SDA 卡低、SCL 卡低及恢復失敗，確認最多一次自動恢復、等待有上限，且不重送目標寫入；測試排除故障後 Recover bus 可恢復該通道。

### 第四階段：BLE、控制權與恢復

- PC BLE 與 iPhone Beacio 都需測試六組介面。
- 測試 256-byte 資料在 20-byte 相容模式與經探測驗證的大分段模式傳輸；涵蓋 MTU 23、較大 MTU 及 Beacio 不接受大分段的情況。
- 測試 PC USB 與 iPhone BLE 同時申請控制權。
- 測試釋放控制權、心跳逾時、拔線、重開機、通知中斷與重連。
- 確認不會自動重送舊命令，且資料遺失會明確回報。
- 測試 BLE ACK 延遲／遺失、慢速通知與持續 UART 流量，確認佇列有上限、只丟棄未開始傳送的完整事件，且 ACK／心跳不被硬體佇列阻塞。
- 在交易中撤銷控制權，確認舊世代命令取消、SPI CS 回到 HIGH，清理完成前新控制端無法操作。

### 第五階段：介面、文件與完整驗證

- 擴充既有 Node.js 測試，涵蓋協定解析、傳輸清理、設定、控制權及錯誤處理。
- 測試分段／合併訊息、無效 JSON、超長輸入、錯誤版本與延遲回覆。
- 測試半包不被提前解析、不交錯 JSON 訊息，以及分段探測失敗後重連至相容模式。
- 檢查桌面及 iPhone 直向／橫向的兩種主題。
- 完成韌體建置與網頁測試，分開記錄模擬測試及實體硬體測試結果。
- 文件包含接線、建置／燒錄指令、HTTPS 設定、瀏覽器需求與吞吐量限制。
- 驗證憑證腳本的缺少工具、多網卡、檔案覆寫保護及 LAN IP 變更情境；確認憑證與私鑰無法由 HTTP／HTTPS 公開路徑讀取。

**完成條件：** USB-serial 與 BLE 均可實際操作目標裝置；iPhone 可透過 Beacio 完成操作；跨傳輸方式的單一控制權正常；正式 UI 不出現模擬硬體資料。

**固定預設：** 腳位不可由 UI 修改、英文 UI、韌體設定不寫入永久儲存、十六進位輸入、每組 SPI 一個 CS／目標、以瀏覽器前景操作為驗收範圍。iPhone 背景串流與無遺失高速擷取不納入本版驗收。
