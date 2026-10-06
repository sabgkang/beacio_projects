# Beacio

Beacio 測試與開發專案，包含使用 Arduino 框架的 ESP32 韌體，以及使用 Node.js 的 Multy 網頁應用程式。

## 專案

- `01-Test/`（test-01）：使用 ESP32-S3-N16R8 模擬 BLE 心率與電池裝置，供 iPhone Safari 搭配 Beacio 擴充功能測試。採用 Arduino 框架，開發板設定為 `esp32-s3-devkitc-1`，配置 16 MB Flash、8 MB OPI PSRAM，序列埠監控速率為 115200 baud。
- [`02-Multy/`](02-Multy/README.md)（Multy）：自適應序列通訊網頁應用程式，提供 UART1/2、I2C1/2 與 SPI1/2 操作介面，支援 PC 與 iPhone 配置、明亮與深色主題。PC 支援 Web Serial 選取及開啟序列埠；BLE 與通訊資料仍為模擬，PWA 尚未啟用。

`01-Test/` 使用 `platformio.ini` 設定開發板、框架、相依套件及建置選項；`02-Multy/` 使用 Node.js 與 `package.json`，不需要 PlatformIO 或額外的執行期相依套件。

## test-01 的背景與運作方式

`01-Test/` 源自 2026 年 10 月 2 日關於透過 Beacio 將 ESP32-S3 連接至 iPhone Safari 的對話。最初的範例是名為 `ESP32-S3-WebBLE` 的自訂 BLE 裝置，之後改為目前的 `ESP32-S3-HeartRate` 虛擬心率監測裝置，提供標準心率與電池服務。

目前 `01-Test/src/main.cpp` 提供以下服務與特徵值：

| 服務 | 服務 UUID | 特徵值 | 特徵值 UUID | 存取方式 |
| --- | --- | --- | --- | --- |
| 心率（Heart Rate） | `0x180D` | 心率量測（Heart Rate Measurement） | `0x2A37` | 通知（Notify） |
| 電池（Battery） | `0x180F` | 電池電量（Battery Level） | `0x2A19` | 讀取（Read）、通知（Notify） |

兩個服務 UUID 都加入廣播設定，並啟用掃描回應（Scan Response）。兩個特徵值都附有 `BLE2902` 描述符，供用戶端訂閱通知。

連線期間，韌體約每秒傳送一次模擬心率。初始值為 72 bpm，每次變動 1–3 bpm，達到 60 或 130 bpm 門檻時反轉變動方向，因此數值可能略微超出門檻。每筆心率封包包含兩個位元組：第一個是 `0x00` 旗標，第二個是 8 位元心率值。電池電量從 100% 開始，偶爾下降一個百分點，最低降至 1%，並在電量變動時傳送通知。這些數值皆為模擬資料，並非感測器量測結果，重新開機後會回到初始值。

偵測到斷線後，韌體等待 500 ms，再重新啟動廣播，讓裝置可再次被搜尋到。

### 裝置識別與 GATT 快取排查

對話中也加入了透過版本號管理裝置識別的機制，協助排查用戶端保留舊 GATT 快取的問題。韌體將產生的六位元組 MAC 值與 `BLE_VERSION` 儲存在 NVS 的 `ble_storage` 命名空間中，分別使用 `mac_addr` 與 `version` 作為鍵值。版本相符時沿用已儲存的 MAC，版本變更時則產生新的 MAC。

在初始化 BLE 前，程式會清除 MAC 的多播位元，並呼叫 `esp_base_mac_addr_set(myRandomMAC)`。廣播則使用 `setDeviceAddress(myRandomMAC, BLE_ADDR_TYPE_PUBLIC)` 設定。這是目前程式的實作方式：將產生的 MAC 值搭配公開位址類型（Public Address）使用。

修改 GATT 服務或特徵值結構時，可將 `01-Test/src/main.cpp` 中的 `BLE_VERSION` 加一，讓裝置在下次啟動時產生新的識別。用戶端可能需要重新選取裝置並授予權限。這個機制用於協助重新探索裝置，不保證清除快取或自動重新連線。

## 開始使用

### 01-Test 韌體

安裝 PlatformIO Core，或 Visual Studio Code 的 PlatformIO IDE 擴充功能。開啟包含 `platformio.ini` 的專案資料夾，目前為 `01-Test/`。

在儲存庫根目錄執行：

```sh
# 建置韌體
pio run --project-dir 01-Test

# 將韌體燒錄至已連接的開發板
pio run --project-dir 01-Test --target upload

# 開啟序列埠監控
pio device monitor --project-dir 01-Test
```

若同時連接多個序列埠裝置，燒錄時使用 `--upload-port` 指定連接埠，監控時使用 `--port` 指定。

## 使用 Safari 與 Beacio 測試

