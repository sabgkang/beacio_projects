export const VERSION = 1;
export const MAX_FRAME = 2048;
export const UUID = Object.freeze({ service: '6d756c74-7900-4000-8000-000000000001', command: '6d756c74-7900-4000-8000-000000000002', output: '6d756c74-7900-4000-8000-000000000003' });
export const PINS = Object.freeze({ uart1: { TX: 17, RX: 18 }, uart2: { TX: 15, RX: 16 }, i2c1: { SDA: 4, SCL: 5 }, i2c2: { SDA: 6, SCL: 7 }, spi1: { SCK: 12, MOSI: 11, MISO: 13, CS: 10 }, spi2: { SCK: 8, MOSI: 9, MISO: 21, CS: 14 } });
export const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join('');
export function fromHex(hex = '') {
  if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('Invalid hexadecimal response.');
  return Array.from(hex.match(/../g) || [], byte => parseInt(byte, 16));
}
export function encodeFrame(message) {
  const bytes = new TextEncoder().encode(JSON.stringify(message) + '\n');
  if (bytes.length > MAX_FRAME) throw new Error('Protocol frame exceeds 2048 bytes.');
  return bytes;
}
// Byte framing handles fragmented UTF-8, CRLF and coalesced messages.
export class LineFramer {
  constructor({ onFrame, onError = () => {}, ignoreNoise = false } = {}) { Object.assign(this, { onFrame, onError, ignoreNoise }); this.reset(); }
  reset() { this.bytes = []; this.discarding = false; }
  push(chunk) {
    for (const byte of chunk) {
      if (byte === 10) {
        if (this.discarding) { this.reset(); continue; }
        const line = new Uint8Array(this.bytes); this.bytes = [];
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(line).trim();
          if (!text || (this.ignoreNoise && !text.startsWith('{'))) continue;
          const frame = JSON.parse(text);
          if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('Invalid protocol envelope.');
          this.onFrame(frame);
        } catch (error) { this.onError(error); }
      } else if (!this.discarding) {
        this.bytes.push(byte);
        if (this.bytes.length >= MAX_FRAME) { this.bytes = []; this.discarding = true; this.onError(new Error('Oversized protocol frame.')); }
      }
    }
  }
}
export class ProtocolError extends Error {
  constructor(code, message, response) { super(message); this.name = 'ProtocolError'; this.code = code; this.response = response; }
}
export class ProtocolClient {
  constructor({ write, acknowledge, onEvent = () => {}, onFatal = () => {}, timeoutMs = 10000, ignoreNoise = false }) {
    Object.assign(this, { write, acknowledge, onEvent, onFatal, timeoutMs });
    this.pending = new Map(); this.nextId = 1; this.closed = false; this.lastSeq = 0; this.receiving = Promise.resolve();
    this.framer = new LineFramer({ ignoreNoise, onFrame: frame => {
      this.receiving = this.receiving.then(() => this.receive(frame)).catch(error => this.fail(error));
    }, onError: error => this.fail(error) });
  }
  async receive(frame) {
    if (this.closed) return;
    if (frame.v !== VERSION) throw new Error('Unsupported Multy protocol version.');
    if (this.acknowledge) {
      if (!Number.isSafeInteger(frame.transportSeq) || frame.transportSeq !== this.lastSeq + 1) throw new Error('BLE sequence interrupted. Reconnect.');
      this.lastSeq = frame.transportSeq; await this.acknowledge(frame.transportSeq);
    }
    if (this.closed) return;
    if (frame.event) { this.onEvent(frame); return; }
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id); clearTimeout(pending.timer);
    if (frame.ok === true) pending.resolve(frame);
    else if (frame.ok === false && frame.error?.code) pending.reject(new ProtocolError(frame.error.code, frame.error.message, frame));
    else { pending.reject(new Error('Malformed response.')); throw new Error('Malformed response.'); }
  }
  request(op, fields = {}, priority = false) {
    if (this.closed) return Promise.reject(new Error('Disconnected.'));
    if (this.pending.size >= 8) return Promise.reject(new Error('Too many pending commands.'));
    const id = this.nextId++; let bytes;
    try { bytes = encodeFrame({ ...fields, v: VERSION, id, op }); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`${op} timed out. Outcome may be unknown; it will not be retried.`)), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      Promise.resolve().then(() => this.write(bytes, priority)).catch(error => this.fail(error));
    });
  }
  fail(error) { if (this.closed) return; this.close(error); this.onFatal(error); }
  close(error = new Error('Disconnected.')) {
    this.closed = true; this.framer.reset();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
// Priority changes order only between whole frames, never between fragments.
export class FrameWriter {
  constructor(send) { this.send = send; this.queue = []; this.running = false; this.closed = false; }
  write(bytes, priority = false) {
    if (this.closed) return Promise.reject(new Error('Writer closed.'));
    if (this.queue.length >= 16) return Promise.reject(new Error('Write queue full.'));
    return new Promise((resolve, reject) => {
      const item = { bytes, resolve, reject, priority };
      const index = priority ? this.queue.findIndex(entry => !entry.priority) : -1;
      if (index < 0) this.queue.push(item); else this.queue.splice(index, 0, item);
      this.drain();
    });
  }
  async drain() {
    if (this.running) return; this.running = true;
    try {
      while (this.queue.length && !this.closed) {
        const item = this.queue.shift();
        try { await this.send(item.bytes); item.resolve(); } catch (error) { item.reject(error); this.close(error); }
      }
    } finally { this.running = false; }
  }
  close(error = new Error('Writer closed.')) { this.closed = true; for (const item of this.queue.splice(0)) item.reject(error); }
}
export class ReceiveBuffer {
  constructor(limit = 65536) { this.limit = limit; this.bytes = []; this.dropped = 0; }
  append(bytes) { const merged = [...this.bytes, ...bytes]; const excess = Math.max(0, merged.length - this.limit); this.dropped += excess; this.bytes = merged.slice(excess); }
  clear() { this.bytes = []; this.dropped = 0; }
}
