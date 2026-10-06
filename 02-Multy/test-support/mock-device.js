import { createHash } from 'node:crypto';
import { LineFramer, UUID, encodeFrame, fromHex } from '../public/protocol.js';

// Test-only peripheral; kept outside public/ and outside Node test discovery.
export function firmware({ busy = false, mtu = 247 } = {}) {
  const requests = []; let claimed = false;
  return { requests, respond(request) {
    requests.push(request);
    const response = { v: 1, id: request.id, ok: true };
    if (request.op === 'hello') Object.assign(response, { protocol: 1, maxBytes: 256, deviceId: 'test-esp32', firmware: '1.0.0', owner: claimed ? 'usb' : 'none', ble: { mtu, maxChunkBytes: mtu - 3, chunkBytes: 20 }, uart: [1, 2].map(() => ({ baud: 115200, dataBits: 8, parity: 'none', stopBits: 1 })) });
    else if (request.op === 'session.claim') { if (busy) Object.assign(response, { ok: false, error: { code: 'DEVICE_BUSY', message: 'Busy' } }); else claimed = true; }
    else if (request.op === 'session.release') claimed = false;
    else if (request.op === 'transport.probe') Object.assign(response, { data: request.data, count: fromHex(request.data).length, sha256: createHash('sha256').update(Buffer.from(request.data, 'hex')).digest('hex').toUpperCase() });
    else if (!claimed) Object.assign(response, { ok: false, error: { code: 'DEVICE_BUSY', message: 'Busy' } });
    else if (request.op === 'i2c.read') Object.assign(response, { data: '00'.repeat(request.length), count: request.length });
    else if (request.op.endsWith('.write')) Object.assign(response, { count: request.data.length / 2, ...(request.op.startsWith('spi') ? { data: request.data } : {}) });
    return response;
  } };
}

export function fakeSerial(options) {
  const peer = firmware(options), calls = []; let input;
  const readable = new ReadableStream({ start(controller) { input = controller; } });
  const parser = new LineFramer({ onFrame: request => {
    const bytes = encodeFrame(peer.respond(request));
    input.enqueue(bytes.slice(0, 7)); input.enqueue(bytes.slice(7));
  } });
  const writable = new WritableStream({ write(bytes) { parser.push(bytes); } });
  const port = { readable, writable, async open(settings) { calls.push(['open', settings]); input.enqueue(new TextEncoder().encode('ESP-ROM boot\n')); }, async close() { calls.push(['close']); }, getInfo() { return { usbVendorId: 0x10C4, usbProductId: 0xEA60 }; } };
  const serial = { requestPort() { calls.push(['picker']); return Promise.resolve(port); }, addEventListener(type, callback) { this.disconnect = callback; } };
  return { peer, calls, port, serial, input };
}

export function fakeBle({ mtu = 247, rejectAbove = Infinity, busy = false } = {}) {
  const peer = firmware({ mtu, busy }), writes = [], acknowledgements = []; let changed, lost, seq = 0;
  const output = {
    addEventListener(type, callback) { changed = callback; }, removeEventListener() { changed = null; }, async startNotifications() {},
    send(frame) {
      const bytes = encodeFrame({ ...frame, transportSeq: ++seq });
      for (let offset = 0; offset < bytes.length; offset += mtu - 3) {
        const chunk = bytes.slice(offset, offset + mtu - 3);
        changed?.({ target: { value: new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength) } });
      }
    }
  };
  const parser = new LineFramer({ onFrame: request => {
    if (request.op === 'transport.ack') acknowledgements.push(request.seq);
    else output.send(peer.respond(request));
  } });
  const command = { async writeValueWithResponse(bytes) { writes.push(bytes.length); if (bytes.length > rejectAbove) throw new Error('GATT payload rejected'); parser.push(bytes); } };
  const service = { async getCharacteristic(uuid) { return uuid === UUID.command ? command : output; } };
  const gatt = { connected: false, async connect() { this.connected = true; return this; }, async getPrimaryService() { return service; }, disconnect() { this.connected = false; lost?.(); } };
  const device = { id: 'ble-test', gatt, addEventListener(type, callback) { lost = callback; }, removeEventListener() { lost = null; } };
  const bluetooth = { requestDevice(options) { return Promise.resolve(device); } };
  return { bluetooth, device, peer, writes, acknowledgements, output };
}
