import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice, parseHex, formatBytes } from '../public/core.js';
import { DemoTransport } from '../public/transport.js';

test('hex parsing accepts bytes and rejects malformed or excessive input', () => {
  assert.deepEqual(parseHex('48 65\n6c6F'), [72, 101, 108, 111]);
  for (const input of ['', 'A', 'GG', '0x48', 'AA '.repeat(257)]) assert.throws(() => parseHex(input));
  assert.equal(formatBytes([0x3C, 0, 0xFF])[0].ascii, '<..');
});
test('detects iPhone, iPad desktop agent, Android, and PC', () => {
  assert.equal(detectDevice('Mozilla iPhone', 'iPhone', 5), 'iphone');
  assert.equal(detectDevice('Mozilla Macintosh', 'MacIntel', 5), 'tablet');
  assert.equal(detectDevice('Mozilla Android Mobile', 'Linux', 5), 'mobile');
  assert.equal(detectDevice('Mozilla Windows NT', 'Win32', 0), 'pc');
});
test('demo transport requires connection and has independent read/write behavior', async () => {
  const transport = new DemoTransport();
  await assert.rejects(transport.exchange({ protocol: 'uart' }), /Connect/);
  await transport.connect('serial');
  assert.deepEqual(await transport.exchange({ protocol: 'uart', bytes: [72] }), [72, 13, 10]);
  assert.deepEqual(await transport.exchange({ protocol: 'i2c', action: 'write', bytes: [1] }), []);
  assert.equal((await transport.exchange({ protocol: 'i2c', action: 'read' })).length, 8);
  const pending = transport.exchange({ protocol: 'spi', bytes: [159] });
  await transport.disconnect();
  await assert.rejects(pending, /Disconnected/);
});
