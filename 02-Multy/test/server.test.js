import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAppServer, serverOptions } from '../server.js';

test('serves the app and keeps private files and PWA reservation inaccessible', async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Serial communication assistant/);
    assert.doesNotMatch(html, /rel="manifest"/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(base + '/app.js')).status, 200);
    assert.equal((await fetch(base + '/live-ble-picker.js')).status, 200);
    for (const path of ['/ble-diagnostic-report.html', '/ble-diagnostic-report.js', '/beacio-reference.js', '/diagnostic-overlay.js', '/picker-diagnostic.js', '/ios-bluetooth.js', '/ios-ble.js', '/ble-scan.js', '/beacio-ios.js', '/ble-diagnostics.html', '/ble-diagnostics.js', '/ble-diagnostics.css', '/vendor/beacio-core-2.2.0.js']) {
      const diagnostic = await fetch(base + path);
      assert.equal(diagnostic.status, 200);
      const csp = diagnostic.headers.get('content-security-policy');
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /connect-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    }
    assert.equal((await fetch(base + '/styles.css', { method: 'HEAD' })).status, 200);
    const reportPage = await (await fetch(base + '/ble-diagnostic-report.html')).text();
    assert.doesNotMatch(reportPage, /src="[^\"]*(?:beacio-ios|vendor\/beacio|ble-diagnostics\.js)/);
    const reportScript = await (await fetch(base + '/ble-diagnostic-report.js')).text();
    assert.doesNotMatch(reportScript, /navigator\.(?:bluetooth|beacio)|requestDevice|requestLEScan/);
    for (const path of ['/server.js', '/pwa/manifest.webmanifest', '/package.json', '/missing', '/certs/server.pem', '/certs/server-key.pem', '/firmware/src/main.cpp', '/plan.md']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    assert.equal((await fetch(base + '/..%5Cserver.js')).status, 403);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('TLS needs both files and server defaults allow LAN access', async () => {
  assert.deepEqual(await serverOptions({}), { tls: undefined, host: '0.0.0.0', port: 3000 });
  assert.equal((await serverOptions({ HOST: '127.0.0.1' })).host, '127.0.0.1');
  await assert.rejects(serverOptions({ TLS_CERT_FILE: 'missing.pem' }), /together/);
  await assert.rejects(serverOptions({ TLS_KEY_FILE: 'missing.pem' }), /together/);
  await assert.rejects(serverOptions({ PORT: 'not-a-number' }), /PORT/);
});

test('Beacio style compatibility is opt-in on app and diagnostic documents and never permits inline scripts', async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const baseline = (await fetch(base + '/ble-diagnostics.html')).headers.get('content-security-policy');
    const allowed = await fetch(base + '/ble-diagnostics.html?beacioStyles=1');
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('content-security-policy'), baseline + "; style-src-elem 'self' 'unsafe-inline'");
    for (const directive of allowed.headers.get('content-security-policy').split(';')) {
      if (!directive.trim().startsWith('style-src-elem ')) assert.doesNotMatch(directive, /unsafe-inline|unsafe-eval/);
    }
    for (const path of ['/', '/index.html']) {
      assert.equal((await fetch(base + path)).headers.get('content-security-policy'), baseline);
      assert.equal((await fetch(base + path + '?beacioStyles=1')).headers.get('content-security-policy'), allowed.headers.get('content-security-policy'));
    }
    for (const path of ['/app.js', '/ble-diagnostic-report.html', '/ble-diagnostics.js', '/ble-diagnostics.html?beacioStyles=0']) {
      const response = await fetch(base + path + (path.includes('?') ? '' : '?beacioStyles=1'));
      assert.equal(response.headers.get('content-security-policy'), baseline);
    }
    const missing = await fetch(base + '/missing?beacioStyles=1');
    assert.equal(missing.status, 404); assert.equal(missing.headers.get('content-security-policy'), baseline);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Node, PM2 module loading and npm-inherited PM2 environments start HTTP', { timeout: 15000 }, async () => {
  const scriptUrl = new URL('../server.js', import.meta.url);
  for (const mode of ['node', 'pm2', 'npm']) {
    const probe = createAppServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port) };
    delete env.TLS_CERT_FILE; delete env.TLS_KEY_FILE; delete env.pm_exec_path;
    if (mode === 'pm2') env.pm_exec_path = fileURLToPath(scriptUrl);
    if (mode === 'npm') env.pm_exec_path = fileURLToPath(new URL('../npm-cli.js', import.meta.url));
    const args = mode === 'pm2' ? ['--input-type=module', '-e', `await import(${JSON.stringify(scriptUrl.href)})`] : [fileURLToPath(scriptUrl)];
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', data => { output += data; });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 5000);
        const finish = callback => { clearTimeout(timer); callback(); };
        child.on('error', error => finish(() => reject(error)));
        child.on('exit', code => finish(() => reject(new Error(`Exited ${code}: ${output}`))));
        child.stdout.on('data', data => {
          output += data;
          if (output.includes('Multy is ready at')) finish(resolve);
        });
      });
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill(); await exited;
      }
    }
  }
});
