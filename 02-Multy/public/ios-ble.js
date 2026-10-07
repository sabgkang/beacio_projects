import { BleTransport } from './transport.js';
import { UUID } from './protocol.js';

// iOS adapter only; desktop continues to instantiate the original BleTransport.
export class IOSBleTransport extends BleTransport {
  constructor({ getBluetooth = () => globalThis.navigator?.bluetooth, ...options } = {}) {
    let selectedName;
    super({ pickerTimeoutMs: 20000, ...options, getBluetooth: () => {
      const api = getBluetooth();
      if (!api?.requestDevice) return api;
      return { requestDevice: () => {
        // Name-filtered authorization is separate from advertisement scanning.
        // Call before any await, within the scanned row's trusted click.
        return Promise.resolve(api.requestDevice({ filters: [{ name: selectedName }], optionalServices: [UUID.service] })).then(device => {
          if (device.name && device.name !== selectedName) throw new Error('授權的裝置名稱與所選 Multy 不符，請重新選擇。');
          return device;
        });
      } };
    } });
    this.selectName = name => { selectedName = name; };
    this.history = [];
  }
  async connect() { throw new Error('請先 Scan，再點選清單中的 Multy 裝置連線。'); }
  connectScanned(item) {
    if (this.isOpen) return Promise.reject(new Error('Disconnect the current device first.'));
    if (!item || typeof item.name !== 'string' || !/multy/i.test(item.name)) return Promise.reject(new Error('請選擇掃描清單中的 Multy 裝置。'));
    this.history = []; this.selectName(item.name);
    return super.connect();
  }
  setState(state) {
    if (state === 'Selecting BLE device') state = 'Authorizing selected Multy device';
    this.history.push({ time: new Date().toLocaleTimeString(), state });
    if (this.history.length > 16) this.history.shift();
    super.setState(state);
  }
  waitStage(operation, message, timeoutMs) {
    if (message.startsWith('BLE picker')) message = 'Multy 裝置授權未完成（20 秒）。掃描已成功，但 requestDevice 尚未回應；請關閉 Beacio 選擇視窗後再試。';
    return super.waitStage(operation, message, timeoutMs);
  }
}
