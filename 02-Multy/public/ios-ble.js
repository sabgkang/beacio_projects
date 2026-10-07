import { BleTransport } from './transport.js';
import { UUID } from './protocol.js';
import { getIOSBluetooth } from './ios-bluetooth.js?v=20261007-ios-auth5';

// iOS adapter only; desktop continues to instantiate the original BleTransport.
export class IOSBleTransport extends BleTransport {
  constructor({ getBluetooth = () => getIOSBluetooth(), ...options } = {}) {
    let selectedName, apiSource;
    super({ pickerTimeoutMs: 20000, ...options, getBluetooth: () => {
      const api = getBluetooth();
      apiSource = api?.__beacio === true ? 'navigator.beacio' : 'navigator.bluetooth';
      if (!api?.requestDevice) return null;
      return { requestDevice: () => Promise.resolve(api.requestDevice({ filters: [{ name: selectedName }], optionalServices: [UUID.service] })).then(device => {
        if (device.name && device.name !== selectedName) throw new Error('授權裝置與所選 Multy 名稱不符，請重新選擇。');
        return device;
      }) };
    } });
    this.selectName = name => { selectedName = name; };
    this.apiSource = () => apiSource;
    this.history = [];
  }
  async connect() { throw new Error('請先 Scan，再點選清單中的 Multy 裝置連線。'); }
  connectScanned(item) {
    if (this.isOpen) return Promise.reject(new Error('Disconnect the current device first.'));
    this.history = [];
    const reject = message => { const error = new Error(message); this.setState(`Error: ${message}`); return Promise.reject(error); };
    if (!item || typeof item.name !== 'string' || !/multy/i.test(item.name)) return reject('請選擇掃描清單中的 Multy 裝置。');
    this.selectName(item.name);
    return super.connect().catch(error => {
      if (['SecurityError', 'NotAllowedError'].includes(error.name)) {
        const failure = new Error(`BLE 授權／GATT 權限遭拒（${error.name}）：${error.message}`, { cause: error });
        failure.name = error.name; this.setState(`Error: ${failure.message}`); throw failure;
      }
      throw error;
    });
  }
  setState(state) {
    if (state === 'Selecting BLE device') state = `Authorizing Multy via ${this.apiSource()}`;
    this.history.push({ time: new Date().toLocaleTimeString(), state });
    if (this.history.length > 16) this.history.shift();
    super.setState(state);
  }
  waitStage(operation, message, timeoutMs) {
    if (message.startsWith('BLE picker')) message = `Multy 授權未完成；${this.apiSource()} 沒有回應。請使用 BLE 診斷頁複製 CSP 與 API 紀錄。`;
    return super.waitStage(operation, message, timeoutMs);
  }
}
