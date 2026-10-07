import test from 'node:test';
import assert from 'node:assert/strict';
import { beacioReferenceRequest } from '../public/beacio-reference.js';
import { UUID } from '../public/protocol.js';

test('official-page control uses canonical API and isolates custom UUID as the only option difference', () => {
  const beacio = {}, bluetooth = {};
  const a = beacioReferenceRequest({ beacio, bluetooth });
  const b = beacioReferenceRequest({ beacio, bluetooth }, true);
  assert.equal(a.api, beacio); assert.equal(b.api, beacio);
  assert.equal(a.options.acceptAllDevices, true);
  assert.equal('filters' in a.options, false);
  assert.deepEqual(a.options.optionalServices, ['battery_service', 'device_information', 'generic_access', 'heart_rate', 0x180f, 0x180a]);
  assert.deepEqual(b.options, { ...a.options, optionalServices: [...a.options.optionalServices, UUID.service] });
  assert.equal(beacioReferenceRequest({ bluetooth }).api, bluetooth);
});
