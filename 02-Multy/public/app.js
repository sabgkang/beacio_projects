import { detectDevice, parseHex, formatBytes } from './core.js';
import { DemoTransport } from './transport.js';

const $ = selector => document.querySelector(selector);
const device = detectDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
document.documentElement.dataset.device = device;
const mobileLayout = matchMedia('(max-width: 760px)');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const transport = new DemoTransport();
let method = device === 'pc' ? 'serial' : 'ble';
let connecting = false;
let selectedProtocol = 'uart';
let selectedInstance = 1;
let maximizedChannel = null;
let gridHeight = 0;
let toastTimer;
let themePreference;
try { themePreference = localStorage.getItem('multy-theme'); } catch {}

const definitions = {
  uart: { label: 'UART', icon: 'terminal', input: '48 65 6C 6C 6F', outputLabel: 'TX → Target', receiveLabel: 'RX ← Target', action: 'Send' },
  i2c: { label: 'I2C', icon: 'arrows', input: '00 A5 5A', outputLabel: 'OUT → Target (Write)', receiveLabel: 'IN ← Target (Read)', action: 'Write' },
  spi: { label: 'SPI', icon: 'chip', input: '9F 00 00 00', outputLabel: 'OUT → Target (Transmit)', receiveLabel: 'IN ← Target (Receive)', action: 'Transfer' }
};
const icons = {
  terminal: '<rect x="3" y="4" width="22" height="19" rx="3"/><path d="m7 9 4 4-4 4m7 0h5"/>',
  arrows: '<path d="M4 9h20m-5-5 5 5-5 5M24 19H4m5-5-5 5 5 5"/>',
  chip: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M11 3v4m6-4v4m-6 14v4m6-4v4M3 11h4m-4 6h4m14-6h4m-4 6h4M11 11h6v6h-6z"/>'
};
const channels = new Map();
function selectField(id, label, options) {
  return `<label class="setting" for="${id}"><span>${label}</span><select id="${id}">${options.map(value => `<option>${value}</option>`).join('')}</select></label>`;
}

for (let instance = 1; instance <= 2; instance++) {
  for (const [protocol, definition] of Object.entries(definitions)) {
    const id = `${protocol}${instance}`;
    const settings = protocol === 'uart'
      ? selectField(`${id}-baud`, 'Baud rate', ['115200', '9600', '19200', '38400', '57600', '230400'])
        + selectField(`${id}-databits`, 'Data Bits', ['8', '9'])
        + selectField(`${id}-parity`, 'Parity', ['N', 'Y'])
        + selectField(`${id}-stop`, 'Stop', ['1', '0'])
      : protocol === 'i2c'
        ? selectField(`${id}-address`, 'Address (7-bit)', ['0x3C', '0x3D', '0x48', '0x50', '0x68', '0x76']) + selectField(`${id}-clock`, 'Clock rate', ['400 kHz', '100 kHz', '1 MHz'])
        : selectField(`${id}-clock`, 'Clock rate', ['1 MHz', '100 kHz', '500 kHz', '4 MHz', '8 MHz']) + selectField(`${id}-mode`, 'Mode', ['Mode 0', 'Mode 1', 'Mode 2', 'Mode 3']);
    const card = document.createElement('section');
    card.className = `interface-card ${protocol}`;
    card.dataset.protocol = protocol;
    card.dataset.instance = instance;
    card.setAttribute('aria-labelledby', `${id}-title`);
    card.innerHTML = `<header class="card-header"><span class="interface-icon" aria-hidden="true"><svg viewBox="0 0 28 28">${icons[definition.icon]}</svg></span><div class="card-title"><h2 id="${id}-title">${definition.label}${instance}</h2></div></header><div class="settings ${protocol === 'uart' ? 'single' : ''}">${settings}</div><div class="io-grid"><form class="transmit"><label class="io-label" for="${id}-tx">${definition.outputLabel}</label><textarea id="${id}-tx" class="hex-input" rows="1" wrap="soft" aria-label="${definition.label}${instance} hexadecimal bytes" spellcheck="false" autocomplete="off" autocapitalize="characters" maxlength="767">${definition.input}</textarea><button class="primary" type="submit">${definition.action}</button><p class="input-error" id="${id}-error" role="alert" hidden></p></form><div class="receive"><div class="receive-heading"><span class="io-label">${definition.receiveLabel}</span><div class="log-actions"><button type="button" data-action="clear" aria-label="Clear ${definition.label}${instance} received data">Clear</button><button type="button" data-action="copy" aria-label="Copy ${definition.label}${instance} received data"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="5" width="10" height="12" rx="2"/><path d="M12 5V3H4v11h2"/></svg>Copy</button></div></div><div class="receive-data" tabindex="0" aria-label="${definition.label}${instance} received data"></div></div></div>`;
    $('#interface-panel').append(card);
    const cardTools = document.createElement('div');
    cardTools.className = 'card-tools';
    const maximizeButton = document.createElement('button');
    maximizeButton.type = 'button';
    maximizeButton.className = 'card-maximize';
    cardTools.append(maximizeButton);
    card.prepend(cardTools);
    const initialBytes = protocol === 'uart' ? [0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x0D, 0x0A] : protocol === 'i2c' ? [0x3C, 0x00, 0xA5, 0x5A] : [0xEF, 0x40, 0x18, 0, 0, 0, 0];
    const channel = { card, protocol, instance, bytes: initialBytes, busy: false };
    channels.set(id, channel);
    maximizeButton.addEventListener('click', () => {
      if (maximizedChannel === channel) {
        maximizedChannel = null;
      } else {
        gridHeight = $('#interface-panel').getBoundingClientRect().height;
        maximizedChannel = channel;
        selectedProtocol = protocol;
        selectedInstance = instance;
      }
      updateLayout();
    });
    renderLog(channel);
    card.querySelector('form').addEventListener('submit', event => { event.preventDefault(); exchange(channel, 'write'); });
    const input = card.querySelector('.hex-input');
    input.addEventListener('input', () => { showInputError(channel, ''); resizeInput(input); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        card.querySelector('form').requestSubmit();
      }
    });
    card.querySelector('[data-action="clear"]').addEventListener('click', () => { channel.bytes = []; renderLog(channel); notify(`${definition.label}${instance} received data cleared.`); });
    card.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      if (!channel.bytes.length) return notify('No received data to copy.');
      try {
        await navigator.clipboard.writeText(formatBytes(channel.bytes).map(row => row.hex).join('\n'));
        notify(`${definition.label}${instance} received data copied.`);
      } catch { notify('Copy is unavailable here. Select the received data and copy it manually.'); }
    });
  }
}

