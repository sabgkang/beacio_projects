import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialTransport, serialOptions } from '../public/transport.js';
import { fakeSerial } from '../test-support/mock-device.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('picker runs in the gesture; fixed host settings, handshake and target exchange use real streams', async () => {
  const mock = fakeSerial(); const transport = new SerialTransport({ serial: mock.serial, secure: true });
  const connecting = transport.connect(); assert.deepEqual(mock.calls, [['picker']]); await connecting;
  assert.deepEqual(mock.calls[1], ['open', serialOptions()]); assert.equal(transport.connected, true); assert.equal(transport.state, 'Connected');
  assert.deepEqual(mock.peer.requests.slice(0, 3).map(request => request.op), ['hello', 'session.claim', 'hello']);
  const result = await transport.exchange({ protocol: 'i2c', instance: 2, action: 'read', settings: { address: 60, clockHz: 400000 }, length: 4 });
  assert.deepEqual(result.bytes, [0, 0, 0, 0]); assert.equal(mock.peer.requests.at(-1).channel, 2);
  await transport.disconnect(); assert.equal(transport.connected, false); assert.equal(mock.port.readable.locked, false); assert.equal(mock.port.writable.locked, false);
  assert.equal(mock.peer.requests.at(-1).op, 'session.release'); assert.deepEqual(mock.calls.at(-1), ['close']);
});
test('busy connection cannot operate targets but can be closed', async () => {
  const mock = fakeSerial({ busy: true }); const transport = new SerialTransport({ serial: mock.serial, secure: true });
  await transport.connect(); assert.equal(transport.state, 'Busy'); assert.equal(transport.connected, false); assert.equal(transport.isOpen, true);
  await assert.rejects(transport.exchange({ protocol: 'uart', action: 'write' }), /Acquire/); await transport.disconnect();
});
test('picker cancellation/open failures and unavailable browser leave no claimed connection', async () => {
  const mock = fakeSerial(); const transport = new SerialTransport({ serial: mock.serial, secure: true });
  mock.serial.requestPort = () => Promise.reject(Object.assign(new Error('Cancelled'), { name: 'NotFoundError' }));
  await assert.rejects(transport.connect(), { name: 'NotFoundError' }); assert.equal(transport.isOpen, false);
  await assert.rejects(new SerialTransport({ serial: null, secure: true }).connect(), /Chrome/);
  await assert.rejects(new SerialTransport({ serial: mock.serial, secure: false }).connect(), /HTTPS/);
  assert.deepEqual(serialOptions({ baud: '9600', databits: '9' }), { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
});
test('unplug rejects commands, closes streams and reports ended session', async () => {
  const mock = fakeSerial(); let disconnected = 0;
  const transport = new SerialTransport({ serial: mock.serial, secure: true, onDisconnect: () => disconnected++ });
  await transport.connect(); mock.serial.disconnect({ port: mock.port });
  for (let i = 0; i < 10 && !disconnected; i++) await tick();
  assert.equal(disconnected, 1); assert.equal(transport.connected, false); assert.equal(transport.isOpen, false);
  assert.equal(mock.port.readable.locked, false); assert.equal(mock.port.writable.locked, false);
});
