// BLE remains simulated until the Multy command framing and BLE UUIDs are defined.
export class DemoTransport {
  connected = false;
  async connect(method) { this.method = method; this.connected = true; }
  async disconnect() { this.connected = false; }
  async exchange({ protocol, action, bytes = [] }) {
    if (!this.connected) throw new Error('Connect the demo device first.');
    await new Promise(resolve => setTimeout(resolve, 180));
    if (!this.connected) throw new Error('Disconnected. Connect again to continue.');
    if (protocol === 'uart') return [...bytes, 0x0D, 0x0A];
    if (protocol === 'i2c') return action === 'read' ? [0x3C, 0x00, 0xA5, 0x5A, 0xFF, 0x10, 0x27, 0x3C] : [];
    return [0xEF, 0x40, 0x18, ...bytes.slice(0, 5)];
  }
}

export function serialOptions(settings) {
  const baudRate = Number(settings.baud);
  if (!Number.isInteger(baudRate) || baudRate <= 0) throw new Error('Choose a valid UART1 baud rate.');
  if (settings.databits !== '8') throw new Error('Web Serial does not support 9 data bits. Select 8 in UART1.');
  if (settings.stop !== '1') throw new Error('Web Serial does not support 0 stop bits. Select 1 in UART1.');
  if (settings.parity !== 'N') throw new Error('Parity Y does not specify even or odd parity. Select N in UART1 to open this port.');
  return { baudRate, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' };
}

export class SerialTransport {
  connected = false;
  port = null;
  constructor({ serial = globalThis.navigator?.serial, secure = globalThis.isSecureContext, onDisconnect = () => {} } = {}) {
    this.serial = serial;
    this.secure = secure;
    serial?.addEventListener('disconnect', event => {
      const port = event.port || event.target;
      if (port !== this.port) return;
      this.connected = false;
      this.port = null;
      // There are no reader/writer locks until the Multy protocol is integrated.
      Promise.resolve().then(() => port.close()).catch(() => {});
      onDisconnect();
    });
  }
  async connect(settings) {
    if (!this.secure) throw new Error('Web Serial needs HTTPS or localhost.');
    if (!this.serial) throw new Error('Web Serial is unavailable in this browser. Open Multy in desktop Chrome or Edge.');
    const options = serialOptions(settings);
    // Called directly from the Connect click, before any asynchronous work,
    // to preserve the user gesture required by the browser port picker.
    const port = await this.serial.requestPort();
    await port.open(options);
    this.port = port;
    this.connected = true;
  }
  async disconnect() {
    if (!this.port) return;
    await this.port.close();
    this.port = null;
    this.connected = false;
  }
  get label() {
    if (!this.port) return 'Select in Chrome';
    const info = this.port.getInfo();
    if (info.usbVendorId === undefined) return 'Serial port selected';
    const hex = value => value.toString(16).padStart(4, '0').toUpperCase();
    return `USB ${hex(info.usbVendorId)}${info.usbProductId === undefined ? '' : ':' + hex(info.usbProductId)}`;
  }
  async exchange() {
    throw new Error('The serial port is open. UART/I2C/SPI commands require the Multy firmware protocol, which is not configured yet.');
  }
}
