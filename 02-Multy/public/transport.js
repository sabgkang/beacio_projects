// Replace this adapter when the Multy firmware's command framing and BLE UUIDs are defined.
// No browser hardware permissions are requested by the demo adapter.
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
