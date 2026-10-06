#include "Buses.h"
#include "driver/uart.h"
#include "esp32-hal-i2c.h"

const int Buses::tx[2] = {17, 15}, Buses::rx[2] = {18, 16};
const int Buses::sda[2] = {4, 6}, Buses::scl[2] = {5, 7};
const int Buses::sck[2] = {12, 8}, Buses::mosi[2] = {11, 9}, Buses::miso[2] = {13, 21}, Buses::cs[2] = {10, 14};

static int nibble(char c) { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; if (c >= 'A' && c <= 'F') return c - 'A' + 10; return -1; }
bool decodeHex(JsonVariantConst value, uint8_t *bytes, size_t &length, bool allowEmpty) {
  if (!value.is<const char *>()) return false;
  const char *hex = value.as<const char *>(); size_t chars = strlen(hex);
  if (chars != value.as<JsonString>().size() || chars > 512 || chars % 2 || (!chars && !allowEmpty)) return false;
  length = chars / 2;
  for (size_t i = 0; i < length; ++i) { int a = nibble(hex[i * 2]), b = nibble(hex[i * 2 + 1]); if (a < 0 || b < 0) return false; bytes[i] = (a << 4) | b; }
  return true;
}
String encodeHex(const uint8_t *bytes, size_t length) {
  static const char digits[] = "0123456789ABCDEF"; String out; out.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) { out += digits[bytes[i] >> 4]; out += digits[bytes[i] & 15]; } return out;
}
void errorResponse(JsonDocument &response, const char *code, const char *message) { response["ok"] = false; response["error"]["code"] = code; response["error"]["message"] = message; }

void Buses::begin() {
  uartLock = xSemaphoreCreateMutex();
  for (int i = 0; i < 2; ++i) {
    uarts[i]->setRxBufferSize(4096); uarts[i]->setTxBufferSize(512); uarts[i]->begin(115200, SERIAL_8N1, rx[i], tx[i]);
    uarts[i]->onReceiveError([this, i](hardwareSerial_error_t) { __atomic_add_fetch(&rxErrors[i], 1, __ATOMIC_RELAXED); });
    wires[i]->setBufferSize(256); wires[i]->setTimeOut(100);
    // I2C starts lazily. CS is inactive even before any target transaction.
    digitalWrite(cs[i], HIGH); pinMode(cs[i], OUTPUT);
    spis[i]->begin(sck[i], miso[i], mosi[i], cs[i]);
  }
}
size_t Buses::readUart(uint8_t index, uint8_t *bytes, size_t max) {
  if (xSemaphoreTake(uartLock, pdMS_TO_TICKS(2)) != pdTRUE) return 0;
  size_t length = 0; while (length < max && uarts[index]->available()) bytes[length++] = uarts[index]->read();
  xSemaphoreGive(uartLock); return length;
}
void Buses::sanitize() {
  xSemaphoreTake(uartLock, portMAX_DELAY);
  for (int i = 0; i < 2; ++i) {
    digitalWrite(cs[i], HIGH);
    // Submitted bytes cannot be recalled; allow a bounded drain before granting a new owner.
    uart_wait_tx_done(static_cast<uart_port_t>(i + 1), pdMS_TO_TICKS(1000));
    uart_flush_input(static_cast<uart_port_t>(i + 1));
    __atomic_store_n(&rxErrors[i], 0, __ATOMIC_RELAXED);
  }
  xSemaphoreGive(uartLock);
}
void Buses::describe(JsonDocument &response) {
  xSemaphoreTake(uartLock, portMAX_DELAY);
  JsonArray array = response["uart"].to<JsonArray>();
  for (int i = 0; i < 2; ++i) {
    JsonObject item = array.add<JsonObject>(); item["baud"] = configs[i].baud; item["dataBits"] = configs[i].dataBits; item["parity"] = configs[i].parity; item["stopBits"] = configs[i].stopBits;
  }
  xSemaphoreGive(uartLock);
  for (int i = 0; i < 2; ++i) {
    String n = String(i + 1);
    response["pins"]["uart" + n]["TX"] = tx[i]; response["pins"]["uart" + n]["RX"] = rx[i];
    response["pins"]["i2c" + n]["SDA"] = sda[i]; response["pins"]["i2c" + n]["SCL"] = scl[i];
    response["pins"]["spi" + n]["SCK"] = sck[i]; response["pins"]["spi" + n]["MOSI"] = mosi[i]; response["pins"]["spi" + n]["MISO"] = miso[i]; response["pins"]["spi" + n]["CS"] = cs[i];
  }
}
bool Buses::recover(uint8_t i) {
  wires[i]->end();
  digitalWrite(sda[i], HIGH); digitalWrite(scl[i], HIGH); pinMode(sda[i], OUTPUT_OPEN_DRAIN); pinMode(scl[i], OUTPUT_OPEN_DRAIN);
  const uint32_t start = micros();
  auto high = [&]() { uint32_t wait = micros(); while (!digitalRead(scl[i])) { if (micros() - wait >= 1000 || micros() - start >= 20000) return false; delayMicroseconds(5); } return true; };
  bool good = high();
  for (int pulse = 0; good && !digitalRead(sda[i]) && pulse < 9; ++pulse) {
    digitalWrite(scl[i], LOW); delayMicroseconds(5); digitalWrite(scl[i], HIGH); good = high(); delayMicroseconds(5);
  }
  if (good) {
    digitalWrite(scl[i], LOW); digitalWrite(sda[i], LOW); delayMicroseconds(5);
    digitalWrite(scl[i], HIGH); good = high(); delayMicroseconds(5); digitalWrite(sda[i], HIGH); delayMicroseconds(5);
    good = good && digitalRead(sda[i]) && digitalRead(scl[i]) && micros() - start < 20000;
  }
  pinMode(sda[i], INPUT); pinMode(scl[i], INPUT);
  wires[i]->setBufferSize(256); wires[i]->setTimeOut(100);
  stuck[i] = !(good && wires[i]->begin(sda[i], scl[i], clocks[i])); return !stuck[i];
}

