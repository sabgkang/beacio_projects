import { ProtocolClient, FrameWriter, UUID, encodeFrame, toHex, fromHex } from './protocol.js';
export function serialOptions() { return { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' }; }

class DeviceTransport {
  constructor({ onEvent = () => {}, onState = () => {}, onDisconnect = () => {} } = {}) {
    Object.assign(this, { onEvent, onState, onDisconnect }); this.connected = false; this.isOpen = false; this.state = 'Disconnected'; this.info = null;
  }
  setState(state) { this.state = state; this.onState(state); }
  makeClient(acknowledge, ignoreNoise = false) {
    this.client = new ProtocolClient({ write: (bytes, priority) => this.writer.write(bytes, priority), acknowledge, ignoreNoise,
      onEvent: frame => { this.onEvent(frame); if (frame.event === 'session.ended') this.abort(new Error('Control session ended.')); },
      onFatal: error => this.abort(error) });
  }
  async handshake() {
    this.setState('Handshaking'); this.info = await this.client.request('hello');
    if (this.info.protocol !== 1 || this.info.maxBytes !== 256) throw new Error('Incompatible Multy firmware capabilities.');
    await this.negotiate?.();
    try { await this.client.request('session.claim'); }
    catch (error) { if (error.code === 'DEVICE_BUSY') { this.setState('Busy'); return; } throw error; }
    this.info = await this.client.request('hello');
    this.connected = true; this.setState('Connected');
    this.heartbeat = setInterval(() => { this.client.request('session.ping', {}, true).catch(error => this.abort(error)); }, 5000);
  }
  async request(op, fields) { if (!this.connected) throw new Error('Acquire device control before operating a bus.'); return this.client.request(op, fields); }
  async exchange({ protocol, instance, action, bytes = [], settings = {}, length = 1, dummy = 0 }) {
    const result = await this.request(`${protocol}.${action}`, { channel: instance, settings, ...(action === 'read' ? { length, dummy } : { data: toHex(bytes) }) });
    return { ...result, bytes: fromHex(result.data) };
  }
  async release() {
    clearInterval(this.heartbeat);
    if (this.connected && !this.client?.closed) { try { await this.client.request('session.release', {}, true); } catch {} }
    this.connected = false;
  }
  abort(error) {
    if (this.aborting) return;
    this.aborting = true; this.connected = false; this.setState('Error');
    this.closeLink(error).finally(() => { this.aborting = false; this.onDisconnect(error); });
  }
}

export class SerialTransport extends DeviceTransport {
  constructor({ serial = globalThis.navigator?.serial, secure = globalThis.isSecureContext, ...callbacks } = {}) {
    super(callbacks); this.serial = serial; this.secure = secure; this.port = null;
    serial?.addEventListener('disconnect', event => { if ((event.port || event.target) === this.port) this.abort(new Error('USB device disconnected.')); });
  }
  async connect() {
    if (!this.secure) throw new Error('Web Serial needs HTTPS or localhost.');
    if (!this.serial) throw new Error('Use desktop Chrome or Edge for Web Serial.');
    if (this.isOpen) throw new Error('Disconnect the current device first.');
    this.setState('Connecting'); const selection = this.serial.requestPort();
    try {
      const port = await selection; this.port = port;
      await port.open(serialOptions()); this.isOpen = true;
      this.streamWriter = port.writable.getWriter(); this.writer = new FrameWriter(bytes => this.streamWriter.write(bytes));
      this.makeClient(undefined, true); this.reader = port.readable.getReader(); this.reading = this.readLoop();
      await this.handshake();
    } catch (error) { await this.closeLink(error); this.setState('Error'); throw error; }
  }
  async readLoop() {
    try {
      while (this.isOpen) { const { value, done } = await this.reader.read(); if (done) break; if (value) this.client.framer.push(value); }
      if (this.isOpen) this.abort(new Error('Serial input ended.'));
    } catch (error) { if (this.isOpen) this.abort(error); }
  }
  async closeLink(error) {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      clearInterval(this.heartbeat); this.connected = false; this.isOpen = false;
      this.client?.close(error); this.writer?.close(error);
      try { await this.reader?.cancel(); } catch {}
      await this.reading;
      try { this.reader?.releaseLock(); } catch {}
      try { await this.streamWriter?.abort(error); } catch {}
      try { this.streamWriter?.releaseLock(); } catch {}
      try { await this.port?.close(); } catch {}
      this.reader = this.streamWriter = this.port = null;
    })();
    try { await this.closing; } finally { this.closing = null; }
  }
  async disconnect() { await this.release(); await this.closeLink(); this.setState('Disconnected'); }
  get label() {
    const info = this.port?.getInfo(); if (!info) return 'Select in Chrome / Edge';
    if (info.usbVendorId === undefined) return 'Serial port selected';
    const hex = value => value.toString(16).padStart(4, '0').toUpperCase();
    return `USB ${hex(info.usbVendorId)}${info.usbProductId === undefined ? '' : ':' + hex(info.usbProductId)}`;
  }
}

