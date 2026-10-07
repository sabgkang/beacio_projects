// Run before the application/SDK. Desktop browsers keep their original URL.
(() => {
  const nav = navigator;
  const ios = (/iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(nav.userAgent);
  if (!ios) return;
  const url = new URL(location.href);
  if (url.searchParams.get('beacioStyles') === '1') return;
  url.searchParams.set('beacioStyles', '1');
  location.replace(url.href);
})();
