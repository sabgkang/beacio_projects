import test from 'node:test';
import assert from 'node:assert/strict';
import { MultyScanner } from '../public/ble-scan.js';

class ScanAPI extends EventTarget {
  requestDevice() { throw new Error('Scan must not open a device picker'); }
  emit(name, id, rssi) {
    const event = new Event('advertisementreceived');
    Object.assign(event, { name, device: { id, get gatt() { throw new Error('Scan must not access GATT'); } }, rssi });
    this.dispatchEvent(event);
  }
}

test('scan runs in the gesture, lists only Multy names and deduplicates advertisements without selecting or connecting', async () => {
  const api = new ScanAPI(); let called = false, stopped = 0;
  api.requestLEScan = options => { called = true; assert.deepEqual(options, { acceptAllAdvertisements: true, keepRepeatedDevices: true }); return Promise.resolve({ stop() { stopped++; } }); };
  const scanner = new MultyScanner({ getBluetooth: () => api });
  const start = scanner.start(); assert.equal(called, true); await start;
  api.emit('Other BLE', 'a', -50); api.emit('Multy-ESP32S3-020F3C', 'b', -65); api.emit('Multy-ESP32S3-020F3C', 'b', -60);
  api.emit('My-multy-board', 'c', undefined);
  assert.equal(scanner.advertisements, 4); assert.equal(scanner.devices.size, 2);
  assert.equal(scanner.devices.get('b').rssi, -60); assert.equal(scanner.devices.get('c').rssi, null);
  scanner.stop(); assert.equal(stopped, 1); api.emit('Multy-late', 'd', -40);
  assert.equal(scanner.advertisements, 4); assert.equal(scanner.busy, false);
});

test('timed-out or manually cancelled scan stops a handle that arrives later', async () => {
  for (const cancel of ['timeout', 'stop']) {
    const api = new ScanAPI(); let resolveScan, stopped = 0;
    api.requestLEScan = () => new Promise(resolve => { resolveScan = resolve; });
    let finished;
    const ended = new Promise(resolve => { finished = resolve; });
    const scanner = new MultyScanner({ getBluetooth: () => api, startTimeoutMs: 10, onChange: value => { if (!value.busy) finished(); } });
    const start = scanner.start(); if (cancel === 'stop') scanner.stop(); await ended;
    assert.equal(scanner.state, cancel === 'timeout' ? 'error' : 'complete');
    resolveScan({ stop() { stopped++; } }); await start; assert.equal(stopped, 1);
    api.emit('Multy-late', 'a', -30); assert.equal(scanner.devices.size, 0);
  }
});

test('scan auto-stops and reports unsupported or denied API without falling back to device selection', async () => {
  const api = new ScanAPI(); let stopped = 0;
  api.requestLEScan = async () => ({ stop() { stopped++; } });
  let finished; const ended = new Promise(resolve => { finished = resolve; });
  const scanner = new MultyScanner({ getBluetooth: () => api, durationMs: 10, onChange: value => { if (value.state === 'complete') finished(); } });
  await scanner.start(); await ended; assert.equal(stopped, 1);
  delete api.requestLEScan; await scanner.start(); assert.match(scanner.message, /未提供 requestLEScan/);
  api.requestLEScan = () => { throw new Error('Permission denied'); }; await scanner.start();
  assert.match(scanner.message, /Permission denied/); assert.equal(scanner.busy, false);
});
