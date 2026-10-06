#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <Wire.h>
#include <SPI.h>

struct UartConfig { uint32_t baud = 115200; uint8_t dataBits = 8, stopBits = 1; String parity = "none"; };
class Buses {
 public:
  void begin();
  void execute(JsonDocument &request, JsonDocument &response);
  size_t readUart(uint8_t index, uint8_t *bytes, size_t max);
  uint32_t uartErrors(uint8_t index) const { return __atomic_load_n(&rxErrors[index], __ATOMIC_RELAXED); }
  void sanitize();
  void describe(JsonDocument &response);
  static const int tx[2], rx[2], sda[2], scl[2], sck[2], mosi[2], miso[2], cs[2];
 private:
  HardwareSerial uart1{1}, uart2{2}; HardwareSerial *uarts[2] = {&uart1, &uart2};
  TwoWire wire1{0}, wire2{1}; TwoWire *wires[2] = {&wire1, &wire2};
  SPIClass spi1{FSPI}, spi2{HSPI}; SPIClass *spis[2] = {&spi1, &spi2};
  UartConfig configs[2]; bool stuck[2] = {false, false}; uint32_t clocks[2] = {400000, 400000};
  SemaphoreHandle_t uartLock;
  uint32_t rxErrors[2] = {};
  bool recover(uint8_t index);
};
bool decodeHex(JsonVariantConst value, uint8_t *bytes, size_t &length, bool allowEmpty = false);
String encodeHex(const uint8_t *bytes, size_t length);
void errorResponse(JsonDocument &response, const char *code, const char *message);
