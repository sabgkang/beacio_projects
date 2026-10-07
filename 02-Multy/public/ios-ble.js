import { BleTransport } from './transport.js';

// iOS adapter only; desktop continues to instantiate the original BleTransport.
export class IOSBleTransport extends BleTransport {
  constructor(options = {}) {
    let selectedDevice;
    super({ ...options, getBluetooth: () => ({
      // Local handoff to the shared GATT setup, not a browser requestDevice call.
      // Beacio's DeviceScanner connects the advertisement's raw device directly.
      requestDevice: () => Promise.resolve(selectedDevice)
    }) });
    this.selectDevice = device => { selectedDevice = device; };
    this.history = [];
  }
  async connect() { throw new Error('請先 Scan，再點選清單中的 Multy 裝置連線。'); }
  connectScanned(item) {
    if (this.isOpen) return Promise.reject(new Error('Disconnect the current device first.'));
    this.history = [];
    const reject = message => { const error = new Error(message); this.setState(`Error: ${message}`); return Promise.reject(error); };
    if (!item || typeof item.name !== 'string' || !/multy/i.test(item.name)) return reject('請選擇掃描清單中的 Multy 裝置。');
    if (!item.device || typeof item.device.gatt?.connect !== 'function' || typeof item.device.addEventListener !== 'function') return reject('掃描事件沒有可連線的 BluetoothDevice；請重新 Scan，並檢查 Beacio 版本。');
    if (item.device.name && item.device.name !== item.name) return reject('掃描物件的裝置名稱與所選 Multy 不符，請重新掃描。');
    this.selectDevice(item.device);
    return super.connect().catch(error => {
      if (['SecurityError', 'NotAllowedError'].includes(error.name)) {
        const failure = new Error(`掃描裝置的 GATT／服務權限遭拒（${error.name}）：${error.message}。未重新呼叫 requestDevice。`, { cause: error });
        failure.name = error.name; this.setState(`Error: ${failure.message}`); throw failure;
      }
      throw error;
    });
  }
  setState(state) {
    if (state === 'Selecting BLE device') state = 'Using scanned Multy device';
    this.history.push({ time: new Date().toLocaleTimeString(), state });
    if (this.history.length > 16) this.history.shift();
    super.setState(state);
  }
}
