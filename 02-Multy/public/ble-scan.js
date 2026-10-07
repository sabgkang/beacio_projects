// Scan advertisements only. Never selects a device, connects GATT or claims control.
export class MultyScanner {
  constructor({ getBluetooth = () => globalThis.navigator?.bluetooth, onChange = () => {}, startTimeoutMs = 10000, durationMs = 15000 } = {}) {
    Object.assign(this, { getBluetooth, onChange, startTimeoutMs, durationMs });
    this.state = 'idle'; this.message = 'Ready to scan'; this.devices = new Map(); this.advertisements = 0;
  }
  get busy() { return this.state === 'starting' || this.state === 'scanning'; }
  publish() { this.onChange(this); }
  cleanup() {
    clearTimeout(this.timer);
    if (this.session) {
      this.session.cancelled = true;
      this.session.bluetooth.removeEventListener('advertisementreceived', this.session.listener);
      try { this.session.scan?.stop(); } catch { /* Keep UI responsive if the bridge is gone. */ }
      this.session = null;
    }
  }
  finish(state, message) { this.cleanup(); this.state = state; this.message = message; this.publish(); }
  stop() { if (this.busy) this.finish('complete', 'Scan stopped'); }
  async start() {
    if (this.busy) return;
    this.devices.clear(); this.advertisements = 0;
    const bluetooth = this.getBluetooth();
    if (typeof bluetooth?.requestLEScan !== 'function' || typeof bluetooth.addEventListener !== 'function') {
      this.finish('error', '此 Beacio API 未提供 requestLEScan；無法獨立掃描。'); return;
    }
    const session = { bluetooth, cancelled: false, scan: null };
    session.listener = event => {
      if (session.cancelled) return;
      this.advertisements++;
      const name = event.name || event.device?.name || '';
      if (/multy/i.test(name)) {
        const key = event.device?.id || name;
        if (this.devices.has(key) || this.devices.size < 100) this.devices.set(key, { name, rssi: Number.isFinite(event.rssi) ? event.rssi : null });
      }
      this.publish();
    };
    this.session = session;
    bluetooth.addEventListener('advertisementreceived', session.listener);
    this.state = 'starting'; this.message = 'Starting BLE scan'; this.publish();
    this.timer = setTimeout(() => this.finish('error', '掃描 API 在 10 秒內未回應；尚無法確認掃描已啟動。'), this.startTimeoutMs);
    try {
      // Called before any await, directly from the Scan button's user gesture.
      const scan = await bluetooth.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
      if (session.cancelled) { try { scan?.stop(); } catch {} return; }
      session.scan = scan;
      if (typeof scan?.stop !== 'function') throw new Error('Beacio 未回傳可停止的掃描物件。');
      clearTimeout(this.timer);
      this.state = 'scanning'; this.message = 'Scanning BLE · 15 seconds'; this.publish();
      this.timer = setTimeout(() => this.finish('complete', 'Scan complete'), this.durationMs);
    } catch (error) {
      if (!session.cancelled) this.finish('error', `掃描失敗：${error.message}`);
    }
  }
}