void Buses::execute(JsonDocument &request, JsonDocument &response) {
  if (!request["channel"].is<int>() || request["channel"].as<int>() < 1 || request["channel"].as<int>() > 2) { errorResponse(response, "INVALID_CHANNEL", "Channel must be 1 or 2"); return; }
  const int i = request["channel"].as<int>() - 1; String op = request["op"].as<String>();
  JsonObjectConst settings = request["settings"].as<JsonObjectConst>();
  uint8_t bytes[256] = {}, received[256] = {}; size_t length = 0;
  if (op == "i2c.recover") { if (!recover(i)) errorResponse(response, "I2C_BUS_STUCK", "Bus remains stuck; check wiring"); else response["recovered"] = true; return; }
  if (op == "uart.configure") {
    const int baud = settings["baud"] | 0, bits = settings["dataBits"] | 0, stop = settings["stopBits"] | 0; String parity = settings["parity"] | "";
    bool validBaud = baud == 9600 || baud == 19200 || baud == 38400 || baud == 57600 || baud == 115200 || baud == 230400;
    if (!settings["baud"].is<int>() || !settings["dataBits"].is<int>() || !settings["stopBits"].is<int>() || !validBaud || bits < 5 || bits > 8 || (stop != 1 && stop != 2) || (parity != "none" && parity != "even" && parity != "odd")) { errorResponse(response, "INVALID_SETTINGS", "Invalid UART settings"); return; }
    uint32_t config = SERIAL_5N1 + ((bits - 5) << 2); if (stop == 2) config += 0x20; if (parity == "even") config += 2; if (parity == "odd") config += 3;
    xSemaphoreTake(uartLock, portMAX_DELAY);
    if (uart_wait_tx_done(static_cast<uart_port_t>(i + 1), pdMS_TO_TICKS(100)) != ESP_OK) { xSemaphoreGive(uartLock); errorResponse(response, "UART_BUSY", "UART still transmitting"); return; }
    uarts[i]->end(); uarts[i]->setRxBufferSize(4096); uarts[i]->setTxBufferSize(512); uarts[i]->begin(baud, config, rx[i], tx[i]);
    uarts[i]->onReceiveError([this, i](hardwareSerial_error_t) { __atomic_add_fetch(&rxErrors[i], 1, __ATOMIC_RELAXED); });
    configs[i].baud = baud; configs[i].dataBits = bits; configs[i].stopBits = stop; configs[i].parity = parity;
    xSemaphoreGive(uartLock);
    response["settings"]["baud"] = baud; response["settings"]["dataBits"] = bits; response["settings"]["parity"] = parity; response["settings"]["stopBits"] = stop; return;
  }
  const bool reading = op.endsWith(".read");
  if (reading) {
    if (!request["length"].is<int>() || request["length"].as<int>() < 1 || request["length"].as<int>() > 256) { errorResponse(response, "INVALID_LENGTH", "Length must be 1-256"); return; }
    length = request["length"].as<int>();
  } else if (!decodeHex(request["data"], bytes, length)) { errorResponse(response, "INVALID_DATA", "Use 1-256 hexadecimal bytes"); return; }
  if (op == "uart.write") {
    xSemaphoreTake(uartLock, portMAX_DELAY);
    int count = uart_write_bytes(static_cast<uart_port_t>(i + 1), bytes, length); xSemaphoreGive(uartLock);
    if (count != static_cast<int>(length)) errorResponse(response, "DRIVER_ERROR", "UART driver rejected bytes"); else response["count"] = count; return;
  }
  if (op.startsWith("i2c.")) {
    const int address = settings["address"] | 0, clock = settings["clockHz"] | 0;
    if (address < 8 || address > 119 || (clock != 100000 && clock != 400000) || !settings["address"].is<int>() || !settings["clockHz"].is<int>()) { errorResponse(response, "INVALID_SETTINGS", "Invalid I2C address or clock"); return; }
    if (stuck[i]) { errorResponse(response, "I2C_BUS_STUCK", "Recover bus before using this channel"); return; }
    clocks[i] = clock;
    if (!wires[i]->begin(sda[i], scl[i], clock) || !wires[i]->setClock(clock)) { errorResponse(response, "DRIVER_ERROR", "I2C initialization failed"); return; }
    wires[i]->setTimeOut(100);
    int status = 0; size_t count = 0;
    if (reading) {
      // Use the framework HAL to retain the exact timeout/NACK status hidden by requestFrom().
      esp_err_t result = i2cRead(i, address, received, length, 100, &count);
      status = result == ESP_OK ? 0 : result == ESP_ERR_TIMEOUT ? 5 : result == ESP_FAIL ? 2 : 4;
    } else {
      wires[i]->beginTransmission(address); wires[i]->write(bytes, length); status = wires[i]->endTransmission(true); count = length;
    }
    if (status == 5) { bool recovered = recover(i); errorResponse(response, recovered ? "I2C_TIMEOUT" : "I2C_BUS_STUCK", "I2C timed out; original operation was not retried"); response["recovered"] = recovered; }
    else if (status == 2 || status == 3) errorResponse(response, "I2C_NACK", "Target did not acknowledge");
    else if (status) errorResponse(response, "DRIVER_ERROR", "I2C transaction failed");
    else { response["count"] = count; if (reading) { response["data"] = encodeHex(received, count); response["shortRead"] = count != length; } }
    return;
  }
  if (op.startsWith("spi.")) {
    const int clock = settings["clockHz"] | 0, mode = settings["mode"] | -1;
    if ((clock != 100000 && clock != 500000 && clock != 1000000 && clock != 4000000 && clock != 8000000) || mode < 0 || mode > 3 || !settings["mode"].is<int>() || !settings["clockHz"].is<int>()) { errorResponse(response, "INVALID_SETTINGS", "Invalid SPI clock or mode"); return; }
    if (reading) {
      if (!request["dummy"].is<int>() || request["dummy"].as<int>() < 0 || request["dummy"].as<int>() > 255) { errorResponse(response, "INVALID_DATA", "Dummy must be a byte"); return; }
      memset(bytes, request["dummy"].as<int>(), length);
    }
    spis[i]->beginTransaction(SPISettings(clock, MSBFIRST, mode)); digitalWrite(cs[i], LOW);
    spis[i]->transferBytes(bytes, received, length); digitalWrite(cs[i], HIGH); spis[i]->endTransaction();
    response["data"] = encodeHex(received, length); response["count"] = length; return;
  }
  errorResponse(response, "UNKNOWN_OP", "Unknown operation");
}
