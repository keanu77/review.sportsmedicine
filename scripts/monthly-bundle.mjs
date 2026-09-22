// Trusted publisher: Node built-ins only; never execute code from the update artifact.
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateIndex } from './validate-index.mjs';
import { validateBibliography, validateNewItems, validateReviews } from './validate-public-data.mjs';
import { buildFeed } from './build-feed.mjs';

const dataFiles = ['public/data/reviews-index.json', 'public/data/new-items.json', 'public/data/bibliography.json', 'public/feed.xml'];
const reportPath = /^docs\/maintenance\/\d{4}-(?:0[1-9]|1[0-2])\.md$/;
const fail = () => { throw new Error('Monthly artifact rejected: invalid content or publish scope'); };
const packageName = /^(?:@[a-z0-9_-][a-z0-9._-]*\/)?[a-z0-9_-][a-z0-9._-]*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();
}
function text(value) { if (typeof value !== 'string' || !value.length || /[\u0000-\u001f]/.test(value)) fail(); }
function stringMap(value, keyCheck = key => !['__proto__', 'prototype', 'constructor'].includes(key)) {
  if (!object(value)) fail();
  for (const [key, item] of Object.entries(value)) { if (!keyCheck(key)) fail(); text(item); }
}
function dependencyMap(value) {
  stringMap(value, key => packageName.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key));
  // Registry version ranges/tags only; no alternate protocols or local install sources.
  for (const spec of Object.values(value)) if (!/^[A-Za-z0-9^~<>=.*| +\-]+$/.test(spec)) fail();
}
function version(value) {
  if (typeof value !== 'string') fail();
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?(?:\+([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/);
  if (!match || match.slice(1, 4).some(part => !Number.isSafeInteger(Number(part)))
    || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) fail();
  return { numbers: match.slice(1, 4).map(Number), prerelease: match[4] };
}
function compatibleCaret(installed, range) {
  if (typeof range !== 'string' || !/^\^\d+\.\d+\.\d+$/.test(range)) fail();
  const minimum = version(range.slice(1)).numbers, actual = version(installed);
  if (actual.prerelease) return false;
  const upper = minimum[0] ? [minimum[0] + 1, 0, 0] : minimum[1] ? [0, minimum[1] + 1, 0] : [0, 0, minimum[2] + 1];
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return compare(actual.numbers, minimum) >= 0 && compare(actual.numbers, upper) < 0;
}
function funding(value) {
  for (const entry of Array.isArray(value) ? value : [value]) {
    let source = entry;
    if (object(entry)) { keys(entry, ['type', 'url']); if (Object.hasOwn(entry, 'type')) text(entry.type); source = entry.url; }
    text(source); const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail();
  }
}
function bins(value) {
  if (!object(value)) fail();
  for (const [command, target] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(command)) fail();
    text(target);
    // npm links these paths from the package directory. Never allow a package escape.
    const parts = target.replace(/^\.\//, '').split('/');
    if (/[:\\]/.test(target) || parts.some(part => !part || part === '.' || part === '..')) fail();
  }
}
function validateLock(lock, pkg) {
  keys(lock, ['name', 'version', 'lockfileVersion', 'requires', 'packages']);
  if (lock.lockfileVersion !== 3 || lock.name !== pkg.name || lock.version !== pkg.version || !object(lock.packages)
    || (Object.hasOwn(lock, 'requires') && typeof lock.requires !== 'boolean')) fail();
  const root = lock.packages[''];
  const rootKeys = ['name', 'version', 'dependencies', 'devDependencies', 'optionalDependencies', 'engines', 'license'];
  keys(root, rootKeys);
  for (const key of rootKeys) if (!isDeepStrictEqual(root[key], pkg[key])) fail();
  const allowed = ['name', 'version', 'resolved', 'integrity', 'dependencies', 'optionalDependencies', 'peerDependencies',
    'peerDependenciesMeta', 'engines', 'dev', 'optional', 'devOptional', 'peer', 'license', 'funding', 'cpu', 'os', 'libc', 'bin', 'hasInstallScript'];
  for (const [location, item] of Object.entries(lock.packages)) {
    if (!location) continue;
    const names = location.split(/(?:^|\/)node_modules\//);
    if (names.shift() !== '' || !names.length || names.some(name => !packageName.test(name))) fail();
    keys(item, allowed); version(item.version);
    const name = names.at(-1), basename = name.split('/').at(-1);
    if (Object.hasOwn(item, 'name') && item.name !== name) fail();
    if (typeof item.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity)) fail();
    text(item.resolved);
    const url = new URL(item.resolved), expected = `https://registry.npmjs.org/${name}/-/${basename}-${item.version}.tgz`;
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.search || url.hash
      || decodeURIComponent(item.resolved) !== expected) fail();
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) if (Object.hasOwn(item, key)) dependencyMap(item[key]);
    if (Object.hasOwn(item, 'engines')) stringMap(item.engines);
    for (const key of ['dev', 'optional', 'devOptional', 'peer', 'hasInstallScript']) if (Object.hasOwn(item, key) && typeof item[key] !== 'boolean') fail();
    if (Object.hasOwn(item, 'license')) text(item.license);
    if (Object.hasOwn(item, 'funding')) funding(item.funding);
    for (const key of ['cpu', 'os', 'libc']) if (Object.hasOwn(item, key)) {
      if (!Array.isArray(item[key])) fail();
      for (const entry of item[key]) text(entry);
    }
    if (Object.hasOwn(item, 'peerDependenciesMeta')) {
      if (!object(item.peerDependenciesMeta)) fail();
      for (const [peer, metadata] of Object.entries(item.peerDependenciesMeta)) {
        if (!packageName.test(peer) || ['__proto__', 'prototype', 'constructor'].includes(peer)) fail();
        keys(metadata, ['optional']);
        if (typeof metadata.optional !== 'boolean') fail();
      }
    }
    if (Object.hasOwn(item, 'bin')) bins(item.bin);
  }
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (!pkg[group]) continue;
    dependencyMap(pkg[group]);
    for (const [name, range] of Object.entries(pkg[group])) {
      const installed = lock.packages[`node_modules/${name}`];
      if (!installed || !compatibleCaret(installed.version, range)) fail();
    }
  }
}
export function validateBundle(bundle, { base, mode, pkg, newItems }) {
  if (!/^[a-f0-9]{40}$/.test(base) || !['maintenance', 'sync'].includes(mode) || bundle?.base !== base || bundle.mode !== mode
    || !object(bundle.files)) fail();
  const entries = Object.entries(bundle.files);
  if (entries.length > 6) fail();
  let proposedItems, proposedFeed;
  for (const [name, content] of entries) {
    if (typeof content !== 'string' || content.includes('\0') || content.length > (reportPath.test(name) ? 100000 : 10000000)) fail();
    if (reportPath.test(name)) continue;
    if (mode === 'maintenance') {
      if (name !== 'package-lock.json') fail();
      validateLock(JSON.parse(content), pkg);
    } else {
      if (!dataFiles.includes(name)) fail();
      if (name === dataFiles[0]) validateReviews(JSON.parse(content));
      if (name === dataFiles[1]) proposedItems = validateNewItems(JSON.parse(content));
      if (name === dataFiles[2]) validateBibliography(JSON.parse(content));
      if (name === dataFiles[3]) proposedFeed = content;
    }
  }
  if (proposedItems || proposedFeed !== undefined) {
    // Existing newItems must come from the publisher's trusted base checkout.
    const generated = buildFeed(proposedItems ?? newItems);
    if (proposedFeed !== undefined && proposedFeed !== generated) fail();
    if (proposedFeed === undefined) entries.push([dataFiles[3], generated]);
  }
  return entries;
}
function assertSafePath(name) {
  for (let current = resolve(name); current !== process.cwd(); current = dirname(current)) {
    if (!current.startsWith(process.cwd() + '/')) fail();
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail();
  }
}
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' }).trim();
export function main([command, mode, artifact], env = process.env) {
  if (!['pack', 'apply'].includes(command) || !artifact) fail();
  const base = env.GITHUB_SHA || git('rev-parse', 'HEAD');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  let newItems;
  if (mode === 'sync') { assertSafePath(dataFiles[1]); newItems = JSON.parse(readFileSync(dataFiles[1], 'utf8')); }
  if (command === 'pack') {
    const month = new Date().toISOString().slice(0, 7);
    const paths = [...(mode === 'maintenance' ? ['package-lock.json'] : dataFiles), `docs/maintenance/${month}.md`];
    const files = {};
    for (const name of paths) {
      assertSafePath(name);
      if (!existsSync(name)) continue;
      const content = readFileSync(name, 'utf8');
      let previous; try { previous = execFileSync('git', ['show', `${base}:${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
      if (content !== previous) files[name] = content;
    }
    const bundle = { base, mode, files };
    bundle.files = Object.fromEntries(validateBundle(bundle, { base, mode, pkg, newItems }));
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, JSON.stringify(bundle));
    console.log(`Prepared ${Object.keys(files).length} allowlisted files`);
  } else {
    if (git('rev-parse', 'HEAD') !== base || git('status', '--porcelain')) throw new Error('Publisher needs a clean checkout at the verified base');
    if (!lstatSync(artifact).isFile() || lstatSync(artifact).size > 25000000) fail();
    const entries = validateBundle(JSON.parse(readFileSync(artifact, 'utf8')), { base, mode, pkg, newItems });
    const nextIndex = entries.find(([name]) => name === dataFiles[0]);
    if (nextIndex) validateIndex(JSON.parse(nextIndex[1]), JSON.parse(readFileSync(dataFiles[0], 'utf8')));
    for (const [name] of entries) assertSafePath(name);
    for (const [name, content] of entries) { mkdirSync(dirname(name), { recursive: true }); writeFileSync(name, content, { mode: 0o644 }); }
    if (!entries.length) return;
    git('add', '--', ...entries.map(([name]) => name));
    if (!git('diff', '--cached', '--name-only')) return;
    git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com', 'commit', '-m',
      mode === 'maintenance' ? 'chore: monthly verified website maintenance' : 'chore(data): verified monthly literature and citation refresh');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
