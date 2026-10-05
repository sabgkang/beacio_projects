import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialTransport, serialOptions } from '../public/transport.js';

const settings = { baud: '115200', databits: '8', parity: 'N', stop: '1' };
function fakeSerial() {
  const calls = [];
  const port = {
    async open(options) { calls.push(['open', options]); },
    async close() { calls.push(['close']); },
    getInfo() { return { usbVendorId: 0x303A, usbProductId: 0x1001 }; }
  };
  const serial = {
    requestPort() { calls.push(['picker']); return Promise.resolve(port); },
    addEventListener(type, callback) { this.disconnect = callback; }
  };
  return { serial, port, calls };
}

test('opens the browser picker immediately, then opens 115200 8N1 and closes the selected port', async () => {
  const { serial, calls } = fakeSerial();
  const transport = new SerialTransport({ serial, secure: true });
  const pending = transport.connect(settings);
  assert.deepEqual(calls, [['picker']]);
  assert.equal(transport.connected, false);
  await pending;
  assert.deepEqual(calls[1], ['open', { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' }]);
  assert.equal(transport.connected, true);
  assert.equal(transport.label, 'USB 303A:1001');
  await assert.rejects(transport.exchange({ protocol: 'uart', bytes: [1] }), /firmware protocol/);
  await transport.disconnect();
  assert.equal(transport.connected, false);
  assert.equal(transport.port, null);
  assert.equal(transport.label, 'Select in Chrome');
  assert.deepEqual(calls.at(-1), ['close']);
});

test('cancelling the picker or failing to open leaves the app disconnected', async () => {
  const { serial, port } = fakeSerial();
  const transport = new SerialTransport({ serial, secure: true });
  const cancellation = Object.assign(new Error('Cancelled'), { name: 'NotFoundError' });
  serial.requestPort = () => Promise.reject(cancellation);
  await assert.rejects(transport.connect(settings), { name: 'NotFoundError' });
  assert.equal(transport.connected, false);
  serial.requestPort = () => Promise.resolve(port);
  port.open = async () => { throw new Error('Port busy'); };
  await assert.rejects(transport.connect(settings), /Port busy/);
  assert.equal(transport.connected, false);
  assert.equal(transport.port, null);
});

test('unsupported browser, insecure origin, or incompatible UART settings fail without opening the picker', async () => {
  await assert.rejects(new SerialTransport({ serial: null, secure: true }).connect(settings), /unavailable/);
  const { serial, calls } = fakeSerial();
  await assert.rejects(new SerialTransport({ serial, secure: false }).connect(settings), /HTTPS or localhost/);
  for (const change of [{ databits: '9' }, { stop: '0' }, { parity: 'Y' }, { baud: 'invalid' }]) {
    assert.throws(() => serialOptions({ ...settings, ...change }));
  }
  assert.deepEqual(calls, []);
});

test('unplug updates connection state and a failed close does not claim success', async () => {
  const { serial, port } = fakeSerial();
  let unplugged = 0;
  const transport = new SerialTransport({ serial, secure: true, onDisconnect: () => unplugged++ });
  await transport.connect(settings);
  port.close = async () => { throw new Error('Close failed'); };
  await assert.rejects(transport.disconnect(), /Close failed/);
  assert.equal(transport.connected, true);
  serial.disconnect({ target: {} });
  assert.equal(unplugged, 0);
  serial.disconnect({ target: port });
  assert.equal(transport.connected, false);
  assert.equal(transport.port, null);
  assert.equal(unplugged, 1);
});
