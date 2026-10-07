import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IOSBleTransport } from '../public/ios-ble.js';
import { fakeBle } from '../test-support/mock-device.js';

const name = 'Multy-ESP32S3-020F3C';
test('iOS connects the exact scanned object without a picker, then claims, operates and releases', async () => {
  const mock = fakeBle({ mtu: 23 }); mock.device.name = name;
  const transport = new IOSBleTransport({ secure: true, crypto: webcrypto, getBluetooth: () => { throw new Error('Browser picker must not be called'); } });
  const connection = transport.connectScanned({ name, device: mock.device });
  assert.equal(transport.state, 'Using scanned Multy device');
  await connection; assert.equal(transport.connected, true);
  assert.equal(transport.device, mock.device);
  assert.deepEqual(transport.history.map(item => item.state), ['Using scanned Multy device', 'Connecting BLE GATT', 'Discovering BLE service', 'Subscribing BLE notifications', 'Handshaking', 'Connected']);
  assert.ok(mock.peer.requests.some(item => item.op === 'session.claim'));
  const result = await transport.exchange({ protocol: 'spi', instance: 1, action: 'write', bytes: [65] });
  assert.deepEqual(result.bytes, [65]);
  await transport.disconnect(); assert.equal(mock.device.gatt.connected, false);
  assert.ok(mock.peer.requests.some(item => item.op === 'session.release'));
});

test('iOS reports GATT permission denial without retrying a picker or claiming control', async () => {
  const mock = fakeBle(); mock.device.name = name;
  mock.device.gatt.connect = () => { throw new DOMException('Access denied', 'SecurityError'); };
  const transport = new IOSBleTransport({ secure: true });
  await assert.rejects(transport.connectScanned({ name, device: mock.device }), /GATT.*權限遭拒/);
  assert.match(transport.state, /未重新呼叫 requestDevice/); assert.equal(transport.isOpen, false);
  assert.equal(mock.peer.requests.length, 0);
});

test('iOS GATT timeout disconnects late connection and does not claim control', async () => {
  const mock = fakeBle(); mock.device.name = name; let complete;
  mock.device.gatt.connect = () => new Promise(resolve => { complete = () => { mock.device.gatt.connected = true; resolve(mock.device.gatt); }; });
  const transport = new IOSBleTransport({ secure: true, gattTimeoutMs: 10, getBluetooth: () => mock.bluetooth });
  await assert.rejects(transport.connectScanned({ name, device: mock.device }), /GATT connection timed out/);
  complete(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(mock.device.gatt.connected, false); assert.equal(mock.peer.requests.length, 0);
});

test('iOS refuses unselected, missing or mismatched scanned objects without connecting', async () => {
  const mock = fakeBle();
  const transport = new IOSBleTransport({ secure: true });
  await assert.rejects(transport.connect(), /先 Scan/);
  await assert.rejects(transport.connectScanned({ name: 'Other BLE' }), /掃描清單/);
  await assert.rejects(transport.connectScanned({ name }), /沒有可連線/);
  await assert.rejects(transport.connectScanned({ name, device: { ...mock.device, name: 'Other BLE' } }), /名稱.*不符/);
  assert.equal(mock.device.gatt.connected, false);
});

test('iOS service discovery failure closes GATT and keeps the failed stage', async () => {
  const mock = fakeBle(); mock.device.name = name;
  mock.device.gatt.getPrimaryService = async () => { throw new Error('Multy service not granted'); };
  const transport = new IOSBleTransport({ secure: true, getBluetooth: () => mock.bluetooth });
  await assert.rejects(transport.connectScanned({ name, device: mock.device }), /not granted/);
  assert.equal(transport.history.at(-2).state, 'Discovering BLE service');
  assert.equal(mock.device.gatt.connected, false); assert.equal(mock.peer.requests.length, 0);
});
