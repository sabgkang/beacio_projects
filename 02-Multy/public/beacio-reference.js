import { UUID } from './protocol.js';

// Match beacio.com/home.js startLiveScan. This is picker-only diagnostics.
export function beacioReferenceRequest(nav, includeMulty = false) {
  const api = nav.beacio || nav.bluetooth;
  const optionalServices = ['battery_service', 'device_information', 'generic_access', 'heart_rate', 0x180f, 0x180a];
  if (includeMulty) optionalServices.push(UUID.service);
  return { api, options: { acceptAllDevices: true, optionalServices } };
}