function resizeInput(input) {
  if (!input.getClientRects().length) return;
  input.style.height = 'auto';
  const border = input.offsetHeight - input.clientHeight;
  input.style.height = `${input.scrollHeight + border}px`;
}
function resizeInputs() {
  document.querySelectorAll('.hex-input').forEach(resizeInput);
}
function renderLog(channel) {
  const log = channel.card.querySelector('.receive-data');
  log.replaceChildren();
  if (!channel.bytes.length) { const empty = document.createElement('span'); empty.className = 'empty-log'; empty.textContent = 'No received data'; log.append(empty); }
  for (const line of formatBytes(channel.bytes)) {
    const row = document.createElement('div'); row.className = 'log-row';
    const hex = document.createElement('span'); hex.textContent = line.hex;
    const ascii = document.createElement('span'); ascii.className = 'ascii'; ascii.textContent = line.ascii;
    row.append(hex, ascii); log.append(row);
  }
}
function showInputError(channel, message) {
  const input = channel.card.querySelector('.hex-input');
  const error = channel.card.querySelector('.input-error');
  error.textContent = message; error.hidden = !message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
  if (message) input.setAttribute('aria-describedby', error.id); else input.removeAttribute('aria-describedby');
}
async function exchange(channel, action) {
  if (channel.busy) return;
  if (!transport.connected) { notify('Connect the demo device first.'); $('#connect').focus(); return; }
  let bytes = [];
  if (action !== 'read') {
    try { bytes = parseHex(channel.card.querySelector('.hex-input').value); showInputError(channel, ''); }
    catch (error) { showInputError(channel, error.message); channel.card.querySelector('.hex-input').focus(); return; }
  }
  channel.busy = true;
  const buttons = [...channel.card.querySelectorAll('.primary')]; buttons.forEach(button => button.disabled = true);
  try {
    const settings = Object.fromEntries([...channel.card.querySelectorAll('select')].map(select => [select.id.split('-').pop(), select.value]));
    const received = await transport.exchange({ protocol: channel.protocol, instance: channel.instance, action, bytes, settings });
    if (received.length) { channel.bytes = received; renderLog(channel); }
    notify(`${definitions[channel.protocol].label}${channel.instance}: ${action === 'read' ? 'read complete' : `${bytes.length} bytes ${channel.protocol === 'spi' ? 'transferred' : 'sent'}`} (demo).`);
  } catch (error) { notify(error.message); }
  finally { channel.busy = false; buttons.forEach(button => button.disabled = false); }
}
function notify(message) {
  const toast = $('#toast'); clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false;
  toastTimer = setTimeout(() => toast.hidden = true, 4500);
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#071625' : '#f8faff';
  const button = $('#theme-toggle');
  button.innerHTML = theme === 'dark' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/></svg>';
  button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  button.title = button.getAttribute('aria-label');
  resizeInputs();
}
$('#theme-toggle').addEventListener('click', () => {
  themePreference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(themePreference); try { localStorage.setItem('multy-theme', themePreference); } catch {}
});
$('#refresh-app').addEventListener('click', () => window.location.reload());
systemTheme.addEventListener('change', event => { if (!['light', 'dark'].includes(themePreference)) applyTheme(event.matches ? 'dark' : 'light'); });
applyTheme(document.documentElement.dataset.theme);

