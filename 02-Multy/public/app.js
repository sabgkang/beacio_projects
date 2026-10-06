import { detectDevice, parseHex, formatBytes, formatUartInput, UART_ROW_BYTES, UART_MAX_ROW_BYTES } from './core.js';
import { BleTransport, SerialTransport } from './transport.js';
import { PINS, ReceiveBuffer, fromHex } from './protocol.js';

const $ = selector => document.querySelector(selector);
const device = detectDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
document.documentElement.dataset.device = device;
const mobileLayout = matchMedia('(max-width: 760px)');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const callbacks = { onState: () => updateConnection(), onEvent: frame => receiveEvent(frame), onDisconnect: error => {
  for (const channel of channels.values()) channel.ended = true;
  updateConnection(); scheduleLogs(); notify(error.message);
} };
const serialTransport = new SerialTransport(callbacks);
const bleTransport = new BleTransport(callbacks);
let method = device === 'pc' ? 'serial' : 'ble';
let transport = method === 'serial' ? serialTransport : bleTransport;
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
  spi: { label: 'SPI', icon: 'chip', input: '9F 00 00 00', outputLabel: 'OUT → Target (Write)', receiveLabel: 'IN ← Target (Read)', action: 'Write' }
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
function inputField(id, label, value, type = 'text', extra = '') {
  return `<label class="setting" for="${id}"><span>${label}</span><input id="${id}" type="${type}" value="${value}" ${extra}></label>`;
}

