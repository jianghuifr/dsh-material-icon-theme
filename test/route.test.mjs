// Contract tests for the host route: `createRoute(...).handler` is called
// directly with tiny mock req/res objects (no HTTP server needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PREFIX, apply, createRoute, loadIndex, resolveIcon } from '../lib/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ICONS_DIR = join(ROOT, 'assets', 'icons');
const index = loadIndex();

/** Minimal response mock: statusCode/setHeader/getHeader/hasHeader/writeHead/end. */
function createMockResponse() {
  const res = {
    statusCode: 0,
    headers: Object.create(null),
    body: null,
    bytes: 0,
    ended: false,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return res.headers[name.toLowerCase()];
    },
    hasHeader(name) {
      return name.toLowerCase() in res.headers;
    },
    writeHead(status, headers) {
      res.statusCode = status;
      for (const [name, value] of Object.entries(headers || {})) res.setHeader(name, value);
      return res;
    },
    end(body) {
      res.ended = true;
      if (body === undefined || body === null) {
        res.body = null;
        res.bytes = 0;
        return;
      }
      res.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      res.bytes = res.body.length;
    },
  };
  return res;
}

async function request(handler, url, method = 'GET') {
  const res = createMockResponse();
  await handler({ method, url }, res);
  return res;
}

function plainHeaders(res) {
  return { ...res.headers };
}

/**
 * Pick `limit` requests that resolve to distinct vendored icon basenames, so
 * every one of them must open a separate cache entry.
 */
function distinctIconRequests(limit) {
  const picked = new Map();
  const isSafeName = (name) =>
    typeof name === 'string' && name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('\0') && !name.includes('..');
  const add = (name, options) => {
    if (!isSafeName(name) || picked.size >= limit) return;
    const basename = resolveIcon(index, name, options);
    if (!basename || picked.has(basename)) return;
    picked.set(basename, { name, basename, options });
  };
  for (const name of Object.keys(index.fileNames)) add(name, {});
  for (const extension of Object.keys(index.fileExtensions)) {
    if (extension !== extension.toLowerCase()) continue;
    add(`zzprobe.${extension}`, {});
  }
  for (const name of Object.keys(index.folderNames)) add(name, { isDir: true });
  return [...picked.values()].slice(0, limit);
}

test('GET serves an SVG with the full response header set', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/tsconfig.json`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(res.getHeader('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
  assert.equal(res.getHeader('content-length'), String(res.body.length));
  assert.ok(res.body.length > 0);
  assert.ok(res.body.toString('utf8').trimStart().startsWith('<svg'));
});

test('GET ?d=1 serves the exact folder-project.svg bytes', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/project?d=1`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'image/svg+xml; charset=utf-8');
  assert.deepEqual(res.body, readFileSync(join(ICONS_DIR, 'folder-project.svg')));
});

test('GET ?d=1&o=1 serves the folder-project-open.svg bytes', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/project?d=1&o=1`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, readFileSync(join(ICONS_DIR, 'folder-project-open.svg')));
});

test('HEAD sends identical headers and no body', async () => {
  const { handler } = createRoute({ index });
  const getRes = await request(handler, `${PREFIX}/project?d=1`);
  const headRes = await request(handler, `${PREFIX}/project?d=1`, 'HEAD');
  assert.equal(headRes.statusCode, 200);
  assert.deepEqual(plainHeaders(headRes), plainHeaders(getRes));
  assert.equal(headRes.bytes, 0);
  assert.equal(headRes.body, null);
});

test('404 when the index cannot resolve the name', async () => {
  const emptyIndex = {
    definitions: {},
    fileNames: {},
    fileExtensions: {},
    folderNames: {},
    folderNamesExpanded: {},
    defaults: {},
  };
  const { handler } = createRoute({ index: emptyIndex });
  const res = await request(handler, `${PREFIX}/mystery.zzz`);
  assert.equal(res.statusCode, 404);
});

test('400 for malformed percent-encoding', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/%zz`);
  assert.equal(res.statusCode, 400);
});

test('404 for an encoded slash', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/%2F`);
  assert.equal(res.statusCode, 404);
});

test('404 for an encoded NUL byte', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/tsconfig.json%00`);
  assert.equal(res.statusCode, 404);
});

test('404 for traversal attempts', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/..%2F..%2Fpackage.json`);
  assert.equal(res.statusCode, 404);
});

test('405 for POST with an allow header', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/tsconfig.json`, 'POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader('allow'), 'GET, HEAD');
});

test('405 for PUT with an allow header', async () => {
  const { handler } = createRoute({ index });
  const res = await request(handler, `${PREFIX}/tsconfig.json`, 'PUT');
  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader('allow'), 'GET, HEAD');
});

test('404 when assetsDir has no icons directory', async () => {
  const { handler } = createRoute({ index, assetsDir: join(ROOT, 'assets', 'does-not-exist') });
  const res = await request(handler, `${PREFIX}/tsconfig.json`);
  assert.equal(res.statusCode, 404);
});

test('cache is cleared at 512 entries: 513 distinct icons leaves size 1', async () => {
  const route = createRoute({ index });
  const picks = distinctIconRequests(513);
  assert.equal(picks.length, 513);
  for (const pick of picks) {
    const query = pick.options.isDir ? '?d=1' : '';
    const res = await request(route.handler, `${PREFIX}/${encodeURIComponent(pick.name)}${query}`);
    assert.equal(res.statusCode, 200, `expected 200 for ${pick.name}`);
    assert.ok(route.cache.has(pick.basename), `cache should hold ${pick.basename} after ${pick.name}`);
  }
  assert.equal(route.cache.size, 1);
  assert.equal([...route.cache.keys()][0], picks[picks.length - 1].basename);
});

test('404 for pathnames outside the prefix', async () => {
  const { handler } = createRoute({ index });
  const outside = await request(handler, '/other/tsconfig.json');
  assert.equal(outside.statusCode, 404);
  // Extra path segments under the prefix are not a single encoded name.
  const nested = await request(handler, `${PREFIX}/extra/tsconfig.json`);
  assert.equal(nested.statusCode, 404);
});

test('apply registers a prefix route at PREFIX', () => {
  let route;
  const ctx = {
    effect(fn) {
      fn();
      return () => {};
    },
    webServer: {
      register(candidate) {
        route = candidate;
        return () => {};
      },
    },
  };
  apply(ctx);
  assert.ok(route, 'webServer.register should be called');
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, PREFIX);
  assert.equal(route.path, '/material-icon-theme');
  assert.equal(typeof route.handler, 'function');
});
