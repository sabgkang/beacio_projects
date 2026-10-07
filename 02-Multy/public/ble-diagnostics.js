import { iosBluetooth } from './beacio-ios.js?v=20261007-ios-scan2';
import { UUID } from './protocol.js';
import { getIOSBluetooth } from './ios-bluetooth.js?v=20261007-ios-auth5';
import { PickerDiagnostic } from './picker-diagnostic.js?v=20261007-diag6';
import { inspectDiagnosticOverlay } from './diagnostic-overlay.js?v=20261007-diag7';
import { beacioReferenceRequest } from './beacio-reference.js?v=20261007-diag8';

const records = [], buttons = ['select-all', 'select-multy', 'select-beacio', 'select-reference', 'select-reference-multy'].map(id => document.getElementById(id));
const pickerStatus = document.getElementById('picker-status');
const cancelButton = document.getElementById('cancel-picker');
const styleCompatibility = new URLSearchParams(location.search).get('beacioStyles') === '1';
document.getElementById('style-mode').textContent = styleCompatibility ? '樣式相容測試模式：請確認下方實際 CSP 包含 style-src-elem 的 unsafe-inline。' : '標準嚴格 CSP 模式。';
const picker = new PickerDiagnostic({
  onProgress: seconds => { pickerStatus.textContent = `等待 Beacio 裝置選擇回覆，剩餘 ${seconds} 秒。倒數持續表示網頁仍在運作；可隨時複製紀錄或取消等待。`; },
  onReturned: () => log('requestDevice 已回傳，等待 Promise 完成；網頁未進入 GATT。')
});
function log(message, detail) {
  records.push(`${new Date().toLocaleTimeString()} ${message}${detail ? '\n' + JSON.stringify(detail, null, 2) : ''}`);
  if (records.length > 30) records.shift();
  document.getElementById('diagnostic-log').textContent = records.join('\n\n');
}
function snapshot() {
  const bluetooth = navigator.bluetooth;
  const environment = {
    origin: location.origin, diagnosticURL: location.href, styleCompatibilityRequested: styleCompatibility,
    secureContext: isSecureContext, userAgent: navigator.userAgent,
    platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    expectedMainAction: 'connect',
    frontendBuild: '20261007-ios-status14',
    diagnosticBuild: '20261007-diag9',
    preferredAPISource: getIOSBluetooth() === navigator.beacio && navigator.beacio ? 'navigator.beacio' : 'navigator.bluetooth',
    beacioRequestDevice: typeof navigator.beacio?.requestDevice,
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
async function select(all, preferred = false, reference = null) {
  if (picker.active) return;
  snapshot();
  const referenceRequest = reference === null ? null : beacioReferenceRequest(navigator, reference);
  const api = referenceRequest ? referenceRequest.api : preferred ? getIOSBluetooth() : navigator.bluetooth;
  if (!api?.requestDevice) { log('找不到 Bluetooth API；請確認 Safari 的 Beacio 網站權限。'); return; }
  buttons.forEach(button => { button.disabled = true; });
  cancelButton.disabled = false;
  try {
    const options = referenceRequest ? referenceRequest.options : preferred ? { filters: [{ namePrefix: 'Multy' }], optionalServices: [UUID.service] } : all ? { acceptAllDevices: true, optionalServices: [UUID.service] } : { filters: [{ services: [UUID.service] }], optionalServices: [UUID.service] };
    log(referenceRequest ? `官網流程對照${reference ? ' + Multy UUID' : '（標準服務）'}` : preferred ? '使用官方 API 優先順序請求 Multy 授權' : all ? '呼叫選擇所有裝置' : '呼叫服務篩選', { apiSource: api === navigator.beacio ? 'navigator.beacio' : 'navigator.bluetooth', userActivation: navigator.userActivation?.isActive ?? null, options });
    // No await before requestDevice: retain the original trusted button click.
    const result = await picker.start(() => api.requestDevice(options));
    if (result.status === 'selected') {
      pickerStatus.textContent = '裝置選擇成功；未建立 GATT 連線。';
      log(pickerStatus.textContent, { name: result.device.name || '(未提供名稱)' });
    } else if (result.status === 'error') throw result.error;
    else {
      pickerStatus.textContent = result.status === 'timeout' ? '20 秒內沒有選擇回覆。請複製診斷紀錄；重新載入後再測試。' : '已取消網頁等待。這不會取消擴充功能內部的選擇呼叫；請重新載入後再測試。';
      log(pickerStatus.textContent, { visibility: document.visibilityState, cspViolations: iosBluetooth.violations });
      showReport();
    }
  } catch (error) { pickerStatus.textContent = `選擇失敗：${error.message}`; log('裝置選擇未完成', { name: error.name, message: error.message }); }
  finally { buttons.forEach(button => { button.disabled = false; }); cancelButton.disabled = true; snapshot(); }
}
buttons[0].addEventListener('click', () => select(true));
buttons[1].addEventListener('click', () => select(false));
buttons[2].addEventListener('click', () => select(false, true));
buttons[3].addEventListener('click', () => select(true, true, false));
buttons[4].addEventListener('click', () => select(true, true, true));
cancelButton.addEventListener('click', () => picker.cancel());
document.getElementById('reload-diagnostics').addEventListener('click', () => location.reload());
document.addEventListener('visibilitychange', () => log('Safari 前景狀態變更', { visibility: document.visibilityState }));
document.getElementById('refresh-diagnostics').addEventListener('click', snapshot);
document.getElementById('copy-diagnostics').addEventListener('click', async () => {
  showReport(); await copyReport();
});
const recovery = document.getElementById('diagnostic-recovery');
const report = document.getElementById('recovery-report');
function showReport() {
  if (!recovery.open) {
    try { log('複製／重新載入按鈕遮擋檢查', inspectDiagnosticOverlay()); }
    catch (error) { log('無法收集遮擋狀態', { message: error.message }); }
  }
  snapshot(); report.value = document.getElementById('environment').textContent + '\n\n' + records.join('\n\n');
  // Read the report from a fresh page when a third-party picker blocks this tab.
  try { localStorage.setItem('multy-ble-diagnostic-report', JSON.stringify({ savedAt: new Date().toISOString(), text: report.value })); }
  catch (error) { log('診斷紀錄本機儲存失敗', { message: error.message }); }
  if (!recovery.open) recovery.showModal();
}
function selectReport() { report.focus(); report.select(); report.setSelectionRange(0, report.value.length); }
async function copyReport() {
  const status = document.getElementById('recovery-status'); status.textContent = '已收到複製操作，正在寫入剪貼簿…';
  selectReport();
  let timer;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await Promise.race([navigator.clipboard.writeText(report.value), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Clipboard timeout')), 1500); })]);
    status.textContent = '診斷紀錄已複製。';
  } catch { status.textContent = '剪貼簿沒有完成。文字已全選，請長按文字框並使用 iPhone 的「複製」。'; }
  finally { clearTimeout(timer); }
}
document.getElementById('show-report').addEventListener('click', showReport);
document.getElementById('recovery-copy').addEventListener('click', copyReport);
document.getElementById('recovery-select').addEventListener('click', selectReport);
document.getElementById('recovery-reload').addEventListener('click', () => location.reload());
document.getElementById('recovery-close').addEventListener('click', () => recovery.close());
window.addEventListener('beacio:extension:ready', () => { log('收到 Beacio extension ready 事件'); snapshot(); });
snapshot(); log('診斷頁已載入；SDK 僅在 iPhone／iPad Safari 載入。');
fetch(location.pathname + location.search, { cache: 'no-store' }).then(response => log('網站安全標頭', { csp: response.headers.get('content-security-policy'), permissionsPolicy: response.headers.get('permissions-policy') })).catch(error => log('無法讀取安全標頭', { message: error.message }));
