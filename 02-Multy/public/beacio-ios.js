export function isIOSSafari(nav) {
  return Boolean(nav && (/iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(nav.userAgent));
}

// iPhone's Request Desktop Website can expose a Macintosh UA with touch support.
export function usesIOSScan(nav) {
  return Boolean(nav && (/iPhone|iPod/i.test(nav.userAgent) || isIOSSafari(nav)));
}

// Desktop returns before loading scripts, registering events or modifying APIs.
export async function initializeIOSBluetooth({ nav = globalThis.navigator, doc = globalThis.document, timeoutMs = 8000 } = {}) {
  if (!isIOSSafari(nav)) return { platform: 'other', status: 'not-loaded', violations: [] };
  const result = { platform: 'ios-safari', status: 'loading', violations: [] };
  doc.addEventListener('securitypolicyviolation', event => {
    if (result.violations.length < 20) result.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
  });
  const script = doc.createElement('script');
  script.id = 'beacio-ios-sdk'; script.src = '/vendor/beacio-core-2.2.0.js'; script.async = false;
  script.dataset.operatorName = 'Multy';
  await new Promise(resolve => {
    let done = false;
    const finish = status => { if (done) return; done = true; clearTimeout(timer); result.status = status; resolve(); };
    const timer = setTimeout(() => finish('load-timeout'), timeoutMs);
    script.onload = () => finish('loaded');
    script.onerror = () => finish('load-error');
    doc.head.append(script);
  });
  return result;
}

export const iosBluetooth = await initializeIOSBluetooth();
