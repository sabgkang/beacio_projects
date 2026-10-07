import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveBlePicker } from '../public/live-ble-picker.js';
import { MultyScanner } from '../public/ble-scan.js';

function testDocument() {
  const doc = { createElement: tag => new Node(tag) };
  class Node extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; this.ownerDocument = doc; this.children = []; this.open = false; }
    setAttribute() {}
    append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
    remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
  }
  doc.body = new Node('body'); return doc;
}

test('live picker retains tappable rows across advertisements and selects during active scan', async () => {
  const api = new EventTarget(); let stopped = 0, selected;
  api.requestLEScan = async () => ({ stop() { stopped++; } });
  let picker;
  const scanner = new MultyScanner({ getBluetooth: () => api, onChange: scan => picker.render(scan) });
  picker = new LiveBlePicker({ doc: testDocument(), onClose: () => scanner.stop(), onSelect: item => {
    scanner.stop(); picker.close(); selected = item;
    assert.equal(scanner.busy, false); assert.equal(picker.dialog.open, false);
  } });
  picker.show(); await scanner.start();
  try {
    const emit = rssi => {
      const event = new Event('advertisementreceived');
      Object.assign(event, { name: 'Multy-ESP32S3-020F3C', device: { id: 'multy' }, rssi }); api.dispatchEvent(event);
    };
    emit(-70); const button = picker.rows.get('multy').button;
    for (let rssi = -69; rssi < -40; rssi++) emit(rssi);
    assert.equal(picker.rows.get('multy').button, button);
    assert.equal(picker.list.children.length, 1);
    assert.equal(button.disabled, false); assert.equal(scanner.busy, true);
    button.dispatchEvent(new Event('click'));
    assert.equal(selected.name, 'Multy-ESP32S3-020F3C'); assert.equal(selected.rssi, -41);
    assert.equal(stopped, 1);
  } finally { scanner.stop(); }
});

test('closing scan popup stops the active scan; completed results remain available to reopen', async () => {
  const api = new EventTarget(); let stopped = 0;
  api.requestLEScan = async () => ({ stop() { stopped++; } });
  const scanner = new MultyScanner({ getBluetooth: () => api });
  const picker = new LiveBlePicker({ doc: testDocument(), onSelect() {}, onClose: () => scanner.stop() });
  picker.show(); await scanner.start(); picker.close();
  assert.equal(stopped, 1); assert.equal(scanner.busy, false);
  scanner.devices.set('multy', { name: 'Multy-test', rssi: null }); picker.render(scanner); picker.show();
  assert.equal(picker.rows.get('multy').button.disabled, false);
  picker.render(scanner, true); assert.equal(picker.rows.get('multy').button.disabled, true);
  picker.close();
});