export class BleTransport extends DeviceTransport {
  constructor({ bluetooth, getBluetooth, secure = globalThis.isSecureContext, crypto = globalThis.crypto, pickerTimeoutMs = 60000, gattTimeoutMs = 15000, ...callbacks } = {}) {
    super(callbacks); Object.assign(this, { bluetooth, secure, crypto, pickerTimeoutMs, gattTimeoutMs }); this.compatibility = new Set(); this.chunkBytes = 20;
    // Beacio may replace its bootstrap API after this page's modules run.
    this.getBluetooth = getBluetooth || (() => this.bluetooth === undefined ? globalThis.navigator?.bluetooth : this.bluetooth);
    this.onNotification = event => { const value = event.target.value; this.client.framer.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); };
    this.onLinkLost = () => { if (this.isOpen) this.abort(new Error('BLE device disconnected.')); };
  }
  async connect() {
    if (!this.secure) throw new Error('BLE needs HTTPS. Open the trusted HTTPS address on iPhone.');
    const bluetooth = this.getBluetooth();
    if (!bluetooth?.requestDevice) throw new Error('Enable Beacio for this website, reload Safari, then tap Connect again.');
    if (this.isOpen) throw new Error('Disconnect the current device first.');
    const attempt = { cancelled: false };
    this.setState('Selecting BLE device');
    try {
      // Call synchronously in the click gesture; never await extension detection first.
      const selection = bluetooth.requestDevice({ filters: [{ services: [UUID.service] }], optionalServices: [UUID.service] });
      this.device = await this.waitStage(selection, 'BLE picker did not finish. Check Beacio activation for this website; close any picker and reload Safari.', this.pickerTimeoutMs);
      this.chunkBytes = 20;
      this.device.addEventListener('gattserverdisconnected', this.onLinkLost);
      this.setState('Connecting BLE GATT');
      const connection = this.device.gatt.connect();
      Promise.resolve(connection).then(server => { if (attempt.cancelled) server.disconnect(); }, () => {});
      const server = await this.waitStage(connection, 'BLE GATT connection timed out.'); this.isOpen = true;
      this.setState('Discovering BLE service');
      const service = await this.waitStage(server.getPrimaryService(UUID.service), 'Multy BLE service discovery timed out.');
      this.command = await this.waitStage(service.getCharacteristic(UUID.command), 'BLE command discovery timed out.');
      this.output = await this.waitStage(service.getCharacteristic(UUID.output), 'BLE notification discovery timed out.');
      this.writer = new FrameWriter(async bytes => {
        for (let offset = 0; offset < bytes.length; offset += this.chunkBytes) {
          if (!this.isOpen) throw new Error('BLE disconnected.');
          await this.command.writeValueWithResponse(bytes.slice(offset, offset + this.chunkBytes));
        }
      });
      this.makeClient(seq => this.writer.write(encodeFrame({ v: 1, op: 'transport.ack', seq }), true));
      this.setState('Subscribing BLE notifications');
      this.output.addEventListener('characteristicvaluechanged', this.onNotification);
      await this.waitStage(this.output.startNotifications(), 'BLE notification subscription timed out.');
      await this.handshake();
    } catch (error) {
      attempt.cancelled = true;
      if (this.device && this.probing) this.compatibility.add(this.device.id);
      this.probing = false; await this.closeLink(error); this.setState(`Error: ${error.message}`); throw error;
    }
  }
  async waitStage(operation, message, timeoutMs = this.gattTimeoutMs) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
    } finally { clearTimeout(timer); }
  }
  async negotiate() {
    if (this.compatibility.has(this.device.id)) return;
    const max = Math.min(Number(this.info.ble?.maxChunkBytes) || 20, 244);
    const candidates = [...new Set([64, 128, max])].filter(value => value > 20 && value <= max).sort((a, b) => a - b);
    if (!candidates.length) return;
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const digest = toHex(new Uint8Array(await this.crypto.subtle.digest('SHA-256', bytes)));
    this.probing = true;
    for (const size of candidates) {
      this.chunkBytes = size;
      const result = await this.client.request('transport.probe', { chunkBytes: size, data: toHex(bytes) });
      if (result.count !== bytes.length || result.sha256 !== digest || result.data !== toHex(bytes)) throw new Error('BLE probe failed. Reconnect in compatibility mode.');
    }
    this.probing = false;
  }
  async closeLink(error) {
    clearInterval(this.heartbeat); this.connected = false; this.isOpen = false;
    this.client?.close(error); this.writer?.close(error);
    this.output?.removeEventListener('characteristicvaluechanged', this.onNotification);
    this.device?.removeEventListener('gattserverdisconnected', this.onLinkLost);
    this.device?.gatt.disconnect(); this.command = this.output = null;
  }
  async disconnect() { await this.release(); await this.closeLink(); this.setState('Disconnected'); }
}