for (let instance = 1; instance <= 2; instance++) {
  for (const [protocol, definition] of Object.entries(definitions)) {
    const id = `${protocol}${instance}`;
    const settings = protocol === 'uart'
      ? selectField(`${id}-baud`, 'Baud rate', ['115200', '9600', '19200', '38400', '57600', '230400'])
        + selectField(`${id}-databits`, 'Data Bits', ['8', '7', '6', '5'])
        + selectField(`${id}-parity`, 'Parity', ['None', 'Even', 'Odd'])
        + selectField(`${id}-stop`, 'Stop', ['1', '2'])
      : protocol === 'i2c'
        ? inputField(`${id}-address`, 'Address (7-bit)', '0x3C') + selectField(`${id}-clock`, 'Clock rate', ['400 kHz', '100 kHz']) + inputField(`${id}-length`, 'Read length', '1', 'number', 'min="1" max="256"')
        : selectField(`${id}-clock`, 'Clock rate', ['1 MHz', '100 kHz', '500 kHz', '4 MHz', '8 MHz']) + selectField(`${id}-mode`, 'Mode', ['0', '1', '2', '3']) + inputField(`${id}-length`, 'Read length', '1', 'number', 'min="1" max="256"') + inputField(`${id}-dummy`, 'Dummy byte (hex)', '00', 'text', 'maxlength="2"');
    const card = document.createElement('section');
    card.className = `interface-card ${protocol}`;
    card.dataset.protocol = protocol;
    card.dataset.instance = instance;
    card.setAttribute('aria-labelledby', `${id}-title`);
    card.innerHTML = `<header class="card-header"><span class="interface-icon" aria-hidden="true"><svg viewBox="0 0 28 28">${icons[definition.icon]}</svg></span><div class="card-title"><h2 id="${id}-title">${definition.label}${instance}</h2></div></header><div class="settings ${protocol === 'uart' ? 'single' : ''}">${settings}</div><div class="io-grid"><form class="transmit">${protocol === 'uart' ? `<div class="transmit-heading"><label class="io-label" for="${id}-tx">${definition.outputLabel}</label><div class="transmit-actions"><button class="primary" type="submit">${definition.action}</button></div></div>` : `<div class="transmit-heading"><label class="io-label" for="${id}-tx">${definition.outputLabel}</label><div class="transmit-actions" role="group" aria-label="${definition.label}${instance} operations"><button class="primary" type="button" data-action="read">Read</button><button class="primary" type="submit">Write</button></div></div>`}<textarea id="${id}-tx" class="hex-input" rows="1" wrap="soft" aria-label="${definition.label}${instance} hexadecimal bytes" spellcheck="false" autocomplete="off" autocapitalize="characters" maxlength="767">${definition.input}</textarea><p class="input-error" id="${id}-error" role="alert" hidden></p></form><div class="receive"><div class="receive-heading"><span class="io-label">${definition.receiveLabel}</span><div class="log-actions"><button type="button" data-action="clear" aria-label="Clear ${definition.label}${instance} received data">Clear</button><button type="button" data-action="copy" aria-label="Copy ${definition.label}${instance} received data"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="5" width="10" height="12" rx="2"/><path d="M12 5V3H4v11h2"/></svg>Copy</button></div></div><div class="receive-data" tabindex="0" aria-label="${definition.label}${instance} received data"></div></div></div>`;
    $('#interface-panel').append(card);
    const cardTools = document.createElement('div');
    cardTools.className = 'card-tools';
    const maximizeButton = document.createElement('button');
    maximizeButton.type = 'button';
    maximizeButton.className = 'card-maximize';
    cardTools.append(maximizeButton);
    card.prepend(cardTools);
    const pins = document.createElement('div'); pins.className = 'pin-badges';
    for (const [name, gpio] of Object.entries(PINS[id])) { const badge = document.createElement('span'); badge.textContent = `${name} · GPIO${gpio}`; pins.append(badge); }
    card.querySelector('.settings').before(pins);
    const status = document.createElement('p'); status.className = 'channel-status'; status.setAttribute('role', 'status');
    card.querySelector('.settings').after(status);
    const channel = { card, protocol, instance, log: new ReceiveBuffer(), busy: false, applied: null, ended: false, deviceDropped: 0, rxErrors: 0 };
    if (protocol === 'uart') {
      card.querySelectorAll('.settings select').forEach(select => select.addEventListener('change', () => {
        channel.settingsPending = true;
        if (transport.connected) applyUart(channel);
        else status.textContent = 'Settings will apply when connected';
      }));
    } else if (protocol === 'i2c') {
      const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'primary recover-bus'; recover.textContent = 'Recover bus'; recover.hidden = true;
      status.before(recover); recover.addEventListener('click', () => recoverI2c(channel));
    }
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
    card.querySelector('[data-action="read"]')?.addEventListener('click', () => exchange(channel, 'read'));
    const input = card.querySelector('.hex-input');
    if (protocol === 'uart') {
      const editor = document.createElement('div'); editor.className = 'uart-tx-editor';
      const ascii = document.createElement('pre'); ascii.className = 'uart-tx-ascii ascii'; ascii.setAttribute('aria-label', 'TX ASCII');
      input.before(editor); editor.append(input, ascii); input.wrap = 'off'; input.maxLength = 815;
      formatUartEditor(input);
    }
    input.addEventListener('input', () => { showInputError(channel, ''); if (protocol === 'uart') formatUartEditor(input); resizeInput(input); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        card.querySelector('form').requestSubmit();
      }
    });
    card.querySelector('[data-action="clear"]').addEventListener('click', () => { channel.log.clear(); renderLog(channel); notify(`${definition.label}${instance} received data cleared.`); });
    card.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      if (!channel.log.bytes.length) return notify('No received data to copy.');
      try {
        await navigator.clipboard.writeText(formatBytes(channel.log.bytes, channel.protocol === 'uart' ? uartColumns(channel) : 5).map(row => row.hex).join('\n'));
        notify(`${definition.label}${instance} received data copied.`);
      } catch { notify('Copy is unavailable here. Select the received data and copy it manually.'); }
    });
  }
}

