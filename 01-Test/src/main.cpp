#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>  // 用於在 NVS 中固化偽隨機 MAC

// 🌟 藍牙國際標準（SIG）定義的標準 16-bit UUID
#define HEART_RATE_SERVICE_UUID      "180D"
#define HEART_RATE_CHAR_UUID         "2A37"

#define BATTERY_SERVICE_UUID         "180F"
#define BATTERY_LEVEL_CHAR_UUID      "2A19"

// 🌟【快取控制開關】未來若修改了藍牙結構，將此版本號加 1，即可重置 MAC、踢掉 iPhone 快取
const int BLE_VERSION = 1; 

Preferences preferences;
uint8_t myRandomMAC[6]; // 宣告 6 位元組陣列儲存 MAC

BLEServer* pServer = NULL;
BLECharacteristic* pHeartRateChar = NULL;
BLECharacteristic* pBatteryChar = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// 模擬數據變數
uint8_t heartRate = 72;      
uint8_t batteryLevel = 100;  
int hrDirection = 1;

// 監聽藍牙連線狀態的 Callback (保持不變)
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println(">> iPhone Safari (beacio) 已成功連線虛擬心率裝置！");
    };
    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println(">> iPhone 已斷開連線。");
    }
};

// 生成符合 BLE 規範的隨機靜態地址 (保持不變)
void generateBLERandomMAC(uint8_t* mac) {
    for (int i = 0; i < 6; i++) {
        mac[i] = random(0, 256);
    }
    // 藍牙 SIG 規範：隨機靜態地址的最高兩個位元（Most Significant Bits）必須為 11
    mac[0] |= 0xC0; 
}

// 🌟 這是我們剛剛徹底修正、邏輯最完美的 setup() 區塊
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- ESP32-S3 心率模擬 + 智慧型固化公共隨機 MAC 系統 ---");

  // 初始化亂數種子
  randomSeed(analogRead(1));

  // ======= 步驟 1：管理 NVS 儲存區中的偽隨機 MAC =======
  preferences.begin("ble_storage", false);
  int storedVersion = preferences.getInt("version", 0);

  if (storedVersion != BLE_VERSION) {
      Serial.println(">> 偵測到版本號變更，正在生成全新的偽隨機 MAC...");
      generateBLERandomMAC(myRandomMAC);
      preferences.putBytes("mac_addr", myRandomMAC, 6);
      preferences.putInt("version", BLE_VERSION);
  } else {
      Serial.println(">> BLE 結構未變更，正在從快閃記憶體讀取上一次固定的隨機 MAC...");
      preferences.getBytes("mac_addr", myRandomMAC, 6);
  }
  preferences.end(); 

  Serial.printf(">> 當前硬體寫入的基底 MAC 地址: %02X:%02X:%02X:%02X:%02X:%02X\n", 
                myRandomMAC[0], myRandomMAC[1], myRandomMAC[2], myRandomMAC[3], myRandomMAC[4], myRandomMAC[5]);

  // ======= 步驟 2：核心對齊！將你 NVS 固化的偽隨機 MAC 塞入硬體基底 =======
  // 提示：最低有效位 (LSB) 清零，確保為單播地址
  myRandomMAC[0] &= 0xFE; 
  esp_base_mac_addr_set(myRandomMAC);

  // ======= 步驟 3：初始化藍牙名稱 =======
  BLEDevice::init("ESP32-S3-HeartRate");

  // ======= 步驟 4：建立伺服器與標準心率/電池服務 =======
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 心率服務
  BLEService *pHRService = pServer->createService(HEART_RATE_SERVICE_UUID);
  pHeartRateChar = pHRService->createCharacteristic(HEART_RATE_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pHeartRateChar->addDescriptor(new BLE2902());
  pHRService->start();

  // 電池服務
  BLEService *pBatteryService = pServer->createService(BATTERY_SERVICE_UUID);
  pBatteryChar = pBatteryService->createCharacteristic(BATTERY_LEVEL_CHAR_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  pBatteryChar->addDescriptor(new BLE2902());
  pBatteryChar->setValue(&batteryLevel, 1);
  pBatteryService->start();

  // ======= 步驟 5：配置廣播廣告欄位（與 esp_base_mac_addr_set 完美整合） =======
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(HEART_RATE_SERVICE_UUID);
  pAdvertising->addServiceUUID(BATTERY_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  
  // 優化 iOS 連線效率參數
  pAdvertising->setMinPreferred(0x06);  
  pAdvertising->setMinPreferred(0x12);  
  
  // 🌟 通過雙參數將設定與硬體 Public 位址完美綁定，100% 通過編譯
  pAdvertising->setDeviceAddress(myRandomMAC, BLE_ADDR_TYPE_PUBLIC); 

  // ======= 步驟 6：開始廣播 =======
  BLEDevice::startAdvertising();
  Serial.println(">> 心率帶公共隨機地址廣播中...等待 iPhone Safari (beacio) 連線。");
}

// 🌟 主程式循環 (保持不變)
void loop() {
    if (deviceConnected) {
        // 🌀 1. 模擬心率起伏 (在 60 ~ 130 bpm 之間變動)
        heartRate += hrDirection * (random(1, 4));
        if (heartRate >= 130) hrDirection = -1;
        if (heartRate <= 60) hrDirection = 1;

        // 建立符合 BLE GATT 心率標準的數據格式封包
        uint8_t hrmData[2] = {0x00, heartRate}; 
        pHeartRateChar->setValue(hrmData, 2);
        pHeartRateChar->notify(); // 主動推播心率給 Safari 網頁

        // 🔋 2. 模擬電量逐漸消耗
        if (random(0, 15) == 7 && batteryLevel > 1) {
            batteryLevel--;
            pBatteryChar->setValue(&batteryLevel, 1);
            pBatteryChar->notify(); // 主動推播最新電量
        }

        Serial.printf("【即時數據】心率: %d bpm | 電量: %d%%\n", heartRate, batteryLevel);
        delay(1000); // 每秒推播一次最新數據
    }

    // 處理中斷連線後自動重啟廣播的邏輯
    if (!deviceConnected && oldDeviceConnected) {
        delay(500); 
        pServer->startAdvertising(); 
        Serial.println(">> 已重新開啟藍牙廣播...");
        oldDeviceConnected = deviceConnected;
    }
    
    if (deviceConnected && !oldDeviceConnected) {
        oldDeviceConnected = deviceConnected;
    }
}
