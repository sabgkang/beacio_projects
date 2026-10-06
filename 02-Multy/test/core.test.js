import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice, parseHex, formatBytes, formatUartInput, UART_ROW_BYTES, UART_MAX_ROW_BYTES } from '../public/core.js';

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

test('UART rows preserve 8 bytes and align printable ASCII and control bytes', () => {
  const bytes = [...Array(8)].map((_, i) => 65 + i).concat([0, 255, 32]);
  const rows = formatBytes(bytes, UART_ROW_BYTES);
  assert.equal(rows[0].hex.split(' ').length, 8);
  assert.equal(rows[0].ascii, 'ABCDEFGH');
  assert.equal(rows[1].ascii, '.. ');
  const editor = formatUartInput(rows.map(row => row.hex).join(' '));
  assert.equal(editor.text, rows.map(row => row.hex).join('\n'));
  assert.equal(editor.ascii, 'ABCDEFGH\n.. ');
  assert.deepEqual(parseHex(editor.text), bytes);
});

test('UART editing retains partial bytes and caret positions', () => {
  assert.deepEqual(formatUartInput('416', 3), { text: '41 6', ascii: 'A', caret: 4 });
  assert.equal(formatUartInput('41 42', 2).caret, 2);
  assert.equal(formatUartInput('GG'), null);
  assert.equal(formatUartInput('').text, '');
});

test('maximized UART uses 32-byte rows and restores 8-byte rows without changing data', () => {
  const bytes = Array.from({ length: 65 }, (_, i) => i);
  const input = bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
  const large = formatUartInput(input, input.length, UART_MAX_ROW_BYTES);
  assert.deepEqual(large.text.split('\n').map(row => row.replace(/ - /g, ' ').split(' ').length), [32, 32, 1]);
  assert.equal(large.ascii.split('\n')[0], '.'.repeat(32));
  assert.deepEqual(parseHex(large.text, true), bytes);
  const small = formatUartInput(large.text, large.caret, UART_ROW_BYTES);
  assert.equal(small.text.split('\n').length, 9);
  assert.deepEqual(parseHex(small.text), bytes);
  assert.equal(formatBytes(bytes, UART_MAX_ROW_BYTES)[1].ascii.length, 32);
});

test('maximized UART separates 8-byte groups and transmits only the original bytes', () => {
  const bytes = Array.from({ length: 256 }, (_, i) => i);
  const rows = formatBytes(bytes, UART_MAX_ROW_BYTES);
  assert.deepEqual(rows[0].hex.split(' - ').map(group => group.split(' ').length), [8, 8, 8, 8]);
  const text = rows.map(row => row.hex).join('\n');
  assert.equal(text.length, 815);
  assert.deepEqual(parseHex(text, true), bytes);
  assert.equal(formatUartInput(text, text.length, UART_MAX_ROW_BYTES).text, text);
  assert.equal(formatUartInput(text).text.includes('-'), false);
  assert.equal(formatBytes(bytes.slice(0, 8), UART_ROW_BYTES)[0].hex.includes('-'), false);
  assert.throws(() => parseHex('41 - 42'));
  assert.throws(() => parseHex('41-42', true));
});
