import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBundle } from '../../scripts/monthly-bundle.mjs';

const sha = 'a'.repeat(40);
const pkg = { name: 'test', version: '1.0.0', dependencies: { react: '^18.3.1' } };
const lock = { name: 'test', version: '1.0.0', lockfileVersion: 3, packages: { '': pkg,
  'node_modules/react': { version: '18.3.1', resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz', integrity: 'sha512-' + Buffer.alloc(64).toString('base64') } } };
const bundle = () => ({ base: sha, mode: 'maintenance', files: { 'package-lock.json': JSON.stringify(lock), 'docs/maintenance/2026-09.md': '# Report\n' } });
test('monthly publisher rejects code, traversal, wrong mode/base, malformed and oversized content', () => {
  assert.equal(validateBundle(bundle(), { base: sha, mode: 'maintenance', pkg }).length, 2);
  for (const name of ['package.json', '.github/workflows/sync-data.yml', '../secret', 'docs/maintenance/../../scripts/a.mjs', 'docs/maintenance/a.md']) {
    assert.throws(() => validateBundle({ ...bundle(), files: { [name]: 'bad' } }, { base: sha, mode: 'maintenance', pkg }));
  }
  for (const patch of [{ base: 'b'.repeat(40) }, { mode: 'sync' }, { files: { 'package-lock.json': '{}' } },
    { files: { 'docs/maintenance/2026-09.md': 'x'.repeat(100001) } }]) {
    assert.throws(() => validateBundle({ ...bundle(), ...patch }, { base: sha, mode: 'maintenance', pkg }));
  }
});
test('dependency artifact cannot change root scripts or install from attacker URLs/local paths', () => {
  for (const edit of [l => { l.packages[''].scripts = { postinstall: 'malicious' }; },
    l => { l.packages[''].dependencies.react = '*'; },
    l => { l.packages['node_modules/react'].resolved = 'https://registry.npmjs.org.evil.test/x'; },
    l => { l.packages['node_modules/react'].resolved = 'file:../private'; },
    l => { l.packages['node_modules/react'].integrity = ''; },
    l => { l.packages['../.github/workflows/pwn'] = l.packages['node_modules/react']; }]) {
    const next = structuredClone(lock); edit(next);
    assert.throws(() => validateBundle({ ...bundle(), files: { 'package-lock.json': JSON.stringify(next) } }, { base: sha, mode: 'maintenance', pkg }));
  }
});

const actualJson = name => JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'));
const actualPkg = actualJson('package.json');
const actualLock = actualJson('package-lock.json');
const syncFiles = Object.fromEntries(['reviews-index.json', 'new-items.json', 'bibliography.json'].map(name =>
  [`public/data/${name}`, JSON.stringify(actualJson(`public/data/${name}`))]));
syncFiles['public/feed.xml'] = readFileSync(new URL('../../public/feed.xml', import.meta.url), 'utf8');
const syncBundle = files => ({ base: sha, mode: 'sync', files });
const checkSync = files => validateBundle(syncBundle(files), { base: sha, mode: 'sync', pkg: actualPkg });
const checkLock = (value, manifest = actualPkg) => validateBundle({ base: sha, mode: 'maintenance', files: { 'package-lock.json': JSON.stringify(value) } },
  { base: sha, mode: 'maintenance', pkg: manifest });

test('publisher accepts the real dependency graph and all current public data', () => {
  assert.equal(checkLock(actualLock).length, 1);
  assert.equal(checkSync(syncFiles).length, 4);
});

test('lock metadata cannot carry lifecycle code, hidden install sources or bin escapes', () => {
  for (const [label, edit] of [
    ['transitive lifecycle', l => { l.packages['node_modules/react'].scripts = { postinstall: 'echo injected' }; }],
    ['top-level code', l => { l.scripts = { postinstall: 'echo injected' }; }],
    ['nested unexpected metadata', l => { l.packages['node_modules/react'].funding = { url: 'https://example.org', scripts: {} }; }],
    ['install configuration', l => { l.packages['node_modules/react'].installConfig = { hoistingLimits: 'none' }; }],
    ['nested shrinkwrap', l => { l.packages['node_modules/react'].hasShrinkwrap = true; }],
    ['bin traversal', l => { l.packages['node_modules/react'].bin = { react: '../../scripts/monthly-bundle.mjs' }; }],
    ['absolute bin', l => { l.packages['node_modules/react'].bin = { react: '/tmp/executable' }; }],
    ['windows bin', l => { l.packages['node_modules/react'].bin = { react: '..\\executable' }; }],
    ['bin command traversal', l => { l.packages['node_modules/react'].bin = { '../git': 'index.js' }; }],
    ['non-registry dependency', l => { l.packages['node_modules/react'].dependencies = { payload: 'file:../../scripts' }; }],
    ['prototype key', l => { l.packages['node_modules/react'].engines = JSON.parse('{"__proto__":"bad"}'); }],
    ['wrong metadata types', l => { l.packages['node_modules/react'].hasInstallScript = 'yes'; }],
  ]) {
    const next = structuredClone(actualLock); edit(next);
    assert.throws(() => checkLock(next), undefined, label);
  }
});

test('registry tarballs must match package location, name and version', () => {
  for (const [label, edit] of [
    ['different package', p => { p.resolved = 'https://registry.npmjs.org/attacker-payload/-/attacker-payload-18.3.1.tgz'; }],
    ['different version', p => { p.resolved = 'https://registry.npmjs.org/react/-/react-18.2.0.tgz'; }],
    ['different name metadata', p => { p.name = 'attacker-payload'; }],
    ['noncanonical path', p => { p.resolved = 'https://registry.npmjs.org/other/../react/-/react-18.3.1.tgz'; }],
    ['encoded traversal', p => { p.resolved = 'https://registry.npmjs.org/react/%2e%2e/react/-/react-18.3.1.tgz'; }],
    ['query', p => { p.resolved += '?redirect=elsewhere'; }],
  ]) {
    const next = structuredClone(actualLock); edit(next.packages['node_modules/react']);
    assert.throws(() => checkLock(next), undefined, label);
  }
  const encoded = structuredClone(actualLock);
  const scoped = Object.keys(encoded.packages).find(name => name.startsWith('node_modules/@'));
  encoded.packages[scoped].resolved = encoded.packages[scoped].resolved.replace('@', '%40').replace(/(%40[^/]+)\//, '$1%2F');
  assert.doesNotThrow(() => checkLock(encoded));
});

test('all declared direct dependencies must remain present within their compatible caret ranges', () => {
  for (const [label, edit] of [
    ['empty graph', l => { l.packages = { '': l.packages[''] }; }],
    ['missing development dependency', l => { delete l.packages['node_modules/vite']; }],
    ['major upgrade', l => { const p = l.packages['node_modules/react']; p.version = '19.0.0'; p.resolved = 'https://registry.npmjs.org/react/-/react-19.0.0.tgz'; }],
    ['downgrade', l => { const p = l.packages['node_modules/react']; p.version = '18.3.0'; p.resolved = 'https://registry.npmjs.org/react/-/react-18.3.0.tgz'; }],
    ['prerelease', l => { const p = l.packages['node_modules/react']; p.version = '18.4.0-next.0'; p.resolved = 'https://registry.npmjs.org/react/-/react-18.4.0-next.0.tgz'; }],
  ]) {
    const next = structuredClone(actualLock); edit(next);
    assert.throws(() => checkLock(next), undefined, label);
  }
  for (const [range, version, accepted] of [['^18.3.1', '18.4.0', true], ['^0.8.3', '0.8.4', true], ['^0.8.3', '0.9.0', false],
    ['^0.0.3', '0.0.3', true], ['^0.0.3', '0.0.4', false]]) {
    const manifest = { ...pkg, dependencies: { react: range } };
    const next = structuredClone(lock); next.packages[''] = manifest;
    Object.assign(next.packages['node_modules/react'], { version, resolved: `https://registry.npmjs.org/react/-/react-${version}.tgz` });
    if (accepted) assert.doesNotThrow(() => checkLock(next, manifest));
    else assert.throws(() => checkLock(next, manifest));
  }
});

test('bibliography rejects null records and all malformed fields consumed by the frontend', () => {
  for (const [label, edit] of [
    ['null record', d => { d.records = [null]; }],
    ['title', d => { d.records[0].title = {}; }],
    ['authors', d => { d.records[0].authors = [null]; }],
    ['year', d => { d.records[0].year = '2026'; }],
    ['source', d => { d.records[0].source = 'Unverified'; }],
    ['source URL', d => { d.records[0].sourceUrl = 'javascript:alert(1)'; }],
    ['timestamp', d => { d.records[0].verifiedAt = '2026-02-30T00:00:00.000Z'; }],
    ['match method', d => { d.records[0].matchMethod = 'guessed'; }],
    ['optional identifier', d => { d.records[0].doi = {}; }],
    ['unresolved record', d => { d.unresolved = [null]; }],
  ]) {
    const data = actualJson('public/data/bibliography.json'); edit(data);
    assert.throws(() => checkSync({ 'public/data/bibliography.json': JSON.stringify(data) }), undefined, label);
  }
});

test('review and new-item records reject malformed optional fields and unsafe links', () => {
  for (const name of ['reviews-index.json', 'new-items.json']) {
    for (const [field, value] of [['tldr', {}], ['authors', [null]], ['freeUrl', 'javascript:alert(1)'], ['doi', 42],
      ['impactFactor', '12'], ['diseases', {}], ['identityAliases', [null]], ['bibliography', { title: 'incomplete' }], ['firstPublicationDate', '2026-02-30']]) {
      const data = actualJson(`public/data/${name}`); data.items[0][field] = value;
      assert.throws(() => checkSync({ [`public/data/${name}`]: JSON.stringify(data) }), undefined, `${name}: ${field}`);
    }
  }
  const data = actualJson('public/data/new-items.json'); data.count++;
  assert.throws(() => checkSync({ 'public/data/new-items.json': JSON.stringify(data) }));
});

test('feed must equal trusted regeneration from validated new items', () => {
  for (const content of ['<?xml', '<?xml version="1.0"?><!DOCTYPE feed><feed/>', syncFiles['public/feed.xml'].replace('<title>', '<title>tampered')]) {
    assert.throws(() => checkSync({ ...syncFiles, 'public/feed.xml': content }));
  }
  assert.throws(() => checkSync({ 'public/feed.xml': syncFiles['public/feed.xml'] }));
  const generated = checkSync({ 'public/data/new-items.json': syncFiles['public/data/new-items.json'] });
  assert.equal(generated.find(([name]) => name === 'public/feed.xml')[1], syncFiles['public/feed.xml']);
  assert.equal(validateBundle(syncBundle({ 'public/feed.xml': syncFiles['public/feed.xml'] }),
    { base: sha, mode: 'sync', pkg: actualPkg, newItems: actualJson('public/data/new-items.json') }).length, 1);
});
