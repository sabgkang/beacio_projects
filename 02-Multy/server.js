import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const publicDirectory = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

export function createAppServer() {
  return createServer(async (request, response) => {
    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.includes('\\') || pathname.includes('\0')) {
        response.writeHead(403, headers);
        response.end('Forbidden');
        return;
      }
      const target = resolve(publicDirectory, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(publicDirectory + sep)) {
        response.writeHead(403, headers);
        response.end('Forbidden');
        return;
      }
      const data = await readFile(target);
      response.writeHead(200, { ...headers, 'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error instanceof URIError ? 400 : error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500;
      response.writeHead(status, headers);
      response.end(status === 400 ? 'Bad request' : status === 404 ? 'Not found' : 'Server error');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  createAppServer().listen(port, host, () => console.log(`Multy is ready at http://${host}:${port}`));
}
