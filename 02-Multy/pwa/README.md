# PWA reservation (disabled)

This folder is outside the Node server's public directory. The app has no manifest link, no service worker registration, no offline cache, and no install prompt.

When PWA support is explicitly requested:

1. Add 192×192 and 512×512 PNG icons, including a maskable icon.
2. Move the manifest into `public/` and link it from `public/index.html`.
3. Design an offline strategy before adding a service worker. Never replay hardware commands from an offline queue.
4. Serve over HTTPS and verify Safari / iPhone standalone behavior and the Multy extension's availability before enabling installation.

The current viewport safe-area handling and theme-color metadata can be reused.
