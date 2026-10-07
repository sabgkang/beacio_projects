import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IOSBleTransport } from '../public/ios-ble.js';
import { UUID } from '../public/protocol.js';
import { fakeBle } from '../test-support/mock-device.js';

const name = 'Multy-ESP32S3-020F3C';
test('iOS scanned-device click authorizes the exact name in the gesture then connects, claims, operates and releases', async () => {
  const mock = fakeBle({ mtu: 23 }); mock.device.name = name;
  let options;
  const transport = new IOSBleTransport({ secure: true, crypto: webcrypto, getBluetooth: () => ({ requestDevice(value) { options = value; return Promise.resolve(mock.device); } }) });
  const connection = transport.connectScanned({ name });
  assert.deepEqual(options, { filters: [{ name }], optionalServices: [UUID.service] });
  assert.equal(transport.state, 'Authorizing selected Multy device');
  await connection; assert.equal(transport.connected, true);
  assert.deepEqual(transport.history.map(item => item.state), ['Authorizing selected Multy device', 'Connecting BLE GATT', 'Discovering BLE service', 'Subscribing BLE notifications', 'Handshaking', 'Connected']);
  assert.ok(mock.peer.requests.some(item => item.op === 'session.claim'));
  const result = await transport.exchange({ protocol: 'spi', instance: 1, action: 'write', bytes: [65] });
  assert.deepEqual(result.bytes, [65]);
  await transport.disconnect(); assert.equal(mock.device.gatt.connected, false);
  assert.ok(mock.peer.requests.some(item => item.op === 'session.release'));
});

test('iOS authorization timeout remains distinct and sends no hardware commands', async () => {
  const transport = new IOSBleTransport({ secure: true, pickerTimeoutMs: 10, getBluetooth: () => ({ requestDevice: () => new Promise(() => {}) }) });
  await assert.rejects(transport.connectScanned({ name }), /裝置授權未完成/);
  assert.match(transport.state, /requestDevice 尚未回應/); assert.equal(transport.isOpen, false);
});

test('iOS GATT timeout disconnects late connection and does not claim control', async () => {
  const mock = fakeBle(); mock.device.name = name; let complete;
  mock.device.gatt.connect = () => new Promise(resolve => { complete = () => { mock.device.gatt.connected = true; resolve(mock.device.gatt); }; });
  const transport = new IOSBleTransport({ secure: true, gattTimeoutMs: 10, getBluetooth: () => mock.bluetooth });
  await assert.rejects(transport.connectScanned({ name }), /GATT connection timed out/);
  complete(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(mock.device.gatt.connected, false); assert.equal(mock.peer.requests.length, 0);
});

test('iOS refuses unselected or mismatched device, and authorization cancellation does not connect', async () => {
  const mock = fakeBle(); let requests = 0;
  const transport = new IOSBleTransport({ secure: true, getBluetooth: () => ({ requestDevice() { requests++; return Promise.resolve({ ...mock.device, name: 'Other BLE' }); } }) });
  await assert.rejects(transport.connect(), /先 Scan/);
  await assert.rejects(transport.connectScanned({ name: 'Other BLE' }), /掃描清單/);
  assert.equal(requests, 0);
  await assert.rejects(transport.connectScanned({ name }), /名稱.*不符/);
  assert.equal(mock.device.gatt.connected, false);
  const cancelled = new IOSBleTransport({ secure: true, getBluetooth: () => ({ requestDevice() { throw new DOMException('Cancelled', 'NotFoundError'); } }) });
  await assert.rejects(cancelled.connectScanned({ name }), { name: 'NotFoundError' });
  assert.equal(cancelled.isOpen, false);
});

test('iOS service discovery failure closes GATT and keeps the failed stage', async () => {
  const mock = fakeBle(); mock.device.name = name;
  mock.device.gatt.getPrimaryService = async () => { throw new Error('Multy service not granted'); };
  const transport = new IOSBleTransport({ secure: true, getBluetooth: () => mock.bluetooth });
  await assert.rejects(transport.connectScanned({ name }), /not granted/);
  assert.equal(transport.history.at(-2).state, 'Discovering BLE service');
  assert.equal(mock.device.gatt.connected, false); assert.equal(mock.peer.requests.length, 0);
});
