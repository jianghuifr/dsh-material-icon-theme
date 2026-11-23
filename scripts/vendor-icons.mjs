#!/usr/bin/env node
/**
 * Vendor the Material Icon Theme assets into `assets/`.
 *
 * Source: an unpacked `pkief.material-icon-theme` VS Code extension directory
 * (contains `icons/`, `dist/material-icons.json` and `package.json`).
 *
 * Usage:
 *   node scripts/vendor-icons.mjs --from <extension-dir>
 *   node scripts/vendor-icons.mjs                 # auto-detect installed extension
 *
 * Output (byte-for-byte SVG copies + compact mapping table):
 *   assets/icons/*.svg
 *   assets/index.json   { version, definitions, fileNames, fileExtensions,
 *                         folderNames, folderNamesExpanded, defaults }
 *   assets/source.json  upstream package/version/homepage/license
 *
 * Zero dependencies; re-runs are idempotent (stale SVGs are deleted first).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'assets');
const ICONS_DIR = join(ASSETS_DIR, 'icons');

const EXTENSION_ID = 'pkief.material-icon-theme';
const PREFERRED_VERSION = '5.38.1';
const HOMEPAGE_FALLBACK = 'https://github.com/material-extensions/vscode-material-icon-theme';
/** Extension roots relative to the user home directory, checked in order. */
const EXTENSION_ROOTS = ['.vscode', '.cursor', '.windsurf'];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node scripts/vendor-icons.mjs [--from <extension-dir>]');
    return;
  }
  const extDir = args.from ? resolve(args.from) : discoverExtension();
  if (!existsSync(extDir) || !statSync(extDir).isDirectory()) {
    fail(`extension directory not found: ${extDir}`);
  }

  const manifestFile = findManifest(extDir);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const pkg = readExtensionPackage(extDir);
  const version = typeof pkg.version === 'string' ? pkg.version : '';
  if (!version) fail(`extension package.json has no version: ${join(extDir, 'package.json')}`);

  const iconDefinitions = manifest.iconDefinitions;
  if (!iconDefinitions || typeof iconDefinitions !== 'object') {
    fail(`${manifestFile}: missing iconDefinitions`);
  }
  const definitions = {};
  const copied = new Set();
  mkdirSync(ICONS_DIR, { recursive: true });
  // Idempotency: drop every previously vendored SVG before copying again.
  for (const entry of readdirSync(ICONS_DIR)) {
    if (entry.toLowerCase().endsWith('.svg')) rmSync(join(ICONS_DIR, entry), { force: true });
  }

  for (const [iconId, definition] of Object.entries(iconDefinitions)) {
    const iconPath = definition && typeof definition.iconPath === 'string' ? definition.iconPath : '';
    if (!iconPath) fail(`iconDefinitions["${iconId}"] has no iconPath`);
    const file = basename(iconPath.split(/[\\/]/).pop() || '');
    if (!/\.svg$/i.test(file)) fail(`iconDefinitions["${iconId}"] is not an .svg: ${iconPath}`);
    const source = join(extDir, 'icons', file);
    if (!existsSync(source)) fail(`referenced icon is missing from ${join(extDir, 'icons')}: ${file}`);
    copyFileSync(source, join(ICONS_DIR, file));
    definitions[iconId] = file;
    copied.add(file);
  }

  // `defaults` store the vendored basenames (not icon ids), matching the runtime
  // index convention documented in .tmp/SPEC.md appendix.
  const defaults = {
    file: definitionBasename(iconDefinitions, manifest.file, 'file'),
    folder: definitionBasename(iconDefinitions, manifest.folder, 'folder'),
    folderOpen: definitionBasename(iconDefinitions, manifest.folderExpanded, 'folderExpanded'),
  };

  // Key order is part of the contract: version, definitions, tables, defaults.
  const index = {
    version,
    definitions,
    fileNames: manifest.fileNames || {},
    fileExtensions: manifest.fileExtensions || {},
    folderNames: manifest.folderNames || {},
    folderNamesExpanded: manifest.folderNamesExpanded || {},
    defaults,
  };
  // NOTE: rootFolderNames/rootFolderNamesExpanded/languageIds/light/highContrast
  // are intentionally dropped; the runtime resolver does not use them.
  const indexJson = JSON.stringify(index);
  writeFileSync(join(ASSETS_DIR, 'index.json'), indexJson);

  const source = {
    package: EXTENSION_ID,
    version,
    homepage: repoHomepage(pkg),
    license: 'MIT',
  };
  writeFileSync(join(ASSETS_DIR, 'source.json'), `${JSON.stringify(source, null, 2)}\n`);

  const counts = {
    definitions: Object.keys(definitions).length,
    fileNames: Object.keys(index.fileNames).length,
    fileExtensions: Object.keys(index.fileExtensions).length,
    folderNames: Object.keys(index.folderNames).length,
    folderNamesExpanded: Object.keys(index.folderNamesExpanded).length,
  };
  const kb = (Buffer.byteLength(indexJson) / 1000).toFixed(1);
  console.log(`source: ${EXTENSION_ID}@${version}`);
  console.log(`extension: ${extDir}`);
  console.log(`icons copied: ${copied.size} files -> ${join('assets', 'icons')}`);
  console.log(`index: assets/index.json (${Buffer.byteLength(indexJson)} bytes, ${kb} KB)`);
  console.log(
    `counts: definitions=${counts.definitions} fileNames=${counts.fileNames} ` +
      `fileExtensions=${counts.fileExtensions} folderNames=${counts.folderNames} ` +
      `folderNamesExpanded=${counts.folderNamesExpanded}`,
  );
  console.log(`defaults: file=${defaults.file} folder=${defaults.folder} folderOpen=${defaults.folderOpen}`);
  if (version === PREFERRED_VERSION) {
    console.log(`expected for ${PREFERRED_VERSION}: 1251/2135/1377/4654/4654 (icons/index ~400-420 KB)`);
  }
}

