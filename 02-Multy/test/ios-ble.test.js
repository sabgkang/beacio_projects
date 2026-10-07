import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IOSBleTransport } from '../public/ios-ble.js';
import { fakeBle } from '../test-support/mock-device.js';
import { getIOSBluetooth } from '../public/ios-bluetooth.js';
import { UUID } from '../public/protocol.js';

test('iOS API selector prefers the real Beacio extension, excludes stubs and preserves native fallback', () => {
  const bluetooth = {}, beacio = { __beacio: true, requestDevice() {} };
  assert.equal(getIOSBluetooth({ bluetooth, beacio }), beacio);
  assert.equal(getIOSBluetooth({ bluetooth }), bluetooth);
  assert.equal(getIOSBluetooth({ bluetooth: { __beacioCDNStub: true } }), null);
});

const name = 'Multy-ESP32S3-020F3C';
test('iOS authorizes through Beacio in the click gesture before GATT, then claims, operates and releases', async () => {
  const mock = fakeBle({ mtu: 23 }); mock.device.name = name;
  let options;
  const api = { __beacio: true, requestDevice(value) { options = value; return Promise.resolve(mock.device); } };
  const transport = new IOSBleTransport({ secure: true, crypto: webcrypto, getBluetooth: () => getIOSBluetooth({ beacio: api, bluetooth: { requestDevice() { throw new Error('Wrong facade'); } } }) });
  const scanned = { name, gatt: { connect() { throw new Error('Scanned object must never connect'); } } };
  const connection = transport.connectScanned({ name, device: scanned });
  assert.deepEqual(options, { acceptAllDevices: true, optionalServices: ['battery_service', 'device_information', 'generic_access', 'heart_rate', 0x180f, 0x180a, UUID.service] });
  assert.equal(transport.state, 'Authorizing Multy via navigator.beacio');
  assert.equal(mock.device.gatt.connected, false);
  await connection; assert.equal(transport.connected, true);
  assert.equal(transport.device, mock.device);
  assert.deepEqual(transport.history.map(item => item.state), ['Authorizing Multy via navigator.beacio', 'Connecting BLE GATT', 'Discovering BLE service', 'Subscribing BLE notifications', 'Handshaking', 'Connected']);
  assert.ok(mock.peer.requests.some(item => item.op === 'session.claim'));
  const result = await transport.exchange({ protocol: 'spi', instance: 1, action: 'write', bytes: [65] });
  assert.deepEqual(result.bytes, [65]);
  await transport.disconnect(); assert.equal(mock.device.gatt.connected, false);
  assert.ok(mock.peer.requests.some(item => item.op === 'session.release'));
});

test('iOS reports GATT permission denial without retrying or claiming control', async () => {
  const mock = fakeBle(); mock.device.name = name;
  mock.device.gatt.connect = () => { throw new DOMException('Access denied', 'SecurityError'); };
  const transport = new IOSBleTransport({ secure: true, getBluetooth: () => mock.bluetooth });
  await assert.rejects(transport.connectScanned({ name, device: mock.device }), /GATT.*權限遭拒/);
  assert.match(transport.state, /權限遭拒/); assert.equal(transport.isOpen, false);
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

test('iOS refuses invalid selection and mismatched authorized objects without connecting', async () => {
  const mock = fakeBle();
  const transport = new IOSBleTransport({ secure: true, getBluetooth: () => ({ requestDevice: async () => ({ ...mock.device, name: 'Other BLE' }) }) });
  await assert.rejects(transport.connect(), /先 Scan/);
  await assert.rejects(transport.connectScanned({ name: 'Other BLE' }), /掃描清單/);
  await assert.rejects(transport.connectScanned({ name }), /名稱不符/);
  assert.equal(mock.device.gatt.connected, false);
});

test('iOS stalled authorization never attempts GATT on the scanned object', async () => {
  const mock = fakeBle();
  const transport = new IOSBleTransport({ secure: true, pickerTimeoutMs: 10, getBluetooth: () => ({ __beacio: true, requestDevice: () => new Promise(() => {}) }) });
  await assert.rejects(transport.connectScanned({ name, device: mock.device }), /navigator.beacio 沒有回應/);
  assert.equal(mock.device.gatt.connected, false); assert.equal(mock.peer.requests.length, 0);
});

test('iOS unfiltered chooser rejects an unnamed device or another Multy before GATT', async () => {
  for (const selectedName of [undefined, 'Multy-ESP32S3-OTHER']) {
    const mock = fakeBle(); mock.device.name = selectedName;
    const transport = new IOSBleTransport({ secure: true, getBluetooth: () => mock.bluetooth });
    await assert.rejects(transport.connectScanned({ name }), /名稱不符/);
    assert.equal(mock.device.gatt.connected, false);
    assert.equal(mock.peer.requests.length, 0);
  }
});

test('iOS service discovery failure closes GATT and keeps the failed stage', async () => {
  const mock = fakeBle(); mock.device.name = name;
  mock.device.gatt.getPrimaryService = async () => { throw new Error('Multy service not granted'); };
  const transport = new IOSBleTransport({ secure: true, getBluetooth: () => mock.bluetooth });
  await assert.rejects(transport.connectScanned({ name, device: mock.device }), /not granted/);
  assert.equal(transport.history.at(-2).state, 'Discovering BLE service');
  assert.equal(mock.device.gatt.connected, false); assert.equal(mock.peer.requests.length, 0);
});
