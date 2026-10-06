#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <deque>
#include <mbedtls/sha256.h>
#include <esp_log.h>
#include "Buses.h"

namespace {
constexpr char SERVICE[] = "6d756c74-7900-4000-8000-000000000001";
constexpr char COMMAND[] = "6d756c74-7900-4000-8000-000000000002";
constexpr char OUTPUT_UUID[] = "6d756c74-7900-4000-8000-000000000003";
constexpr size_t MAX_FRAME = 2048, OUT_LIMIT = 16384;
constexpr uint8_t USB = 0, BLE = 1;
struct Lock { SemaphoreHandle_t mutex; explicit Lock(SemaphoreHandle_t m): mutex(m) { xSemaphoreTake(mutex, portMAX_DELAY); } ~Lock() { xSemaphoreGive(mutex); } };
struct Command { uint8_t source; uint32_t epoch, generation; char text[MAX_FRAME]; };
struct BleInput { uint8_t kind; uint16_t id, length; uint8_t bytes[244]; };
struct Frame { uint8_t source; uint32_t epoch, generation; String text; bool uart = false; uint8_t channel = 0; size_t count = 0, charge = 0; uint16_t chunk = 0; };
struct Active { Frame frame; size_t offset = 0; uint32_t seq = 0, sentAt = 0, lastChunkAt = 0; bool waiting = false; };
struct Parser { String text; bool discarding = false; void reset() { text = ""; discarding = false; } };

Buses buses;
QueueHandle_t commands, bleInput;
SemaphoreHandle_t stateLock, outputLock;
int owner = -1; uint32_t generation = 0, heartbeatAt = 0; bool cleaning = false;
uint32_t epochs[2] = {1, 1};
bool linked[2] = {true, false};
std::deque<Frame> frames; size_t outputBytes = 0; uint32_t lostBytes[2] = {}, uartSeq[2] = {};
Active active[2]; Parser parsers[2];
BLEServer *server; BLECharacteristic *output; uint16_t connId = 0, mtu = 23, chunkBytes = 20;
uint32_t bleSeq = 0; volatile bool ingressBroken = false, notifyBroken = false; bool outputBroken[2] = {};
String deviceId;

uint32_t epochFor(uint8_t source) { Lock lock(stateLock); return epochs[source]; }
bool validConnection(const Frame &frame) { Lock lock(stateLock); return linked[frame.source] && epochs[frame.source] == frame.epoch; }
bool validOwner(uint8_t source, uint32_t gen) { Lock lock(stateLock); return owner == source && generation == gen && !cleaning; }
void countLost(uint8_t channel, size_t count) { lostBytes[channel] += count; }

void enqueue(uint8_t source, uint32_t epoch, JsonDocument &doc, bool uart = false, uint8_t channel = 0, size_t count = 0, uint32_t gen = 0, uint16_t chunk = 0) {
  if (epoch != epochFor(source)) return;
  String text; serializeJson(doc, text); text += '\n';
  // Reserve room for the transport sequence inserted when BLE transmission starts.
  if (text.length() + 40 > MAX_FRAME) { Lock lock(outputLock); outputBroken[source] = true; return; }
  Lock lock(outputLock);
  while (outputBytes + text.length() + 40 > OUT_LIMIT) {
    auto it = frames.begin(); while (it != frames.end() && !it->uart) ++it;
    if (it == frames.end()) break;
    outputBytes -= it->charge; countLost(it->channel, it->count); frames.erase(it);
  }
  if (outputBytes + text.length() + 40 > OUT_LIMIT) {
    if (uart) countLost(channel, count); else outputBroken[source] = true;
    return;
  }
  Frame frame; frame.source = source; frame.epoch = epoch; frame.generation = gen; frame.text = text; frame.uart = uart; frame.channel = channel; frame.count = count; frame.chunk = chunk; frame.charge = text.length() + 40;
  frames.push_back(frame); outputBytes += frame.charge;
}
JsonDocument responseFor(JsonDocument &request) { JsonDocument response; response["v"] = 1; response["id"] = request["id"]; response["ok"] = true; return response; }
void respondError(uint8_t source, JsonDocument &request, const char *code, const char *message) {
  JsonDocument response = responseFor(request); errorResponse(response, code, message); enqueue(source, epochFor(source), response);
}
void revoke(uint8_t source, bool notify) {
  uint32_t oldGen;
  { Lock lock(stateLock); if (owner != source) return; oldGen = generation; owner = -1; ++generation; cleaning = true; }
  {
    Lock lock(outputLock);
    for (auto it = frames.begin(); it != frames.end();) {
      if (it->uart && it->generation == oldGen) { outputBytes -= it->charge; it = frames.erase(it); } else ++it;
    }
  }
  if (notify) { JsonDocument event; event["v"] = 1; event["event"] = "session.ended"; enqueue(source, epochFor(source), event); }
}
void dropLink(uint8_t source) {
  revoke(source, false);
  { Lock lock(stateLock); ++epochs[source]; if (source == BLE) linked[source] = false; }
  parsers[source].reset();
  { Lock lock(outputLock);
    for (auto it = frames.begin(); it != frames.end();) {
      if (it->source == source) { outputBytes -= it->charge; it = frames.erase(it); } else ++it;
    }
    if (active[source].frame.text.length()) outputBytes -= active[source].frame.charge;
    active[source] = Active{}; outputBroken[source] = false;
  }
  if (source == BLE) { server->disconnect(connId); chunkBytes = 20; }
}

void describe(uint8_t source, JsonDocument &response) {
  response["protocol"] = 1; response["firmware"] = "1.0.0"; response["deviceId"] = deviceId;
  response["maxBytes"] = 256; response["maxFrameBytes"] = MAX_FRAME; response["maxQueuedCommands"] = 8;
  { Lock lock(stateLock); response["owner"] = owner < 0 ? "none" : owner == USB ? "usb" : "ble"; response["cleaning"] = cleaning; }
  response["capabilities"]["uart"] = 2; response["capabilities"]["i2c"] = 2; response["capabilities"]["spi"] = 2;
  response["capabilities"]["i2cRepeatedStart"] = false;
  if (source == BLE) { response["ble"]["mtu"] = mtu; response["ble"]["maxChunkBytes"] = min(static_cast<int>(mtu - 3), 244); response["ble"]["chunkBytes"] = chunkBytes; }
  buses.describe(response);
}

void processFrame(uint8_t source, const String &text) {
  JsonDocument request;
  if (deserializeJson(request, text)) { JsonDocument empty; respondError(source, empty, "INVALID_JSON", "Invalid JSON frame"); return; }
  if (!request.is<JsonObject>() || !request["v"].is<int>() || request["v"].as<int>() != 1) { respondError(source, request, "PROTOCOL_VERSION", "Protocol version 1 required"); return; }
  String op = request["op"] | "";
  if (op == "transport.ack") {
    if (source == BLE && request["seq"].is<uint32_t>() && active[BLE].waiting && request["seq"].as<uint32_t>() == active[BLE].seq) {
      if (active[BLE].frame.chunk) chunkBytes = active[BLE].frame.chunk;
      Lock lock(outputLock); outputBytes -= active[BLE].frame.charge; active[BLE] = Active{};
    }
    return;
  }
  if (!request["id"].is<uint32_t>() || !request["id"].as<uint32_t>() || !request["op"].is<const char *>()) { respondError(source, request, "INVALID_REQUEST", "Positive id and operation required"); return; }
  JsonDocument response = responseFor(request);
  if (op == "hello") {
    // A new USB browser session is identified by its initial request id.
    if (source == USB && request["id"].as<uint32_t>() == 1) {
      revoke(USB, false); dropLink(USB);
    }
    describe(source, response); enqueue(source, epochFor(source), response); return;
  }
  if (op == "session.claim") {
    bool busy, queued = false, full = false;
    {
      Lock lock(stateLock); busy = cleaning || (owner >= 0 && owner != source);
      if (!busy && owner < 0) {
        Command claim{}; claim.source = source; claim.epoch = epochs[source]; claim.generation = generation + 1; text.toCharArray(claim.text, sizeof(claim.text));
        // Reserve ownership atomically; only the worker sanitizes hardware and confirms the claim.
        queued = xQueueSend(commands, &claim, 0) == pdTRUE;
        if (queued) { owner = source; ++generation; cleaning = true; heartbeatAt = millis(); } else full = true;
      } else if (!busy) heartbeatAt = millis();
    }
    if (queued) return;
    if (busy) errorResponse(response, "DEVICE_BUSY", "Device controlled by another client or cleaning up");
    else if (full) errorResponse(response, "QUEUE_FULL", "Cleanup queue full; try claiming again");
    else response["owner"] = source == USB ? "usb" : "ble";
    enqueue(source, epochFor(source), response); return;
  }
  if (op == "transport.probe") {
    uint8_t bytes[256]; size_t length = 0; int size = request["chunkBytes"] | 0;
    if (source != BLE || !request["chunkBytes"].is<int>() || size < 20 || size > min(static_cast<int>(mtu - 3), 244) || !decodeHex(request["data"], bytes, length)) errorResponse(response, "INVALID_PROBE", "Probe size exceeds negotiated MTU");
    else {
      uint8_t hash[32]; mbedtls_sha256_ret(bytes, length, hash, 0); response["count"] = length; response["sha256"] = encodeHex(hash, sizeof(hash)); response["data"] = encodeHex(bytes, length);
      enqueue(source, epochFor(source), response, false, 0, 0, 0, size); return;
    }
    enqueue(source, epochFor(source), response); return;
  }
  uint32_t gen;
  { Lock lock(stateLock); gen = generation; }
  if (!validOwner(source, gen)) { respondError(source, request, "DEVICE_BUSY", "Acquire device control first"); return; }
  if (op == "session.ping") {
    { Lock lock(stateLock); heartbeatAt = millis(); }
    enqueue(source, epochFor(source), response); return;
  }
  if (op == "session.release") { revoke(source, false); enqueue(source, epochFor(source), response); return; }
  bool known = op == "uart.configure" || op == "uart.write" || op == "i2c.read" || op == "i2c.write" || op == "i2c.recover" || op == "spi.read" || op == "spi.write";
  if (!known) { respondError(source, request, "UNKNOWN_OP", "Unknown operation"); return; }
  Command command{}; command.source = source; command.epoch = epochFor(source); command.generation = gen; text.toCharArray(command.text, sizeof(command.text));
  if (xQueueSend(commands, &command, 0) != pdTRUE) respondError(source, request, "QUEUE_FULL", "At most eight queued commands");
}
void parseByte(uint8_t source, uint8_t byte) {
  Parser &parser = parsers[source];
  if (byte == '\n') {
    if (parser.discarding) { parser.reset(); return; }
    String text = parser.text; parser.reset(); text.trim(); if (text.length()) processFrame(source, text);
  } else if (!parser.discarding) {
    parser.text += static_cast<char>(byte);
    if (parser.text.length() >= MAX_FRAME) { parser.text = ""; parser.discarding = true; JsonDocument empty; respondError(source, empty, "FRAME_TOO_LARGE", "Frame exceeds 2048 bytes"); }
  }
}

void sanitizeIfNeeded() {
  bool sanitize;
  { Lock lock(stateLock); sanitize = cleaning; }
  if (sanitize) {
    buses.sanitize();
    { Lock lock(outputLock); lostBytes[0] = lostBytes[1] = 0; uartSeq[0] = uartSeq[1] = 0; }
    { Lock lock(stateLock); cleaning = false; }
  }
}
void worker(void *) {
  Command command;
  while (true) {
    sanitizeIfNeeded();
    if (xQueueReceive(commands, &command, pdMS_TO_TICKS(5)) != pdTRUE) continue;
    // A claim/revoke can arrive while this worker is blocked in xQueueReceive.
    sanitizeIfNeeded();
    JsonDocument request; deserializeJson(request, command.text); JsonDocument response = responseFor(request);
    if (command.epoch != epochFor(command.source)) continue;
    if (!validOwner(command.source, command.generation)) errorResponse(response, "SESSION_ENDED", "Command cancelled before execution");
    else if (request["op"] == "session.claim") response["owner"] = command.source == USB ? "usb" : "ble";
    else buses.execute(request, response);
    enqueue(command.source, command.epoch, response);
  }
}
void uartReceiver(void *) {
  uint8_t bytes[2][128]; size_t lengths[2] = {}; uint32_t started[2] = {}, batchGen[2] = {};
  while (true) {
    int target; uint32_t gen, epoch = 0; bool ready;
    { Lock lock(stateLock); target = owner; gen = generation; ready = !cleaning && target >= 0; if (ready) epoch = epochs[target]; }
    for (uint8_t i = 0; i < 2; ++i) {
      if (batchGen[i] != gen || !ready) { lengths[i] = 0; batchGen[i] = gen; }
      const size_t count = buses.readUart(i, bytes[i] + lengths[i], 128 - lengths[i]);
      if (!ready) { lengths[i] = 0; continue; }
      if (count && !lengths[i]) started[i] = millis(); lengths[i] += count;
      if (lengths[i] && (lengths[i] == 128 || millis() - started[i] >= 20)) {
        if (validOwner(target, gen)) {
          JsonDocument event; event["v"] = 1; event["event"] = "uart.rx"; event["channel"] = i + 1; event["data"] = encodeHex(bytes[i], lengths[i]); event["rxErrors"] = buses.uartErrors(i);
          { Lock lock(outputLock); event["seq"] = ++uartSeq[i]; event["droppedBytes"] = lostBytes[i]; }
          enqueue(target, epoch, event, true, i, lengths[i], gen);
        }
        lengths[i] = 0;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *, esp_ble_gatts_cb_param_t *param) override { BleInput input{}; input.kind = 1; input.id = param->connect.conn_id; if (xQueueSend(bleInput, &input, 0) != pdTRUE) ingressBroken = true; }
  void onDisconnect(BLEServer *) override { BleInput input{}; input.kind = 2; if (xQueueSend(bleInput, &input, 0) != pdTRUE) ingressBroken = true; }
  void onMtuChanged(BLEServer *, esp_ble_gatts_cb_param_t *param) override { BleInput input{}; input.kind = 3; input.length = param->mtu.mtu; if (xQueueSend(bleInput, &input, 0) != pdTRUE) ingressBroken = true; }
};
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    std::string value = characteristic->getValue(); BleInput input{}; input.kind = 0;
    if (value.size() > sizeof(input.bytes)) { ingressBroken = true; return; }
    input.length = value.size(); memcpy(input.bytes, value.data(), input.length);
    if (xQueueSend(bleInput, &input, 0) != pdTRUE) ingressBroken = true;
  }
};
class OutputCallbacks : public BLECharacteristicCallbacks {
  void onStatus(BLECharacteristic *, Status status, uint32_t) override { if (status != Status::SUCCESS_NOTIFY && status != Status::SUCCESS_INDICATE) notifyBroken = true; }
};

void sendOutput(uint8_t source) {
  Active &current = active[source];
  if (!current.frame.text.length()) {
    Lock lock(outputLock);
    auto selected = frames.end();
    for (auto it = frames.begin(); it != frames.end(); ++it) if (it->source == source) { if (selected == frames.end()) selected = it; if (!it->uart) { selected = it; break; } }
    if (selected == frames.end()) return;
    current.frame = *selected; frames.erase(selected);
  }
  if (!validConnection(current.frame) || (current.frame.uart && !current.offset && !validOwner(source, current.frame.generation))) {
    Lock lock(outputLock); outputBytes -= current.frame.charge; current = Active{}; return;
  }
  if (source == USB) {
    size_t count = min(static_cast<size_t>(Serial.availableForWrite()), current.frame.text.length() - current.offset);
    if (count) current.offset += Serial.write(reinterpret_cast<const uint8_t *>(current.frame.text.c_str()) + current.offset, count);
    if (current.offset == current.frame.text.length()) { Lock lock(outputLock); outputBytes -= current.frame.charge; current = Active{}; }
    return;
  }
  if (current.waiting) { if (millis() - current.sentAt >= 10000) dropLink(BLE); return; }
  // Bound fragment production as well as complete-frame production, even at MTU 23.
  if (current.offset && millis() - current.lastChunkAt < 15) return;
  if (!current.seq) {
    current.seq = ++bleSeq; JsonDocument doc; deserializeJson(doc, current.frame.text); doc["transportSeq"] = current.seq;
    String encoded; serializeJson(doc, encoded); encoded += '\n';
    // The sequence fits inside the original fixed 40-byte reservation.
    current.frame.text = encoded;
  }
  const size_t size = min(static_cast<size_t>(min(static_cast<int>(mtu - 3), static_cast<int>(current.frame.chunk ? current.frame.chunk : chunkBytes))), current.frame.text.length() - current.offset);
  output->setValue(reinterpret_cast<uint8_t *>(const_cast<char *>(current.frame.text.c_str())) + current.offset, size); output->notify();
  current.lastChunkAt = millis();
  current.offset += size;
  if (current.offset == current.frame.text.length()) { current.waiting = true; current.sentAt = millis(); }
}
} // namespace

