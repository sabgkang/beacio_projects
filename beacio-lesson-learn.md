# 01-Test、Multy 與 beacio.com 授權比對

## 最終解法與可重用經驗（2026-10-07）

目前主頁版本為 `20261007-ios-status14`。iPhone 的操作為 **Connect → Beacio 裝置選擇 → 選 Multy → GATT → Services → Notifications → Handshake → Connected**，不再先執行 15 秒廣播掃描。以下是本次收斂結果；後面的 diag8／diag9 等內容保留為調查歷史。

### 已確認的原因與證據

| 現象 | 本次證據 | 結論／處理 |
| --- | --- | --- |
| requestDevice 沒有可見選擇視窗，20 秒逾時 | userActivation=true、navigator.beacio 存在、同步呼叫已返回 Promise；style-src-elem／inline 違規 | 不能把無回應直接歸因於沒有 BLE 裝置。先檢查橋接與 CSP。 |
| 複製與重新載入按鈕都不能點 | 按鈕 disabled=false，但 body.inert=true，命中元素只有 HTML | 頁面背景已停用；單純增加逾時或另一個頁內按鈕不足以恢復操作。 |
| A 無自訂 UUID、B 增加 Multy UUID 都失敗 | 嚴格 CSP 下 A／B 都逾時；樣式相容模式 A／B 都可選 Multy 並成功返回 | CSP style 元素限制參與此選擇介面故障；Multy 自訂 UUID 本身可以授權。 |
| 廣播清單物件直接 GATT 連線被拒 | 實機回覆 Device was not authorized | requestLEScan 許可不等於裝置 GATT 授權，必須使用 requestDevice 回傳物件。 |
| 樣式修正後，主頁名稱篩選仍沒有視窗／no device found | 改用成功診斷 B 的 acceptAllDevices 與完整服務清單後，使用者確認 picker11 成功連線 | 此環境採用已驗證的選擇參數；沒有足夠證據宣稱所有 Beacio 名稱篩選都不支援。 |

本次沒有靠更改 MAC、重置 iPhone GATT 快取、改用心率服務或重新燒錄韌體解決授權問題。01-Test 的成功提供對照，但它同時改了 UUID、MAC 與頁面來源，不能單靠這組比較判定其中一項是原因。

### 最後實作

1. **文件 CSP**：iOS Safari 在應用程式載入前，進入同頁 `?beacioStyles=1`。伺服器僅對主頁、index.html 與診斷 HTML 的明確相容請求加入 `style-src-elem 'self' 'unsafe-inline'`。這允許 Beacio 所需的內嵌 style 元素；保留 `script-src 'self'`，沒有放行內嵌 JavaScript、eval、外站腳本或 style 屬性。PC 預設文件使用原政策。後續若能取得穩定的樣式內容與 hash，可再評估更精確的允許方式，不預設第三方版本間 hash 不變。
2. **API 選擇**：只在 iOS 適配器內，於使用者點擊時讀取 API；有真正 Beacio runtime 時優先 navigator.beacio，否則使用非 CDN stub 的 navigator.bluetooth。PC 原生 API 與 transport.js 不變。
3. **授權選擇**：Connect 原始點擊內立即 requestDevice，不先 await 掃描、網路或其他非必要工作。目前 Multy 使用與成功診斷 B 相同的 acceptAllDevices／optionalServices；選到非 Multy 或沒有名稱的物件時不開始 GATT。
4. **GATT 與協定**：只對 requestDevice 授權回傳物件執行 gatt.connect，取得 Multy 服務／特徵、啟用通知，再進行 hello、傳輸容量確認與控制權握手。裝置選擇成功、GATT 成功與應用程式可操作是不同完成階段。
5. **介面與恢復**：主頁僅保留 BLE 標題下的當前階段，完整診斷另頁提供。逾時診斷自動儲存在 localStorage，獨立 report 頁不載入 SDK 或呼叫 BLE，避免受原分頁停用狀態影響。網頁結束等待不代表第三方選擇器真的被取消，重測前重新載入。

### 下一個 iPhone／Beacio BLE 網頁的開發順序