function formatUartEditor(input) {
  const columns = input.closest('.interface-card').classList.contains('is-maximized') ? UART_MAX_ROW_BYTES : UART_ROW_BYTES;
  const formatted = formatUartInput(input.value, input.selectionStart, columns);
  if (!formatted) return;
  input.value = formatted.text; input.setSelectionRange(formatted.caret, formatted.caret);
  input.parentElement.querySelector('.uart-tx-ascii').textContent = formatted.ascii;
}
function uartColumns(channel) {
  return channel.card.classList.contains('is-maximized') ? UART_MAX_ROW_BYTES : UART_ROW_BYTES;
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
  const info = document.createElement('div'); info.className = 'log-info'; info.textContent = `${channel.log.bytes.length} bytes retained · ${channel.log.dropped} truncated · ${channel.deviceDropped} lost on device${channel.rxErrors ? ` · ${channel.rxErrors} UART errors (loss may be unknown)` : ''}${channel.ended ? ' · Ended session' : ''}`; log.append(info);
  if (!channel.log.bytes.length) { const empty = document.createElement('span'); empty.className = 'empty-log'; empty.textContent = 'No received data'; log.append(empty); }
  for (const line of formatBytes(channel.log.bytes.slice(-1024), channel.protocol === 'uart' ? uartColumns(channel) : 5)) {
    const row = document.createElement('div'); row.className = 'log-row';
    const hex = document.createElement('span'); hex.textContent = line.hex;
    const ascii = document.createElement('span'); ascii.className = 'ascii'; ascii.textContent = line.ascii;
    row.append(hex, ascii); log.append(row);
  }
}
let logsScheduled = false;
function scheduleLogs() {
  if (logsScheduled) return; logsScheduled = true;
  requestAnimationFrame(() => { logsScheduled = false; for (const channel of channels.values()) renderLog(channel); });
}
function receiveEvent(frame) {
  if (frame.event === 'uart.rx') {
    const channel = channels.get(`uart${frame.channel}`); if (!channel) return;
    channel.log.append(fromHex(frame.data)); channel.deviceDropped = frame.droppedBytes || 0; channel.rxErrors = frame.rxErrors || 0; scheduleLogs();
  }
}
function channelSettings(channel) {
  const id = `${channel.protocol}${channel.instance}`;
  const value = key => document.getElementById(`${id}-${key}`).value;
  if (channel.protocol === 'uart') return { baud: Number(value('baud')), dataBits: Number(value('databits')), parity: value('parity').toLowerCase(), stopBits: Number(value('stop')) };
  const clock = value('clock').split(' '); const settings = { clockHz: Number(clock[0]) * (clock[1] === 'MHz' ? 1000000 : 1000) };
  if (channel.protocol === 'i2c') {
    const address = value('address');
    if (!/^(?:0x[0-9a-f]{1,2}|\d{1,3})$/i.test(address)) throw new Error('Enter an address such as 0x3C.');
    settings.address = Number(address);
    if (settings.address < 8 || settings.address > 119) throw new Error('Address must be 0x08–0x77.');
  } else settings.mode = Number(value('mode').slice(-1));
  return settings;
}
async function applyUart(channel) {
  if (channel.busy || !transport.connected) return;
  channel.busy = true; updateConnection();
  try {
    const settings = channelSettings(channel);
    const result = await transport.request('uart.configure', { channel: channel.instance, settings });
    channel.applied = result.settings; channel.settingsPending = false; channel.card.querySelector('.channel-status').textContent = 'Settings applied';
  } catch (error) {
    if (channel.applied) showUartSettings(channel);
    channel.settingsPending = false;
    channel.card.querySelector('.channel-status').textContent = error.message; notify(error.message);
  }
  finally { channel.busy = false; updateConnection(); }
}
function showUartSettings(channel) {
  const settings = channel.applied, id = `uart${channel.instance}`;
  for (const [key, value] of Object.entries({ baud: settings.baud, databits: settings.dataBits, parity: settings.parity[0].toUpperCase() + settings.parity.slice(1), stop: settings.stopBits })) document.getElementById(`${id}-${key}`).value = String(value);
}
async function recoverI2c(channel) {
  if (channel.busy || !transport.connected) return;
  channel.busy = true; updateConnection();
  try { await transport.request('i2c.recover', { channel: channel.instance }); channel.card.querySelector('.recover-bus').hidden = true; channel.card.querySelector('.channel-status').textContent = 'Bus recovered'; }
  catch (error) { channel.card.querySelector('.channel-status').textContent = error.message; }
  finally { channel.busy = false; updateConnection(); }
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
  if (!transport.connected) { notify('Connect a device first.'); $('#connect').focus(); return; }
  let bytes = [];
  if (action !== 'read') {
    try { bytes = parseHex(channel.card.querySelector('.hex-input').value, channel.protocol === 'uart'); showInputError(channel, ''); }
    catch (error) { showInputError(channel, error.message); channel.card.querySelector('.hex-input').focus(); return; }
  }
  channel.busy = true;
  updateConnection();
  const buttons = [...channel.card.querySelectorAll('.primary')]; buttons.forEach(button => button.disabled = true);
  try {
    const settings = channelSettings(channel);
    if (channel.protocol === 'uart' && Object.entries(settings).some(([key, value]) => channel.applied?.[key] !== value)) {
      const configured = await transport.request('uart.configure', { channel: channel.instance, settings });
      channel.applied = configured.settings; channel.settingsPending = false;
    }
    const id = `${channel.protocol}${channel.instance}`;
    const length = Number(document.getElementById(`${id}-length`)?.value || 1);
    if (action === 'read' && (!Number.isInteger(length) || length < 1 || length > 256)) throw new Error('Read length must be 1–256.');
    const dummyHex = document.getElementById(`${id}-dummy`)?.value || '00';
    if (channel.protocol === 'spi' && action === 'read' && !/^[0-9a-f]{2}$/i.test(dummyHex)) throw new Error('Dummy byte must contain two hexadecimal digits.');
    const result = await transport.exchange({ protocol: channel.protocol, instance: channel.instance, action, bytes, settings, length, dummy: parseInt(dummyHex, 16) });
    if (result.bytes.length) { channel.log.append(result.bytes); scheduleLogs(); }
    channel.card.querySelector('.channel-status').textContent = `${action === 'read' ? 'Read' : 'Sent'} ${result.count} bytes${result.shortRead ? ' · Short read' : ''}`;
  } catch (error) {
    channel.card.querySelector('.channel-status').textContent = `${error.code ? error.code + ': ' : ''}${error.message}`;
    if (error.code === 'I2C_BUS_STUCK') channel.card.querySelector('.recover-bus').hidden = false;
    notify(error.message);
  }
  finally { channel.busy = false; updateConnection(); }
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
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.disabled = unavailable || transport.isOpen || connecting;
  });
  $('#port-setting').hidden = method !== 'serial';
  $('#serial-port').textContent = serialTransport.label;
  $('#connect').textContent = transport.isOpen ? 'Disconnect' : 'Connect';
  $('#connect').disabled = connecting;
  $('#connection-status').textContent = transport.state;
  $('.connection-status').classList.toggle('connected', transport.connected);
  $('.ready-status').textContent = transport.connected ? 'Device control acquired' : transport.state === 'Busy' ? 'Device controlled by another client' : 'No device control';
  $('.demo-note strong').textContent = method === 'serial' ? 'USB-serial · 115200 8N1' : `BLE · ${bleTransport.chunkBytes} bytes/chunk`;
  $('.footer-detail').textContent = transport.info ? ` · ${transport.info.deviceId} · Firmware ${transport.info.firmware} · Owner: ${transport.info.owner || 'none'}` : ' · Connect to Multy firmware';
  for (const channel of channels.values()) channel.card.querySelectorAll('.primary').forEach(button => { button.disabled = !transport.connected || channel.busy; });
  for (const channel of channels.values()) channel.card.querySelectorAll('.settings input, .settings select').forEach(input => { input.disabled = channel.busy; });
  $('#mobile-transport-name').textContent = method === 'ble' ? `${device === 'iphone' ? 'iPhone' : device === 'pc' ? 'PC' : 'Mobile'} · BLE` : 'PC · USB-serial';
  $('.mobile-device-icon').textContent = method === 'ble' ? 'ᛒ' : '▣';
}
document.querySelectorAll('[data-transport]').forEach(button => button.addEventListener('click', () => {
  if (transport.isOpen || connecting || (device === 'iphone' && button.dataset.transport !== 'ble')) return;
  method = button.dataset.transport;
  transport = method === 'serial' ? serialTransport : bleTransport;
  updateConnection();
}));
$('#connect').addEventListener('click', async () => {
  if (connecting) return;
  connecting = true;
  updateConnection();
  try {
    if (transport.isOpen) {
      await transport.disconnect();
      for (const channel of channels.values()) channel.ended = true;
      scheduleLogs(); notify('Device disconnected.');
    } else {
      await transport.connect();
      if (transport.connected) {
        for (const channel of channels.values()) {
          channel.log.clear(); channel.ended = false; channel.deviceDropped = 0; channel.rxErrors = 0;
          channel.card.querySelector('.recover-bus')?.setAttribute('hidden', '');
          if (channel.protocol === 'uart') {
            const settings = transport.info.uart[channel.instance - 1]; channel.applied = settings;
            if (channel.settingsPending) await applyUart(channel);
            else { showUartSettings(channel); channel.card.querySelector('.channel-status').textContent = 'Settings applied'; }
          }
        }
        scheduleLogs(); notify('Connected. Device control acquired.');
      } else notify('Device is controlled by another client. Disconnect and try again after it releases control.');
    }
  } catch (error) {
    notify(error.name === 'NotFoundError' ? 'No device selected.' : error.message);
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
    if (channel.protocol === 'uart' && channel.rowBytes !== uartColumns(channel)) {
      channel.rowBytes = uartColumns(channel);
      formatUartEditor(channel.card.querySelector('.hex-input'));
      renderLog(channel);
    }
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
