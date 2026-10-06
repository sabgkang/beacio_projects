import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { get } from 'node:https';
import { createAppServer, serverOptions } from '../server.js';

const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : '/usr/bin/openssl';
test('HTTPS serves through a trusted test certificate and keeps private paths inaccessible', { skip: !existsSync(openssl) }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multy-tls-'));
  const certFile = join(directory, 'server.pem'), keyFile = join(directory, 'server-key.pem');
  let server;
  try {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-out', certFile, '-keyout', keyFile], { stdio: 'pipe' });
    const options = await serverOptions({ TLS_CERT_FILE: certFile, TLS_KEY_FILE: keyFile });
    assert.equal(options.port, 3443); server = createAppServer(options.tls);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const ca = await readFile(certFile);
    async function request(path) {
      return new Promise((resolve, reject) => {
        get({ hostname: '127.0.0.1', port: server.address().port, path, ca, rejectUnauthorized: true }, response => {
          let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode, body }));
        }).on('error', reject);
      });
    }
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/certs/server-key.pem')).status, 404);
    assert.equal((await request('/firmware/platformio.ini')).status, 404);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary cleanup path');
    await rm(target, { recursive: true, force: true });
  }
});
