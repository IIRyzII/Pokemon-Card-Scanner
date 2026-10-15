// Keeps the app loadable on older phones. One unsupported regex feature makes Safari refuse
// the whole file it's in, and for the scanner that meant a crash every time Scan opened.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

function sources(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const url = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, dir);
    if (e.isDirectory()) return sources(url);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [url] : [];
  });
}

test('no regex lookbehind (unsupported before iOS 16.4)', () => {
  const files = [...sources(new URL('./', import.meta.url)), ...sources(new URL('../../shared/', import.meta.url))];
  const offenders = files.filter((f) => /\(\?<[!=]/.test(readFileSync(f, 'utf8'))).map((f) => f.pathname);
  assert.deepEqual(offenders, []);
});