1. 燒錄韌體，並以 115200 baud 開啟序列埠監控。檢查啟動訊息中的已儲存或新產生 MAC，以及廣播狀態。
2. 在 iPhone 上啟用 Beacio Safari 擴充功能，並允許它存取 HTTPS 測試網站。初次測試請使用一般 Safari 分頁。
3. 從網站啟動裝置選取，選擇 `ESP32-S3-HeartRate`。對話中曾出現 Beacio App 能搜尋到裝置、Safari 卻無法搜尋到的情況；若 Safari 只顯示模擬示範裝置，請檢查擴充功能的網站權限。
4. 使用要求心率服務（`heart_rate`／`0x180D`），且將電池服務（`battery_service`／`0x180F`）納入存取要求的 Web Bluetooth 測試網頁。訂閱心率量測通知，再讀取或訂閱電池電量。僅搜尋到裝置，尚不足以確認資料通訊成功。
5. 確認心率約每秒更新一次，且可讀取電池電量。斷線後再次啟動裝置選取，檢查廣播是否恢復。

## 02-Multy 網頁應用程式

### 啟動與測試

需要 Node.js 20 或更新版本。在儲存庫根目錄執行：

```sh
cd 02-Multy
node server.js
# 或使用 npm start
```

啟動後開啟 [http://localhost:3000](http://localhost:3000)。預設僅監聽 `127.0.0.1`，可透過 `PORT` 環境變數變更連接埠。修改網頁檔案後重新整理瀏覽器；`npm run dev` 可在伺服器程式變更時自動重新啟動 Node.js。

在 `02-Multy/` 內執行測試：

```sh
npm test
# 若環境限制測試程序的啟動，可使用：
node --test --test-isolation=none
```

### iPhone 存取

PC 與 iPhone 連接同一個網路，在 `02-Multy/` 使用 PowerShell 啟動：

```powershell
$env:HOST = '0.0.0.0'
node server.js
```

在 iPhone Safari 開啟 `http://<PC 的區域網路 IP>:3000`。iPhone 只提供 BLE 連線選項；Connect 位於 BLE 右側，下方顯示狀態圓點與 Disconnected。模擬連線成功後，狀態更新且按鈕改為 Disconnect。右上角提供主題切換與重新整理圖示。複製功能需要瀏覽器允許剪貼簿存取；無法存取時會提示手動複製。

### 介面與目前範圍

- 明亮與深色主題參考 `Multy-Light.png` 與 `Multy-Dark.png`，預設跟隨系統，手動選擇會保存在本機。
- PC 顯示六張通訊卡片；中等寬度改為兩欄，窄螢幕使用 UART／I2C／SPI 分頁及介面編號切換。
- UART 的 Baud rate、Data Bits、Parity 與 Stop 可分別設定，預設為 115200、8、N、1。Data Bits 提供 8／9，Parity 提供 N／Y，Stop 提供 1／0。
- 每張卡片有最大化及還原圖示。PC 最大化後佔用六張卡片的區域；還原或按 Escape 可回到原配置，保留設定及資料。
- 傳送欄位與接收資料會換行並隨內容增加高度，最大化及還原模式皆適用。Enter 換行，Ctrl+Enter 或 Cmd+Enter 傳送。Clear 與 Copy 各自作用於所屬卡片；I2C 與 SPI 提供並排的 Read 與 Write 按鈕。
- PC 選取 USB-serial 後，Connect 會開啟瀏覽器的 Web Serial 序列埠選取視窗，並依 UART1 設定開啟選取的埠；Disconnect 關閉該埠。需要桌面版 Chrome／Edge 及 HTTPS 或 localhost。連線時 UART1 需使用 8N1；9 資料位元、0 停止位元及未指定奇偶模式的 Y 選項會顯示說明。
- **Web Serial 已可開啟真實序列埠，但 UART／I2C／SPI 硬體命令尚未實作；BLE 仍為模擬。** 開啟真實埠後會清除示範接收資料，傳送按鈕會說明缺少的整合，不會冒充硬體回應。後續需定義 Multy 韌體的命令格式、通道操作及 BLE UUID，再整合 `public/transport.js`。`01-Test` 的心率韌體尚未提供 UART／I2C／SPI 命令。
- PWA 相關範本保留於 `pwa/`，不在伺服器公開目錄中。目前沒有啟用 manifest、service worker、離線快取或安裝提示。

詳細操作與檔案說明請參閱 [`02-Multy/README.md`](02-Multy/README.md)。

## 專案目錄結構

```text
01-Test/
  platformio.ini  開發板與建置設定
  src/           應用程式原始碼
  include/       專案標頭檔
  lib/           專案專用函式庫
  test/          測試

02-Multy/
  package.json   Node.js 指令與版本需求
  server.js      Node.js HTTP 伺服器
  public/        網頁、主題、互動程式與圖示
  pwa/           尚未啟用的 PWA 範本與說明
  test/          Node.js 測試
  Multy-*.png    明亮與深色介面參考圖
```

請將原始碼、`platformio.ini` 及專案專用函式庫納入版本控制。產生的建置檔案、下載的 PlatformIO 相依套件及本機編輯器狀態已由 `.gitignore` 排除。
