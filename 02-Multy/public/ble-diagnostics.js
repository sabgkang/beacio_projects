import { iosBluetooth, usesIOSScan } from './beacio-ios.js?v=20261007-ios-scan2';
import { UUID } from './protocol.js';

const records = [], buttons = [document.getElementById('select-all'), document.getElementById('select-multy')];
function log(message, detail) {
  records.push(`${new Date().toLocaleTimeString()} ${message}${detail ? '\n' + JSON.stringify(detail, null, 2) : ''}`);
  if (records.length > 30) records.shift();
  document.getElementById('diagnostic-log').textContent = records.join('\n\n');
}
function snapshot() {
  const bluetooth = navigator.bluetooth;
  const environment = {
    origin: location.origin, secureContext: isSecureContext, userAgent: navigator.userAgent,
    platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    expectedMainAction: usesIOSScan(navigator) ? 'scan-only' : 'connect',
    frontendBuild: '20261007-ios-scan2',
    sdk: iosBluetooth.status, bluetoothAPI: Boolean(bluetooth),
    requestDevice: typeof bluetooth?.requestDevice,
    beacioBootstrap: Boolean(bluetooth?.__beacioBootstrap), beacioStub: Boolean(bluetooth?.__beacioCDNStub),
    beacioRuntime: Boolean(navigator.beacio?.__beacio),
    extensionMarker: document.documentElement.dataset.beacioExtension || null,
    installedMarker: document.documentElement.dataset.beacioInstalled || null,
    cspViolations: iosBluetooth.violations
  };
  document.getElementById('environment').textContent = JSON.stringify(environment, null, 2);
  return environment;
}
async function select(all) {
  let timer;
  snapshot();
  if (!navigator.bluetooth?.requestDevice) { log('找不到 Bluetooth API；請確認 Safari 的 Beacio 網站權限。'); return; }
  buttons.forEach(button => { button.disabled = true; });
  try {
    const options = all ? { acceptAllDevices: true, optionalServices: [UUID.service] } : { filters: [{ services: [UUID.service] }], optionalServices: [UUID.service] };
    log(all ? '呼叫選擇所有裝置' : '呼叫服務篩選', { userActivation: navigator.userActivation?.isActive ?? null, options });
    // No await before requestDevice: retain the original trusted button click.
    const selection = navigator.bluetooth.requestDevice(options);
    const device = await Promise.race([selection, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('20 秒內未完成選擇。若未出現視窗，請複製此紀錄；再次測試前請關閉視窗或重新載入 Safari。')), 20000); })]);
    log('裝置選擇成功；未連線', { name: device.name || '(未提供名稱)' });
  } catch (error) { log('裝置選擇未完成', { name: error.name, message: error.message }); }
  finally { clearTimeout(timer); buttons.forEach(button => { button.disabled = false; }); snapshot(); }
}
buttons[0].addEventListener('click', () => select(true));
buttons[1].addEventListener('click', () => select(false));
document.getElementById('refresh-diagnostics').addEventListener('click', snapshot);
document.getElementById('copy-diagnostics').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.getElementById('environment').textContent + '\n\n' + records.join('\n\n')); log('診斷紀錄已複製。'); }
  catch { log('無法存取剪貼簿；請手動選取紀錄複製。'); }
});
window.addEventListener('beacio:extension:ready', () => { log('收到 Beacio extension ready 事件'); snapshot(); });
snapshot(); log('診斷頁已載入；SDK 僅在 iPhone／iPad Safari 載入。');
fetch(location.pathname, { cache: 'no-store' }).then(response => log('網站安全標頭', { csp: response.headers.get('content-security-policy'), permissionsPolicy: response.headers.get('permissions-policy') })).catch(error => log('無法讀取安全標頭', { message: error.message }));
