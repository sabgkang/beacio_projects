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

TLS 必須同時設定 cert 與 key，HTTPS 預設 3443；沒有 TLS 時預設 HTTP 3000。`PORT` 可覆寫，預設只監聽 localhost。Windows 防火牆需允許相應連線。

只將 `certs/iphone-rootCA.crt` 傳至 iPhone，安裝描述檔後，在「設定 → 一般 → 關於本機 → 憑證信任設定」啟用根憑證完整信任。不要傳送伺服器私鑰或 mkcert CA 私鑰。腳本不會自動設定手機。

在 Safari 啟用 Beacio 擴充功能與網站權限，開啟 `https://<PC-LAN-IP>:3443`，按 Connect 選擇 Multy。原生 Safari 沒有此 BLE 工作流程；Beacio 缺少時介面會提示。LAN IP 變更需重新產生伺服器憑證；CA 不變時不必重裝根憑證。

## 連線與錯誤處理

- 一次只允許一個控制端，兩種傳輸共用控制權；每五秒心跳，20 秒失聯釋放。
- BLE 先以 20-byte 分段握手，再以無副作用測試驗證較大分段；失敗後重連使用相容模式。每個完整通知訊息需 ACK。
- 逾時可能表示硬體操作已完成但回覆遺失；網頁結束連線，不自動重送。請先檢查目標狀態。
- I2C 逾時最多自動恢復一次，不重送原命令。線路卡住時排除接線問題，再按 Recover bus。NACK 不觸發清理。
- 持續高速 UART 可能超過 USB／BLE 吞吐量。佇列採有界限的丟棄，顯示遺失 byte 及 UART 錯誤事件；不能保證無遺失。
- 斷線保留瀏覽器紀錄並標示 Ended session；新取得控制權後開始新紀錄，重新讀取目前 UART 設定。
- PWA 尚未啟用，iPhone 背景串流不在本版驗收範圍。

## 測試與文件

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
