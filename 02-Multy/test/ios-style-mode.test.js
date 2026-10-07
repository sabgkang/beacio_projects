import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../public/ios-style-mode.js', import.meta.url), 'utf8');
function run(navigator, href) {
  const redirects = [];
  runInNewContext(script, { navigator, URL, location: { href, replace: url => redirects.push(url) } });
  return redirects;
}
test('iOS loads compatible app document once, preserving query and hash even in desktop website mode', () => {
  for (const nav of [{ userAgent: 'iPhone Safari', platform: 'iPhone', maxTouchPoints: 5 }, { userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }]) {
    const result = run(nav, 'https://example.com/index.html?existing=ok#uart');
    assert.deepEqual(result, ['https://example.com/index.html?existing=ok&beacioStyles=1#uart']);
    assert.deepEqual(run(nav, result[0]), []);
  }
});
test('Windows, actual Mac, Android and non-Safari iPhone browsers retain the PC document and APIs', () => {
  for (const nav of [{ userAgent: 'Chrome Windows', platform: 'Win32', maxTouchPoints: 10 }, { userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 0 }, { userAgent: 'Android Chrome' }, { userAgent: 'iPhone CriOS' }]) {
    const bluetooth = {};
    assert.deepEqual(run({ ...nav, bluetooth }, 'https://example.com/'), []);
  }
});
