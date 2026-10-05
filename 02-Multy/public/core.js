export function detectDevice(userAgent, platform, touchPoints = 0) {
  if (/iPhone|iPod/i.test(userAgent)) return 'iphone';
  if (/iPad/i.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1)) return 'tablet';
  if (/Android|Mobile/i.test(userAgent)) return 'mobile';
  return 'pc';
}

export function parseHex(input) {
  const compact = input.replace(/\s+/g, '');
  if (!compact || !/^[0-9a-f]+$/i.test(compact) || compact.length % 2) {
    throw new Error('Enter complete hexadecimal bytes, for example 48 65 6C 6C 6F.');
  }
  if (compact.length > 512) throw new Error('Send up to 256 bytes at a time.');
  return compact.match(/.{2}/g).map(byte => parseInt(byte, 16));
}

export function formatBytes(bytes) {
  const lines = [];
  for (let index = 0; index < bytes.length; index += 5) {
    const row = bytes.slice(index, index + 5);
    lines.push({ hex: row.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '), ascii: row.map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('') });
  }
  return lines;
}
