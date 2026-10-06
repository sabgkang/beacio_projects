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
