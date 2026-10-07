# 01-Test、Multy 與 beacio.com 授權比對

2026-10-07 檢查本機韌體與官網當日來源。使用者確認 01-Test 心率模擬可在同一 iPhone 的 beacio.com 正常連線；Multy 可以掃描，但要求授權仍未成功，diag7 恢復視窗也無法操作。以下區分已確認差異與尚未證實的原因。

## 韌體差異

| 項目 | 01-Test/src/main.cpp | 02-Multy/firmware/src/main.cpp |
| --- | --- | --- |
| BLE 程式庫 | Arduino BLEDevice／BLEServer | Arduino BLEDevice／BLEServer |
| 服務 | 心率 0x180D、電池 0x180F | 自訂 128-bit Multy 服務 |
| 特徵 | 心率 Notify；電池 Read／Notify | 命令 Write；輸出 Notify |
| 通知描述符 | BLE2902 | BLE2902 |
| 廣播 | 加入兩個標準服務 UUID；開啟 Scan Response | 廣播完整 Multy UUID；Scan Response 放完整名稱 |
| 位址 | NVS 儲存產生的基底 MAC，BLE_VERSION 變更時更新；初始化前設定基底並指定廣播 public address | 保留預設位址；未載入 01-Test 的自訂 NVS MAC |
| 連線參數提示 | setMinPreferred(0x06)，再 setMinPreferred(0x12) | 未設定這兩個提示 |
| MTU | 未主動設定 | 設定 247，應用層先使用 20 bytes，再探測容量 |
| BLE 配對／加密設定 | 未加入 | 未加入 |

兩份程式都沒有實作要求 PIN 或配對的 BLE security 設定。因此不能把「Device was not authorized」直接解讀為 ESP32 要求配對。通知描述符與廣播服務 UUID 在 Multy 已存在。

01-Test 的註解稱它為 random static MAC，但實際呼叫 `esp_base_mac_addr_set()` 與 `setDeviceAddress(..., BLE_ADDR_TYPE_PUBLIC)`：這是自訂基底位址並使用 public address type，不等於 BLE random-static address type。Espressif 說明 Bluetooth 位址由基底派生，因此不能假設基底值一定等於 Bluetooth 介面位址；修改 MAC 會影響裝置身分，暫不將這段直接搬進 Multy。[Espressif MAC 說明](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/misc_system_api.html#mac-address)

備份 `01-Test/src/main.cpp.01` 也使用自訂 128-bit UUID；這證明專案曾有此配置，不能證明該備份曾在目前 iPhone 成功。

## 官網實際流程與 Multy 的差異

讀取 [官網 home.js](https://beacio.com/home.js?v=b15a9749c1) 的 `startLiveScan()` 與 `connectLiveDevice()`：官網優先選擇 `navigator.beacio`，否則使用 `navigator.bluetooth`；Scan 呼叫 `requestDevice()`，並以 acceptAllDevices 與六個標準服務項目作為參數。返回的已授權物件加入清單，使用者點選後才建立 GATT。

Multy 的 Scan 呼叫 `requestLEScan()`，清單物件來自廣播事件。之後點 Connect，重新呼叫 requestDevice，使用名稱篩選與 Multy optionalServices，以授權回傳物件建立 GATT。此前直接連接廣播物件曾被拒絕，因此不再次將廣播可見當作 GATT 授權。

官網本次 HTTP 回應沒有 Content-Security-Policy 標頭；Multy 線上診斷頁仍回傳 script-src 'self' 與 style-src 'self'。官網文件指出嚴格 CSP 會改變 API 出現時間；本機 SDK 來源包含內嵌樣式，故注入介面受 CSP 影響是需要查證的候選原因。無法操作恢復視窗也可能涉及 inert、事件攔截或擴充功能狀態，尚未取得手機紀錄，不能宣布 CSP 是根因。[Beacio 文件](https://beacio.com/docs)

官網與 Multy 為不同 origin，成功存取官網不等於 Multy 已取得該裝置授權；官網文件明確描述每個來源的啟用步驟。官網目前能連 Multy、Multy 也能掃描，顯示應優先查授權橋接／頁面介面，再決定是否需要變更韌體。

## diag8 對照實作與判讀

診斷頁新增兩個按鈕，保留原本的授權測試。兩者均在原始點擊中同步呼叫 API，不執行 GATT 或匯流排操作，20 秒逾時，測試之間重新載入。

1. **官網流程 A：標準服務**：完全採用官網的 API 優先順序、acceptAllDevices 與 optionalServices 清單，沒有名稱篩選或 Multy UUID。可選擇心率裝置，也可選 Multy，但不取得 Multy 自訂服務存取權。
2. **官網流程 B：加入 Multy UUID**：只在 A 的 optionalServices 增加 Multy UUID。

若 A 也沒有視窗，問題不必有自訂 UUID 才會出現，先查 origin、CSP／介面與橋接。若 A 成功而 B 失敗，優先檢查自訂 UUID 的授權處理。若 A/B 都成功而主頁失敗，再比較 requestLEScan 後的狀態與名稱篩選。這些結果都需要實際 iPhone 驗證。

由於使用者回報 diag7 視窗仍無法操作，diag8 在逾時／取消／開啟報告時自動將文字儲存至此 origin 的 localStorage，並新增 `/ble-diagnostic-report.html`。此頁不載入 SDK、不呼叫 BLE API，使用者可另開 Safari 分頁從網址列直接進入並長按文字複製。需相同 origin、瀏覽模式及可用本機儲存；這不是上傳紀錄的服務，也不能保證避開所有擴充功能問題。

PC 主頁、transport.js、韌體與伺服器 CSP 均未修改。48 項 Node 測試通過；尚未在實際 iPhone 確認 A/B 或獨立紀錄頁效果，尚未提交或推送。

## diag8 實機紀錄與 diag9 下一步

使用者回覆 A、B 都逾時。兩次都是已啟用 navigator.beacio、userActivation=true，requestDevice 同步返回後 Promise 持續未完成。兩次各記錄兩筆 style-src-elem／inline 違規；逾時收集時尚未開啟 Multy 恢復 dialog，body 已為 inert=true，複製與重新載入按鈕未 disabled，但 elementsFromPoint 只返回 HTML。這解釋了背景按鈕不能操作，並提供樣式阻擋的實際證據。A 沒有自訂 Multy UUID 也失敗，因此自訂 UUID 不是這個現象的必要條件；該測試尚未進入服務探索，GATT 快取也不是目前優先排查方向。

diag9 以指定網址 `/ble-diagnostics.html?beacioStyles=1` 在既有 CSP 後增加 `style-src-elem 'self' 'unsafe-inline'`，允許內嵌 style 元素，保留 script-src 與 style 屬性限制。此模式只提供診斷文件，主頁、報告頁與其他回應保留原政策。預設網址可作為嚴格 CSP 對照；實際政策與完整 URL 納入紀錄，避免誤讀 Cloudflare 或舊伺服器回應。

更新後以 Safari 新分頁直接開啟相容模式，先按 A；從網址列重新載入相同 URL，再按 B。若兩次出現裝置選擇視窗並成功返回，可支持樣式阻擋參與授權故障，再處理 iPhone 主頁。若仍逾時，另開紀錄頁取得新結果，確認是否仍有樣式違規、body 是否 inert，以及實際 CSP 有沒有指定 style-src-elem。49 項 Node 測試通過，手機結果待驗證。
