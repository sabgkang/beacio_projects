import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeIOSBluetooth, isIOSSafari, usesIOSScan } from '../public/beacio-ios.js';

test('iOS desktop website mode uses scan-only while actual PCs keep Connect', () => {
  const desktopUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
  assert.equal(usesIOSScan({ userAgent: desktopUA, platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(usesIOSScan({ userAgent: desktopUA, platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(usesIOSScan({ userAgent: 'Chrome Windows', platform: 'Win32', maxTouchPoints: 10 }), false);
  assert.equal(usesIOSScan({ userAgent: 'Mozilla iPhone Safari', platform: 'iPhone' }), true);
  assert.equal(usesIOSScan({ userAgent: 'Android Chrome', platform: 'Linux', maxTouchPoints: 5 }), false);
});

test('PC USB and native BLE remain untouched: no SDK load or DOM changes', async () => {
  const bluetooth = { requestDevice() {} };
  const nav = { userAgent: 'Chrome Windows', platform: 'Win32', maxTouchPoints: 0, bluetooth };
  const doc = new Proxy({}, { get() { throw new Error('PC must not touch the DOM'); } });
  assert.equal((await initializeIOSBluetooth({ nav, doc })).status, 'not-loaded');
  assert.equal(nav.bluetooth, bluetooth);
  assert.equal(isIOSSafari({ userAgent: 'iPhone CriOS', platform: 'iPhone' }), false);
});

test('iPhone loads the fixed SDK from this site and records CSP violations', async () => {
  let script, violation;
  const nav = { userAgent: 'iPhone Safari', platform: 'iPhone' };
  const doc = { addEventListener(type, fn) { violation = fn; }, createElement() { return { dataset: {} }; }, head: { append(value) { script = value; queueMicrotask(() => value.onload()); } } };
  const result = await initializeIOSBluetooth({ nav, doc });
  assert.equal(script.src, '/vendor/beacio-core-2.2.0.js'); assert.equal(result.status, 'loaded');
  violation({ effectiveDirective: 'script-src-elem', blockedURI: 'inline' });
  assert.deepEqual(result.violations, [{ directive: 'script-src-elem', blocked: 'inline' }]);
});

test('iPhone SDK load failure completes so the app can still show diagnostics', async () => {
  const doc = { addEventListener() {}, createElement() { return { dataset: {} }; }, head: { append(script) { queueMicrotask(() => script.onerror()); } } };
  assert.equal((await initializeIOSBluetooth({ nav: { userAgent: 'iPhone Safari' }, doc })).status, 'load-error');
});
