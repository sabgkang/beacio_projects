# Multy

Adaptive Node.js web app based on `Multy-Light.png` and `Multy-Dark.png`. No runtime dependencies or bundler are required.

## Run

Requires Node.js 20 or newer. From `02-Multy`:

```sh
npm start
# Or, without npm:
node server.js
```

Open http://localhost:3000. Use `npm run dev` for Node server file watching; refresh the browser after frontend edits. Run `npm test` or `node --test` for validation.

To access it from an iPhone on the same network, bind to the network interface. In PowerShell:

```powershell
$env:HOST = '0.0.0.0'
node server.js
```

Then open `http://<your-PC-LAN-IP>:3000` in Safari. The default binds only to localhost. `PORT` can override port 3000. Clipboard access generally requires HTTPS or localhost; the app provides manual-copy feedback when unavailable.

## Behavior

- Light and dark palettes follow the supplied PNGs; initial theme follows the system and manual changes persist locally.
- PC shows UART1/2, I2C1/2, and SPI1/2 together. Up to 760px, the UI shows protocol tabs and instance selection, preserving each panel's values and received data. Intermediate desktop widths show two columns.
- Device detection distinguishes PC, iPhone, iPad, and other mobile devices. PC defaults to USB-serial; iPhone and mobile default to BLE. Layout follows available viewport width so resizing and landscape remain usable.
- iPhone allows BLE only in both orientations. Connect sits to the right of BLE, connection status appears below, and a connected session shows Disconnect.
- With PC · USB-serial selected, Connect opens the browser's Web Serial port picker and opens the selected port using UART1's baud rate and 8N1 settings. Disconnect closes the port; cancellation, open failures, and unplugging update the connection state. Desktop Chrome / Edge and HTTPS or localhost are required. The selected port is identified by USB vendor/product IDs when available; Web Serial does not expose the OS COM name.
- Web Serial does not support the UI's 9 data bits or 0 stop bits. Parity Y does not specify even or odd parity. Select 8, N, and 1 in UART1 to connect; unsupported choices produce an explanation instead of silently changing settings. UART2 settings do not configure this single host serial port.
- BLE remains a simulated session. In that mode, Send validates hex and echoes UART bytes; I2C has a Write action; SPI returns a demo response. Clear and Copy act on each panel independently.
- Every card has a maximize icon. On desktop it expands into the full six-card area; the restore icon or Escape restores the grid without losing settings or data. On mobile it expands the selected card and hides the tabs until restored.
- Transmit fields wrap and automatically grow as bytes are entered. Received data wraps and grows without an internal scrolling limit; long content scrolls with the page in both restored and maximized views. Enter adds a line; Ctrl+Enter (or Cmd+Enter) sends.
- Web Serial opens a real port, but UART/I2C/SPI hardware commands are **not implemented yet**. Sample RX data is cleared when a real serial port is opened, and command buttons explain the missing integration rather than simulate hardware responses. `public/transport.js` separates the real serial connection from the BLE demo adapter; firmware framing, channel commands, and BLE UUIDs must be defined to implement data exchange. The existing `01-Test` heart-rate firmware does not implement UART/I2C/SPI commands.
- PWA support is reserved in `pwa/`, outside the served directory. There is no active manifest, service worker, cache, or installation flow.

## Structure

```text
server.js       Node HTTP server; serves only public files
public/         HTML, adaptive CSS, browser modules, favicon
pwa/            Inactive manifest template and activation notes
test/           Node tests for device detection, byte handling, and demo transport
```

All fonts and assets are local; the app makes no external network requests.
