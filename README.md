# Beacio

Beacio 測試與開發專案，包含使用 Arduino 框架的 ESP32 韌體，以及使用 Node.js 的 Multy 網頁應用程式。

## 專案

- `01-Test/`（test-01）：使用 ESP32-S3-N16R8 模擬 BLE 心率與電池裝置，供 iPhone Safari 搭配 Beacio 擴充功能測試。採用 Arduino 框架，開發板設定為 `esp32-s3-devkitc-1`，配置 16 MB Flash、8 MB OPI PSRAM，序列埠監控速率為 115200 baud。
- [`02-Multy/`](02-Multy/README.md)（Multy）：自適應序列通訊網頁應用程式，提供 UART1/2、I2C1/2 與 SPI1/2 操作介面，支援 PC 與 iPhone 配置、明亮與深色主題。已加入 PlatformIO Arduino 韌體、USB-serial／BLE 真實命令、單一控制權與本機 HTTPS；完整 ESP32／iPhone 實機驗收仍待執行，PWA 尚未啟用。

`01-Test/` 使用 `platformio.ini` 設定開發板、框架、相依套件及建置選項；`02-Multy/` 的網頁使用 Node.js 與 `package.json`，沒有額外執行期套件；`02-Multy/firmware/` 的 ESP32 韌體使用 PlatformIO Arduino 框架及 ArduinoJson。

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

Multy 包含網頁與對應的 ESP32-S3 N16R8 韌體。PC 使用 USB-to-serial 或 BLE；iPhone Safari 透過 Beacio 使用 BLE。六組介面全部使用硬體控制器，UART0 主機連線固定 115200 8N1，不受 UART1／2 目標設定影響。

在儲存庫根目錄建置韌體：

```powershell
pio run --project-dir 02-Multy/firmware
```

在 `02-Multy/` 執行 `npm start`，PC 開啟 http://localhost:3000。iPhone 使用本機 HTTPS：先執行 `scripts/setup-https.ps1` 產生憑證，再依說明安裝及信任 CA、設定 TLS 與 Beacio。

完整操作請參閱 [Multy README](02-Multy/README.md)、[通訊協定](02-Multy/docs/protocol.md)與[實機驗收清單](02-Multy/docs/hardware-validation.md)。目前程式已實作並可建置；實際硬體與 iPhone 驗證需依清單執行。

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
  server.js      Node.js HTTP／HTTPS 伺服器
  public/        網頁、主題、互動程式與圖示
  pwa/           尚未啟用的 PWA 範本與說明
  test/          Node.js 測試
  firmware/      PlatformIO Arduino 韌體
  scripts/       本機 HTTPS 憑證腳本
  docs/          通訊協定與實機驗收
  Multy-*.png    明亮與深色介面參考圖
```

請將原始碼、`platformio.ini` 及專案專用函式庫納入版本控制。產生的建置檔案、下載的 PlatformIO 相依套件及本機編輯器狀態已由 `.gitignore` 排除。