function parseArgs(argv) {
  const args = { from: undefined, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--from') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) fail('--from requires a directory argument');
      args.from = value;
      i += 1;
    } else if (arg.startsWith('--from=')) {
      args.from = arg.slice('--from='.length);
      if (!args.from) fail('--from requires a directory argument');
    } else {
      fail(`unknown argument: ${arg} (usage: node scripts/vendor-icons.mjs [--from <extension-dir>])`);
    }
  }
  return args;
}

/** Find the preferred/newest installed `pkief.material-icon-theme-*` extension. */
function discoverExtension() {
  const candidates = [];
  for (const root of EXTENSION_ROOTS) {
    const extensionsDir = join(homedir(), root, 'extensions');
    if (!existsSync(extensionsDir)) continue;
    for (const entry of readdirSync(extensionsDir)) {
      const match = /^pkief\.material-icon-theme-(.+)$/.exec(entry);
      if (!match) continue;
      const dir = join(extensionsDir, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      candidates.push({ dir, version: match[1] });
    }
  }
  if (candidates.length === 0) {
    fail(
      'no installed pkief.material-icon-theme-* extension found; ' +
        'pass --from <extension-dir> (looked in ~/.vscode, ~/.cursor, ~/.windsurf)',
    );
  }
  const usable = candidates.filter((candidate) => findManifest(candidate.dir, false));
  if (usable.length === 0) {
    fail(
      `found ${candidates.map((c) => c.dir).join(', ')} but none contains ` +
        'dist/material-icons.json or material-icons.json',
    );
  }
  usable.sort((a, b) => compareVersions(b.version, a.version));
  return (usable.find((candidate) => candidate.version === PREFERRED_VERSION) || usable[0]).dir;
}

function findManifest(extDir, required = true) {
  const candidates = [join(extDir, 'dist', 'material-icons.json'), join(extDir, 'material-icons.json')];
  const found = candidates.find((file) => existsSync(file));
  if (found) return found;
  if (required) {
    fail(`no material-icons.json found in ${extDir} (expected dist/material-icons.json or root material-icons.json)`);
  }
  return undefined;
}

function readExtensionPackage(extDir) {
  const file = join(extDir, 'package.json');
  if (!existsSync(file)) fail(`extension package.json not found: ${file}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${file}: ${error.message}`);
  }
}

function definitionBasename(iconDefinitions, iconId, key) {
  const definition = iconDefinitions[iconId];
  if (!definition || typeof definition.iconPath !== 'string') {
    fail(`manifest.${key} (${iconId}) has no iconDefinition/iconPath`);
  }
  return basename(definition.iconPath);
}

/**
 * The upstream manifest homepage points at the README blob URL; normalize it to
 * the repository root so `assets/source.json` carries a stable project URL.
 */
function repoHomepage(pkg) {
  const homepage = typeof pkg.homepage === 'string' ? pkg.homepage : '';
  const repository = pkg.repository;
  const repositoryUrl =
    typeof repository === 'string' ? repository : repository && typeof repository.url === 'string' ? repository.url : '';
  const raw = (homepage || repositoryUrl).replace(/^git\+/, '').trim();
  if (!raw) return HOMEPAGE_FALLBACK;
  const github = /^(https?:\/\/github\.com\/[^/]+\/[^/#?]+)(?:[/#?].*)?$/.exec(raw);
  if (github) return github[1].replace(/\.git$/, '');
  return raw;
}

/** Numeric semver comparison (prerelease suffixes compare lexically). */
function compareVersions(a, b) {
  const [aCore, aPre] = String(a).split('-', 2);
  const [bCore, bPre] = String(b).split('-', 2);
  const aParts = aCore.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bParts = bCore.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return String(aPre || '').localeCompare(String(bPre || ''));
}

function fail(message) {
  console.error(`vendor-icons: ${message}`);
  process.exit(1);
}

main();
