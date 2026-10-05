import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

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
    assert.equal((await fetch(base + '/styles.css', { method: 'HEAD' })).status, 200);
    for (const path of ['/server.js', '/pwa/manifest.webmanifest', '/package.json', '/missing']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    assert.equal((await fetch(base + '/..%5Cserver.js')).status, 403);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