void setup() {
  // UART0 carries protocol frames; keep runtime diagnostics off that channel.
  esp_log_level_set("*", ESP_LOG_NONE);
  Serial.begin(115200, SERIAL_8N1, 44, 43);
  stateLock = xSemaphoreCreateMutex(); outputLock = xSemaphoreCreateMutex();
  commands = xQueueCreate(8, sizeof(Command)); bleInput = xQueueCreate(32, sizeof(BleInput));
  buses.begin(); char suffix[13]; snprintf(suffix, sizeof(suffix), "%012llX", ESP.getEfuseMac()); deviceId = String("Multy-") + suffix;
  BLEDevice::init((String("Multy-ESP32S3-") + String(suffix).substring(6)).c_str()); BLEDevice::setMTU(247);
  server = BLEDevice::createServer(); server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE);
  auto command = service->createCharacteristic(COMMAND, BLECharacteristic::PROPERTY_WRITE); command->setCallbacks(new CommandCallbacks());
  output = service->createCharacteristic(OUTPUT_UUID, BLECharacteristic::PROPERTY_NOTIFY); output->addDescriptor(new BLE2902()); output->setCallbacks(new OutputCallbacks()); service->start();
  BLEAdvertisementData advertising, scan;
  advertising.setFlags(0x06); advertising.setCompleteServices(BLEUUID(SERVICE)); scan.setName((String("Multy-ESP32S3-") + String(suffix).substring(6)).c_str());
  auto ad = BLEDevice::getAdvertising(); ad->addServiceUUID(SERVICE); ad->setAdvertisementData(advertising); ad->setScanResponseData(scan); ad->setScanResponse(true); ad->start();
  xTaskCreate(worker, "multy-buses", 8192, nullptr, 1, nullptr); xTaskCreate(uartReceiver, "multy-uart", 6144, nullptr, 1, nullptr);
}
void loop() {
  // Bounded input work lets lease monitoring/output run even under input load.
  for (int count = 0; count < 512 && Serial.available(); ++count) parseByte(USB, Serial.read());
  BleInput input;
  for (int count = 0; count < 16 && xQueueReceive(bleInput, &input, 0) == pdTRUE; ++count) {
    if (input.kind == 1) {
      connId = input.id; mtu = 23; chunkBytes = 20; bleSeq = 0; parsers[BLE].reset();
      { Lock lock(stateLock); ++epochs[BLE]; linked[BLE] = true; }
    } else if (input.kind == 2) { dropLink(BLE); BLEDevice::startAdvertising(); }
    else if (input.kind == 3) mtu = max(static_cast<uint16_t>(23), input.length);
    else { bool connected; { Lock lock(stateLock); connected = linked[BLE]; } if (connected) for (size_t i = 0; i < input.length; ++i) parseByte(BLE, input.bytes[i]); }
  }
  if (ingressBroken || notifyBroken) { ingressBroken = notifyBroken = false; dropLink(BLE); }
  int expired = -1;
  { Lock lock(stateLock); if (owner >= 0 && millis() - heartbeatAt >= 20000) expired = owner; }
  if (expired >= 0) revoke(expired, true);
  for (uint8_t source = 0; source < 2; ++source) {
    bool broken; { Lock lock(outputLock); broken = outputBroken[source]; }
    if (broken) dropLink(source); else sendOutput(source);
  }
  delay(2);
}
