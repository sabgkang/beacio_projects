const status = document.getElementById('saved-status');
const report = document.getElementById('saved-report');
try {
  const value = localStorage.getItem('multy-ble-diagnostic-report');
  if (!value) status.textContent = '尚無已儲存紀錄。請在同一網站的一般 Safari 分頁執行 diag8 測試，等候 20 秒後，再開啟此頁。';
  else {
    const saved = JSON.parse(value);
    if (typeof saved.text !== 'string' || typeof saved.savedAt !== 'string') throw new Error('Invalid report');
    status.textContent = `上次儲存時間：${saved.savedAt}。請確認文字中的診斷版本與測試時間。`;
    report.value = saved.text;
  }
} catch { status.textContent = '無法讀取本機紀錄。請確認 Safari 允許網站儲存，並使用相同網址來源與瀏覽模式。'; }