function updateConnection() {
  if (device === 'iphone') method = 'ble';
  document.querySelectorAll('[data-transport]').forEach(button => {
    const active = button.dataset.transport === method;
    const unavailable = device === 'iphone' && button.dataset.transport === 'serial';
    button.hidden = unavailable;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.disabled = unavailable || transport.connected || connecting;
  });
  $('#port-setting').hidden = method !== 'serial';
  $('#serial-port').disabled = transport.connected;
  $('#connect').textContent = transport.connected ? 'Disconnect' : 'Connect';
  $('#connect').disabled = connecting;
  $('#connection-status').textContent = connecting ? (transport.connected ? 'Disconnecting…' : 'Connecting…') : transport.connected ? 'Connected · demo' : 'Disconnected';
  $('.connection-status').classList.toggle('connected', transport.connected);
  $('.ready-status').innerHTML = `<span class="status-dot ready"></span>${transport.connected ? 'Demo device connected' : 'Ready for connection'}`;
  $('#mobile-transport-name').textContent = method === 'ble' ? `${device === 'iphone' ? 'iPhone' : 'Mobile'} · BLE` : 'PC · USB-serial';
  $('.mobile-device-icon').textContent = method === 'ble' ? 'ᛒ' : '▣';
}
document.querySelectorAll('[data-transport]').forEach(button => button.addEventListener('click', () => {
  if (transport.connected || connecting || (device === 'iphone' && button.dataset.transport !== 'ble')) return;
  method = button.dataset.transport;
  updateConnection();
}));
$('#connect').addEventListener('click', async () => {
  if (connecting) return;
  connecting = true;
  updateConnection();
  try {
    if (transport.connected) await transport.disconnect(); else await transport.connect(method);
    notify(transport.connected ? 'Demo connected. Send, read, or transfer hexadecimal bytes.' : 'Demo device disconnected.');
  } catch (error) {
    notify(error.message);
  } finally {
    connecting = false;
    updateConnection();
  }
});

function updateLayout() {
  const compact = mobileLayout.matches;
  const connectionStatus = $('.connection-status');
  if (compact || device === 'iphone') {
    $('#mobile-status-slot').append(connectionStatus);
  } else {
    $('.connection').insertBefore(connectionStatus, $('.connection-help'));
  }
  const panel = $('#interface-panel');
  panel.classList.toggle('is-maximized', Boolean(maximizedChannel));
  panel.style.minHeight = maximizedChannel && !compact ? `${gridHeight}px` : '';
  $('.mobile-navigation').hidden = Boolean(maximizedChannel);
  if (compact) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `tab-${selectedProtocol}`); }
  else { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); }
  for (const channel of channels.values()) {
    const maximized = maximizedChannel === channel;
    channel.card.hidden = maximizedChannel ? !maximized : compact && (channel.protocol !== selectedProtocol || channel.instance !== selectedInstance);
    channel.card.classList.toggle('is-maximized', maximized);
    const button = channel.card.querySelector('.card-maximize');
    button.innerHTML = maximized
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V4h12v12h-4"/><rect x="4" y="8" width="12" height="12" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>';
    button.setAttribute('aria-label', `${maximized ? 'Restore' : 'Maximize'} ${definitions[channel.protocol].label}${channel.instance}`);
    button.setAttribute('aria-pressed', String(maximized));
    button.title = button.getAttribute('aria-label');
  }
  document.querySelectorAll('[data-protocol][role="tab"]').forEach(tab => {
    const active = tab.dataset.protocol === selectedProtocol;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-instance]').forEach(button => {
    if (button.tagName !== 'BUTTON') return;
    button.textContent = definitions[selectedProtocol].label + button.dataset.instance;
    const active = Number(button.dataset.instance) === selectedInstance;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  resizeInputs();
}
const protocolTabs = [...document.querySelectorAll('[role="tab"]')];
protocolTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => { selectedProtocol = tab.dataset.protocol; updateLayout(); });
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % 3;
    if (event.key === 'ArrowLeft') next = (index + 2) % 3;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = 2;
    if (next !== undefined) { event.preventDefault(); protocolTabs[next].click(); protocolTabs[next].focus(); }
  });
});
document.querySelectorAll('button[data-instance]').forEach(button => button.addEventListener('click', () => { selectedInstance = Number(button.dataset.instance); updateLayout(); }));
mobileLayout.addEventListener('change', updateLayout);
window.addEventListener('resize', resizeInputs);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && maximizedChannel) {
    const button = maximizedChannel.card.querySelector('.card-maximize');
    maximizedChannel = null;
    updateLayout();
    button.focus();
  }
});
updateLayout(); updateConnection();

// PWA is intentionally disabled: no manifest link, service worker, or install prompt.
