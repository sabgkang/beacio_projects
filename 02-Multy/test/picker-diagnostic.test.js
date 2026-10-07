import test from 'node:test';
import assert from 'node:assert/strict';
import { PickerDiagnostic } from '../public/picker-diagnostic.js';

test('diagnostic invokes picker in the click, shows progress and bounds a stalled promise', async () => {
  let invoked = false, returned = false; const progress = [];
  const picker = new PickerDiagnostic({ timeoutMs: 20, tickMs: 5, onProgress: value => progress.push(value), onReturned: () => { returned = true; } });
  const result = picker.start(() => { invoked = true; return new Promise(() => {}); });
  assert.equal(invoked, true); assert.equal(returned, true);
  assert.equal((await result).status, 'timeout'); assert.ok(progress.length >= 1); assert.equal(picker.active, null);
});

test('cancel restores local wait, ignores late results and permits another test', async () => {
  let late; const picker = new PickerDiagnostic({ timeoutMs: 100 });
  const wait = picker.start(() => new Promise(resolve => { late = resolve; }));
  picker.cancel(); assert.equal((await wait).status, 'cancelled');
  late({ get gatt() { throw new Error('Do not connect'); } });
  const device = { name: 'Multy', get gatt() { throw new Error('Do not connect'); } };
  const result = await picker.start(() => Promise.resolve(device));
  assert.equal(result.status, 'selected'); assert.equal(result.device, device); assert.equal(picker.active, null);
});

test('synchronous permission failure and asynchronous rejection both finish without leaving timers active', async () => {
  const picker = new PickerDiagnostic();
  assert.equal((await picker.start(() => { throw new Error('Denied'); })).status, 'error');
  assert.equal(picker.active, null);
  assert.equal((await picker.start(() => Promise.reject(new Error('Cancelled')))).status, 'error');
  assert.equal(picker.active, null);
});