1. **先做最小連線頁**：一個 Connect 按鈕，直接 requestDevice → GATT → 服務探索。先不要加入自訂掃描清單、輪詢、重試、背景連線或多層彈窗。
2. **先驗證正式部署來源**：HTTPS、Safari 的網站擴充功能權限、實際回應 CSP 都要檢查；beacio.com 成功不等於另一個 origin 已有裝置授權。Cloudflare 與本機開發環境的回應不可互相代替。
3. **使用所需的服務 UUID**：optionalServices 是網站服務存取範圍，不是新增 ESP32 服務。Multy 為了對齊官網成功參數保留了標準服務清單；不能把心率／電池等標準服務當成所有應用必填條件。新專案應先驗證自己需要的服務集合。
4. **分階段記錄**：API 是否存在／stub、API 來源、userActivation、requestDevice 同步返回、選擇 Promise 結果、GATT、服務、通知與應用握手分別記錄。錯誤發生在哪一層，再查那一層。
5. **一次只改一個對照條件**：先比較嚴格／樣式相容 CSP；再比較標準／自訂服務；再比較無篩選／名稱篩選。每次確認完整 URL、版本與實際標頭，避免把未啟用測試模式的結果當成實驗結果。
6. **保護既有 PC 路徑**：iOS 差異放在適配器與文件政策選擇，不替換 PC navigator.bluetooth，也不修改已正常工作的 USB／BLE 傳輸。測試真 Mac 與 Windows 觸控裝置，避免錯認成 iOS。
7. **需要掃描再加**：requestLEScan 可用於廣播監看，但連線授權仍由 requestDevice 處理。若有即時清單，保留裝置列／按鈕，避免每筆廣播重建 DOM 中斷點擊；選取前停止廣播掃描並維持原始手勢。

Beacio 官方說明 API 需要 HTTPS 與使用者手勢，啟用與授權涉及網站來源；SDK 是選用層，不應將「加入 SDK」視為必定能解決所有問題。[官方文件](https://beacio.com/docs)

### 排錯優先順序

- **沒有選擇視窗**：版本與完整 URL → 真正 API／stub → userActivation → CSP 違規 → body.inert／介面遮擋。
- **Device was not authorized**：先確認物件來自 requestDevice，而非 advertisementreceived；確認是目前網站的授權。
- **GATT 已連、服務找不到**：確認 optionalServices、韌體實際 UUID，再查 GATT 服務快取。韌體真的改過服務結構時，才優先研究 Service Changed／Database Hash。
- **通知或握手失敗**：查特徵與訂閱、資料分段／ACK、timeout 與裝置控制權，不回頭任意更改 MAC。

實機證據：使用者已確認樣式相容 A／B 選擇成功與 picker11 完整連線；目前 status14 是直接 Connect 的實作，最新 56 項自動測試通過。後續 UI 版本不可單憑自動測試宣稱所有 iPhone／Beacio 組合都已實機驗證。

實作參考：[iOS 適配器](02-Multy/public/ios-ble.js)、[iOS 文件入口](02-Multy/public/ios-style-mode.js)、[文件 CSP](02-Multy/server.js)、[授權參數](02-Multy/public/beacio-reference.js)、[診斷頁](02-Multy/public/ble-diagnostics.html)、[獨立紀錄頁](02-Multy/public/ble-diagnostic-report.html)。

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

## 樣式相容模式成功後的主頁整合

使用者確認相容模式 A／B 均正常顯示裝置選擇清單，選 Multy 後顯示「裝置選擇成功，未建立 GATT 連線」。這提供 CSP style 元素限制參與選擇介面故障的實機證據，也顯示加入 Multy optionalServices 本身可成功。之前提供的 diag9 失敗紀錄其實沒有帶相容參數，不是放行樣式後仍失敗的證據。

style10 在主頁以同步外部 script 先識別 iOS Safari（含桌面網站模式），只在需要時導向同頁 `beacioStyles=1`，保留既有 query／hash，然後依原 Scan／授權／GATT 流程執行。伺服器對主頁與 index.html 的明確相容請求加入與成功診斷相同的 style-src-elem；PC 預設頁面仍使用原 CSP、URL 與傳輸 API。51 項測試通過；沒有改 MAC、GATT 服務或 PC transport。診斷選擇成功不等於主頁已完成 GATT、通知、握手與控制權取得，仍需手機主頁驗證。

主頁 style10 仍沒有選擇視窗，第二次 Connect 顯示 no device found。已確認線上主頁與 CSP 正確。剩餘可直接比對的差異是主頁用 filters.name，而成功診斷 B 用 acceptAllDevices；主頁也先執行 requestLEScan，診斷則沒有。picker11 先將 iOS 主頁選擇參數與診斷 B 完全對齊，保留掃描流程及同名裝置驗證，不直接連接廣播物件。52 項測試通過，手機結果待驗證；如果仍失敗，下一步需比較前置掃描狀態，而非宣布名稱篩選已證實是根因。
