export function detectDevice(userAgent, platform, touchPoints = 0) {
  if (/iPhone|iPod/i.test(userAgent)) return 'iphone';
  if (/iPad/i.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1)) return 'tablet';
  if (/Android|Mobile/i.test(userAgent)) return 'mobile';
  return 'pc';
}

export function parseHex(input, allowGroups = false) {
  const compact = (allowGroups ? input.replace(/\s+-\s+/g, ' ') : input).replace(/\s+/g, '');
  if (!compact || !/^[0-9a-f]+$/i.test(compact) || compact.length % 2) {
    throw new Error('Enter complete hexadecimal bytes, for example 48 65 6C 6C 6F.');
  }
  if (compact.length > 512) throw new Error('Send up to 256 bytes at a time.');
  return compact.match(/.{2}/g).map(byte => parseInt(byte, 16));
}

export function formatBytes(bytes, columns = 5) {
  const lines = [];
  for (let index = 0; index < bytes.length; index += columns) {
    const row = bytes.slice(index, index + columns);
    lines.push({ hex: joinHexGroups(row.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()), columns), ascii: row.map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('') });
  }
  return lines;
}

export const UART_ROW_BYTES = 8;
export const UART_MAX_ROW_BYTES = 32;

function joinHexGroups(bytes, columns) {
  if (columns !== UART_MAX_ROW_BYTES) return bytes.join(' ');
  const groups = [];
  for (let index = 0; index < bytes.length; index += 8) groups.push(bytes.slice(index, index + 8).join(' '));
  return groups.join(' - ');
}

export function formatUartInput(value, caret = value.length, columns = UART_ROW_BYTES) {
  if (!/^[0-9a-f\s-]*$/i.test(value)) return null;
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  const nibbleCount = value.slice(0, caret).replace(/[\s-]/g, '').length;
  const rows = compact.match(new RegExp(`.{1,${columns * 2}}`, 'g')) || [];
  const text = rows.map(row => joinHexGroups(row.match(/.{1,2}/g), columns)).join('\n');
  let position = 0, seen = 0;
  while (position < text.length && seen < nibbleCount) {
    if (/[0-9A-F]/.test(text[position])) seen++;
    position++;
  }
  const ascii = rows.map(row => (row.match(/.{2}/g) || []).map(hex => {
    const byte = parseInt(hex, 16);
    return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
  }).join('')).join('\n');
  return { text, ascii, caret: position };
}
