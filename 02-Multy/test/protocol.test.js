import test from 'node:test';
import assert from 'node:assert/strict';
import { LineFramer, ProtocolClient, FrameWriter, ReceiveBuffer, encodeFrame, fromHex } from '../public/protocol.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('framer handles split UTF-8 and multiple frames, ignores only serial boot noise', () => {
  const frames = [], errors = [];
  const framer = new LineFramer({ onFrame: frame => frames.push(frame), onError: error => errors.push(error), ignoreNoise: true });
  const input = new TextEncoder().encode('ESP-ROM boot\r\n{"v":1,"text":"繁體"}\r\n{"v":1,"id":2}\n');
  for (const byte of input) framer.push([byte]);
  assert.deepEqual(frames, [{ v: 1, text: '繁體' }, { v: 1, id: 2 }]); assert.equal(errors.length, 0);
  framer.push(new TextEncoder().encode('{invalid}\n')); assert.equal(errors.length, 1);
});
test('oversized frames recover only at newline and incomplete JSON is never parsed', () => {
  const frames = [], errors = [];
  const framer = new LineFramer({ onFrame: frame => frames.push(frame), onError: error => errors.push(error) });
  framer.push(new TextEncoder().encode('{"v":')); assert.equal(frames.length, 0); assert.equal(errors.length, 0);
  framer.reset(); framer.push(new Uint8Array(2100).fill(65));
  framer.push(new TextEncoder().encode('\n{"v":1}\n')); assert.equal(errors.length, 1); assert.deepEqual(frames, [{ v: 1 }]);
});
test('responses correlate by id; errors and events stay distinct; BLE ack precedes resolution', async () => {
  const sent = [], events = [], acked = [];
  const client = new ProtocolClient({ write: async bytes => sent.push(JSON.parse(new TextDecoder().decode(bytes))), acknowledge: async seq => acked.push(seq), onEvent: frame => events.push(frame) });
  const pending = client.request('i2c.read'); await tick();
  client.framer.push(encodeFrame({ v: 1, id: sent[0].id, ok: false, error: { code: 'I2C_NACK', message: 'NACK' }, transportSeq: 1 }));
  await assert.rejects(pending, { code: 'I2C_NACK' }); assert.deepEqual(acked, [1]);
  client.framer.push(encodeFrame({ v: 1, event: 'uart.rx', data: '00', transportSeq: 2 })); await tick();
  assert.equal(events.length, 1); client.close();
});
test('timeout closes the session and never retries a write', async () => {
  let writes = 0, failures = 0;
  const client = new ProtocolClient({ write: async () => writes++, timeoutMs: 20, onFatal: () => failures++ });
  await assert.rejects(client.request('spi.write'), /not be retried/);
  assert.equal(writes, 1); assert.equal(failures, 1); assert.equal(client.pending.size, 0);
  await assert.rejects(client.request('spi.write'), /Disconnected/);
});
test('wrong version and missing BLE sequence reject pending requests', async () => {
  for (const frame of [{ v: 2, id: 1, ok: true }, { v: 1, id: 1, ok: true, transportSeq: 2 }]) {
    const client = new ProtocolClient({ write: async () => {}, acknowledge: async () => {} });
    const pending = client.request('hello'); client.framer.push(encodeFrame(frame));
    await assert.rejects(pending, /version|sequence/);
  }
});
test('priority ACK never interrupts a frame already being fragmented', async () => {
  const order = []; let release;
  const writer = new FrameWriter(async bytes => { order.push(bytes[0]); if (bytes[0] === 1) await new Promise(resolve => { release = resolve; }); });
  const first = writer.write([1]); const normal = writer.write([2]); const ack = writer.write([3], true);
  release(); await Promise.all([first, normal, ack]); assert.deepEqual(order, [1, 3, 2]);
});
test('receive retention drops oldest bytes and validates malformed hexadecimal', () => {
  const log = new ReceiveBuffer(4); log.append([1, 2, 3]); log.append([4, 5, 6]); assert.deepEqual(log.bytes, [3, 4, 5, 6]); assert.equal(log.dropped, 2);
  log.clear(); assert.equal(log.bytes.length, 0); assert.equal(log.dropped, 0);
  assert.throws(() => fromHex('ABC')); assert.deepEqual(fromHex('00FF'), [0, 255]);
});
