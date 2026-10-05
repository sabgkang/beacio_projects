// Apply the preference before first paint. Storage may be unavailable in private sessions.
(() => {
  let preference;
  try { preference = localStorage.getItem('multy-theme'); } catch {}
  const theme = ['light', 'dark'].includes(preference) ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
})();
