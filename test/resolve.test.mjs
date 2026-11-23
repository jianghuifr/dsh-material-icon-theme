// Contract tests for `resolveIcon` against the real vendored 5.38.1 assets.
// Pins the VS Code-compatible resolution order from .tmp/SPEC.md §2.3.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadIndex, resolveIcon } from '../lib/index.js';

const index = loadIndex();
const resolve = (name, options) => resolveIcon(index, name, options);

test('vendored 5.38.1 index has the expected table sizes', () => {
  assert.equal(index.version, '5.38.1');
  assert.equal(Object.keys(index.definitions).length, 1251);
  assert.equal(Object.keys(index.fileNames).length, 2135);
  assert.equal(Object.keys(index.fileExtensions).length, 1377);
  assert.equal(Object.keys(index.folderNames).length, 4654);
  assert.equal(Object.keys(index.folderNamesExpanded).length, 4654);
});

test('exact file name wins: tsconfig.json -> tsconfig.svg', () => {
  assert.equal(resolve('tsconfig.json'), 'tsconfig.svg');
});

test('file name lookup falls back to a lowercased key', () => {
  assert.equal(resolve('README.md'), 'readme.svg');
  assert.equal(resolve('ReadMe.md'), 'readme.svg');
  assert.equal(resolve('readme.md'), 'readme.svg');
});

test('extension chain tries the longest suffix first', () => {
  // `a.spec.ts` must try `spec.ts` before `ts`.
  assert.equal(resolve('a.spec.ts'), 'test-ts.svg');
  assert.equal(resolve('foo.ts'), 'typescript.svg');
});

test('fileNames beats the extension table: package.json -> nodejs.svg', () => {
  assert.equal(resolve('package.json'), 'nodejs.svg');
});

test('simple extension mapping: Cargo.toml -> toml.svg', () => {
  assert.equal(resolve('Cargo.toml'), 'toml.svg');
});

test('tsx extension mapping: App.tsx -> react_ts.svg', () => {
  assert.equal(resolve('App.tsx'), 'react_ts.svg');
});

test('unknown files fall back to the theme default file.svg', () => {
  assert.equal(resolve('mystery.unknownext'), 'file.svg');
  assert.equal(resolve('no-extension-file'), 'file.svg');
});

test('known folder: src -> folder-src.svg', () => {
  assert.equal(resolve('src', { isDir: true }), 'folder-src.svg');
});

test('expanded folder: src -> folder-src-open.svg', () => {
  assert.equal(resolve('src', { isDir: true, expanded: true }), 'folder-src-open.svg');
});

test('folder project and case-insensitive folder lookup', () => {
  assert.equal(resolve('project', { isDir: true }), 'folder-project.svg');
  assert.equal(resolve('Project', { isDir: true }), 'folder-project.svg');
  assert.equal(resolve('PROJECT', { isDir: true, expanded: true }), 'folder-project-open.svg');
});

test('unknown folders use defaults folder/folder-open', () => {
  assert.equal(resolve('no-such-folder', { isDir: true }), 'folder.svg');
  assert.equal(resolve('no-such-folder', { isDir: true, expanded: true }), 'folder-open.svg');
});
