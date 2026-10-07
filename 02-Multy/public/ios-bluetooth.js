// Same API priority as @beacio/core's platform.ts. Read at click time.
export function getIOSBluetooth(nav = globalThis.navigator) {
  if (nav?.beacio?.__beacio === true && typeof nav.beacio.requestDevice === 'function') return nav.beacio;
  if (nav?.bluetooth && !nav.bluetooth.__beacioCDNStub) return nav.bluetooth;
  return null;
}
