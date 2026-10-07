// Stable rows keep a tap target alive while repeated advertisements update RSSI.
export class LiveBlePicker {
  constructor({ doc = document, onSelect, onClose }) {
    this.rows = new Map();
    const element = (tag, text) => { const node = doc.createElement(tag); if (text) node.textContent = text; return node; };
    this.dialog = element('dialog'); this.dialog.className = 'live-ble-picker';
    this.dialog.setAttribute('aria-labelledby', 'live-ble-title');
    const title = element('h2', '附近的 Multy 裝置'); title.id = 'live-ble-title';
    const help = element('p', '裝置清單即時更新，找到裝置即可點 Connect，不必等掃描結束。之後請在 Beacio 授權視窗選擇同名裝置。');
    this.status = element('p'); this.status.setAttribute('role', 'status');
    this.list = element('ul');
    this.empty = element('p', '正在等待 Multy 廣播…');
    const close = element('button', '關閉並停止掃描'); close.type = 'button';
    close.addEventListener('click', () => this.close());
    this.dialog.addEventListener('close', onClose);
    this.dialog.append(title, help, this.status, this.list, this.empty, close);
    doc.body.append(this.dialog);
    this.onSelect = onSelect;
  }
  show() { if (!this.dialog.open) this.dialog.showModal(); }
  close() { if (this.dialog.open) this.dialog.close(); }
  render(scanner, disabled = false) {
    this.status.textContent = `${scanner.message} · ${scanner.devices.size} Multy devices`;
    for (const [key, row] of this.rows) {
      if (!scanner.devices.has(key)) { row.node.remove(); this.rows.delete(key); }
    }
    for (const [key, item] of scanner.devices) {
      let row = this.rows.get(key);
      if (!row) {
        const doc = this.dialog.ownerDocument;
        const node = doc.createElement('li'), label = doc.createElement('span'), button = doc.createElement('button');
        button.type = 'button'; button.textContent = 'Connect';
        row = { node, label, button, item };
        button.addEventListener('click', () => this.onSelect(row.item));
        node.append(label, button); this.list.append(node); this.rows.set(key, row);
      }
      row.item = item;
      row.label.textContent = `${item.name}${item.rssi === null ? '' : ` · ${item.rssi} dBm`}`;
      row.button.setAttribute('aria-label', `Connect ${item.name}`);
      row.button.disabled = disabled;
    }
    this.empty.hidden = scanner.devices.size > 0;
    this.empty.textContent = scanner.busy ? '正在等待 Multy 廣播…' : '尚未找到 Multy 裝置，關閉後可再次 Scan。';
  }
}
