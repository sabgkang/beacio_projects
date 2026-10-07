import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDiagnosticOverlay } from '../public/diagnostic-overlay.js';

test('reports transparent hit-test blockers and inert ancestors without altering them', () => {
  const node = (id, extra = {}) => Object.freeze({ tagName: 'DIV', id, className: '', inert: false,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 100, height: 40 }), ...extra });
  const blocker = node('beacio-overlay');
  const button = node('copy-diagnostics', { disabled: false });
  const body = node('body', { inert: true });
  const doc = Object.freeze({ body, documentElement: node('root'), getElementById: () => button,
    elementsFromPoint: () => [blocker, button, body], querySelectorAll: () => [blocker, body] });
  const win = Object.freeze({ innerWidth: 390, innerHeight: 844,
    getComputedStyle: n => ({ display: 'block', position: 'fixed', opacity: n === blocker ? '0' : '1', pointerEvents: 'auto', zIndex: '999' }) });
  const result = inspectDiagnosticOverlay(doc, win);
  assert.equal(result.body.inert, true);
  assert.equal(result.targets[0].stack[0].id, 'beacio-overlay');
  assert.equal(result.targets[0].stack[0].opacity, '0');
  assert.equal(result.targets[0].stack[0].pointerEvents, 'auto');
  assert.equal(result.targets[0].inViewport, true);
  assert.equal(result.candidates.length, 2);
});
