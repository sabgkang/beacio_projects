import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { BleTransport } from '../public/transport.js';
import { fakeBle } from '../test-support/mock-device.js';

test('BLE probes MTU payload with no bus operations, ACKs every response and transfers 256 bytes', async () => {
  const mock = fakeBle(); const events = [];
  const transport = new BleTransport({ bluetooth: mock.bluetooth, secure: true, crypto: webcrypto, onEvent: frame => events.push(frame) });
  await transport.connect(); assert.equal(transport.connected, true); assert.equal(transport.chunkBytes, 244);
  assert.deepEqual(mock.peer.requests.filter(request => request.op === 'transport.probe').map(request => request.chunkBytes), [64, 128, 244]);
  const bytes = Array.from({ length: 256 }, (_, index) => index);
  const result = await transport.exchange({ protocol: 'spi', instance: 1, action: 'write', bytes, settings: { clockHz: 1000000, mode: 0 } });
  assert.deepEqual(result.bytes, bytes); assert.ok(mock.writes.includes(244));
  assert.equal(mock.acknowledgements.length, mock.peer.requests.length);
  await transport.disconnect(); assert.equal(mock.device.gatt.connected, false);
});
test('minimum MTU keeps 20-byte mode without probing', async () => {
  const mock = fakeBle({ mtu: 23 }); const transport = new BleTransport({ bluetooth: mock.bluetooth, secure: true, crypto: webcrypto });
  await transport.connect(); assert.equal(transport.chunkBytes, 20); assert.ok(mock.writes.every(length => length <= 20));
  assert.equal(mock.peer.requests.some(request => request.op === 'transport.probe'), false); await transport.disconnect();
});
test('failed large write closes session; next user connection uses compatibility mode without replay', async () => {
  const mock = fakeBle({ rejectAbove: 20 });
  const transport = new BleTransport({ bluetooth: mock.bluetooth, secure: true, crypto: webcrypto });
  await assert.rejects(transport.connect(), /rejected/); assert.equal(transport.isOpen, false); assert.equal(mock.device.gatt.connected, false);
  // A fresh GATT stream resets sequence/reassembly; use the same stable device id.
  const reconnect = fakeBle({ rejectAbove: 20 }); transport.bluetooth = reconnect.bluetooth;
  await transport.connect(); assert.equal(transport.chunkBytes, 20); assert.equal(transport.connected, true);
  assert.equal(reconnect.peer.requests.some(request => request.op === 'transport.probe'), false);
  await transport.disconnect();
});
test('BLE unavailable or insecure explains Beacio/HTTPS and never opens picker', async () => {
  await assert.rejects(new BleTransport({ bluetooth: null, secure: true }).connect(), /Beacio/);
  await assert.rejects(new BleTransport({ bluetooth: null, secure: false }).connect(), /HTTPS/);
});

test('late Beacio API is resolved at click time and picker stays in the user gesture', async () => {
  let api;
  const mock = fakeBle(); let clicked = false, options;
  const transport = new BleTransport({ getBluetooth: () => api, secure: true, crypto: webcrypto });
  api = { requestDevice(value) { clicked = true; options = value; return mock.bluetooth.requestDevice(value); } };
  const connecting = transport.connect();
  assert.equal(clicked, true);
  assert.deepEqual(options.optionalServices, [options.filters[0].services[0]]);
  await connecting; assert.equal(transport.connected, true); await transport.disconnect();
});

test('stalled picker times out with an actionable stage error and no bus commands', async () => {
  const states = [];
  const transport = new BleTransport({ bluetooth: { requestDevice: () => new Promise(() => {}) }, secure: true, pickerTimeoutMs: 15, onState: state => states.push(state) });
  await assert.rejects(transport.connect(), /BLE picker.*Beacio/);
  assert.equal(transport.isOpen, false); assert.match(states.at(-1), /^Error: BLE picker/);
});

test('synchronous picker failures reset state and allow the next click', async () => {
  const transport = new BleTransport({ bluetooth: { requestDevice() { throw new Error('Permission denied'); } }, secure: true });
  await assert.rejects(transport.connect(), /Permission denied/);
  assert.match(transport.state, /^Error: Permission denied/);
  const mock = fakeBle({ mtu: 23 }); transport.bluetooth = mock.bluetooth;
  await transport.connect(); await transport.disconnect();
});

test('late GATT connection after timeout is disconnected and never starts a handshake', async () => {
  const mock = fakeBle(); let finishConnection;
  mock.device.gatt.connect = () => new Promise(resolve => { finishConnection = () => { mock.device.gatt.connected = true; resolve(mock.device.gatt); }; });
  const transport = new BleTransport({ bluetooth: mock.bluetooth, secure: true, gattTimeoutMs: 15 });
  await assert.rejects(transport.connect(), /GATT connection timed out/);
  finishConnection(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(mock.device.gatt.connected, false);
  assert.equal(mock.peer.requests.length, 0);
});
