# Multy 通訊協定 v1

## 傳輸與訊息

USB-to-serial 使用 UART0、GPIO43／44、115200 8N1。BLE 使用下列 UUID：

| 項目 | UUID |
|---|---|
| Service | `6d756c74-7900-4000-8000-000000000001` |
| Command，Write with response | `6d756c74-7900-4000-8000-000000000002` |
| Output，Notify | `6d756c74-7900-4000-8000-000000000003` |

每筆訊息是 UTF-8 JSON 加上 LF；可接受 CRLF。編碼後包含 LF 最多 2048 bytes。收到完整行才解析，超長資料丟棄至下一個 LF。硬體資料以不帶空格的大寫 hex 字串表示，1～256 bytes。

請求包含 `v:1`、正整數 `id`、`op`；回覆使用相同 `id` 與 `ok`。錯誤包含 `error.code`／`error.message`。非同步事件用 `event` 區分，不當成請求回覆。逾時後操作結果可能未知，必須結束連線，不重送寫入。

```json
{"v":1,"id":4,"op":"i2c.read","channel":1,"settings":{"address":60,"clockHz":400000},"length":4}
{"v":1,"id":4,"ok":true,"count":4,"data":"00112233","shortRead":false}
{"v":1,"id":5,"ok":false,"error":{"code":"I2C_NACK","message":"Target did not acknowledge"}}
```

## 握手與控制權

先訂閱 BLE 通知／開啟串列讀取，再依序執行 `hello`、BLE 分段測試（如需要）、`session.claim`、`hello`。取得控制權後每五秒執行 `session.ping`，離開前 `session.release`。20 秒無心跳即撤銷控制權。

`hello` 回傳 `protocol`、`firmware`、`deviceId`、`maxBytes`、`maxFrameBytes`、`maxQueuedCommands`、`capabilities`、`pins`、`uart`、`owner` 與 `cleaning`。BLE 另回傳 `ble.mtu`、`ble.maxChunkBytes`、`ble.chunkBytes`。

`owner` 為 `none`／`usb`／`ble`。控制權已被占用或清理中，claim 回傳 `DEVICE_BUSY`。新控制權會由硬體工作程序清理 UART RX、等待已提交 TX 有界限地排空，再回覆成功；已送出的 byte 無法撤回。

USB 的新工作階段以第一筆 `hello` 的 `id:1` 識別；同一連線後續請求持續使用新編號，不再以 `id:1` 請求 hello。BLE 工作階段依實際 GATT 連線區分。

## 硬體命令

`channel` 為 1／2。除 hello、分段測試及 transport ACK 外，必須先取得控制權。

| 命令 | 參數與結果 |
|---|---|
| `uart.configure` | `settings:{baud,dataBits,parity,stopBits}`；回傳已套用 `settings` |
| `uart.write` | `data`；回傳驅動已接受的 `count`，不附加 CR／LF |
| `i2c.write` | `settings:{address,clockHz}`、`data`；STOP 結束 |
| `i2c.read` | 同上設定及 `length`；回傳 `data`、`count`、`shortRead` |
| `i2c.recover` | 只有 `channel`；回傳 `recovered` 或 `I2C_BUS_STUCK` |
| `spi.write` | `settings:{clockHz,mode}`、`data`；全雙工回傳 `data`、`count` |
| `spi.read` | 同上設定、`length`、`dummy`（0～255）；回傳 `data`、`count` |

UART baud 為 9600／19200／38400／57600／115200／230400；dataBits 為 5～8；parity 為 `none`／`even`／`odd`；stopBits 為 1／2。UART write 不依命令內的 settings 改變設定，需明確 configure。

I2C address 為 8～119；clockHz 為 100000／400000。本版沒有合併讀寫或 repeated START。Arduino 框架的 I2C Read 使用硬體 HAL `i2cRead()`，保留 TwoWire 封裝未提供的實際逾時／NACK 狀態。

SPI clockHz 為 100000／500000／1000000／4000000／8000000；mode 為 0～3；固定 MSB first。每次交易獨立拉低／拉高 CS。

UART 非同步事件：

```json
{"v":1,"event":"uart.rx","channel":2,"seq":17,"data":"48656C6C6F","droppedBytes":128,"rxErrors":0}
```

`droppedBytes` 是待送佇列丟棄的目標資料 byte 數；`rxErrors` 是 UART 驅動的錯誤事件數。硬體 FIFO 溢位可能無法取得精確遺失 byte 數，不用錯誤事件數假冒遺失 byte 數。`session.ended` 通知租期失效；瀏覽器結束連線並保留舊紀錄。

## BLE 分段與流量控制

握手先使用 20-byte；韌體 MTU 上限 247，實際協商由作業系統處理。網頁沒有 MTU 協商 API。候選分段上限為 `min(MTU-3,244)`。

依序探測候選上限以下的 64、128、候選上限（去重）。`transport.probe` 包含 `chunkBytes` 與固定 256-byte 測試 `data`，不操作硬體；回覆含 `count`、原樣 `data`、大寫 SHA-256。比對往返內容後才採用該分段。探測失敗則結束連線，此頁面下次由使用者連線同一裝置時回到 20-byte 模式。

網頁寫入每段等待 Write with response 完成；韌體每段通知至少間隔 15 ms，避免單個完整訊息仍產生大量瞬間通知。

每個 BLE 輸出訊息有 `transportSeq`，從 1 遞增。韌體一次只允許一筆訊息等待應用層 ACK。網頁完整解析後立即傳送：

```json
{"v":1,"op":"transport.ack","seq":17}
```

ACK 不帶 `id`，不產生回覆，也不需要控制權。ACK 與心跳在完整訊息邊界優先寫入；韌體控制路徑不受硬體命令佇列阻塞。通知送完後 10 秒沒有 ACK，即結束 BLE 工作階段。ACK 不是外部目標裝置的回覆。

## 限制與恢復

- 硬體命令佇列最多八筆，待送訊息含活動中的訊息預留空間最多 16 KiB。
- UART 以最多 128 bytes、20 ms 時間窗送出；每組驅動 RX 緩衝區 4 KiB。
- 超載只丟棄未開始送出的完整 UART 訊息；已送一半的 JSON 不截斷、不交錯。無法保存命令回覆時結束連線，而非靜默丟棄回覆。
- 控制權撤銷後，舊世代尚未開始的命令取消；執行中的交易結束後清理，清理完成前不授予新控制權。
- I2C 交易逾時 100 ms；最多一次 bus-clear／重新初始化，不重播原操作。SCL 可釋放、SDA 卡低時最多九個開漏時脈，SCL 每次等待最多 1 ms，GPIO 清理最多 20 ms。
- NACK 不觸發清理；線路持續卡低回報 `I2C_BUS_STUCK`，排除問題後需明確 recover。GPIO 清理不是正常交易的軟體 I2C。

常見錯誤碼：`PROTOCOL_VERSION`、`INVALID_JSON`、`INVALID_REQUEST`、`FRAME_TOO_LARGE`、`INVALID_CHANNEL`、`INVALID_SETTINGS`、`INVALID_LENGTH`、`INVALID_DATA`、`INVALID_PROBE`、`UNKNOWN_OP`、`DEVICE_BUSY`、`SESSION_ENDED`、`QUEUE_FULL`、`UART_BUSY`、`I2C_NACK`、`I2C_TIMEOUT`、`I2C_BUS_STUCK`、`DRIVER_ERROR`。
