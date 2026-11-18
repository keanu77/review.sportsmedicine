import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from '../../scripts/audit-dependencies.mjs';

const advisory = { name: 'picomatch', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', severity: 'high', range: '<=4.0.7' };
const fixture = () => ({
  audit: { auditReportVersion: 2, vulnerabilities: {
    picomatch: { severity: 'high', nodes: ['node_modules/picomatch'], via: [advisory] },
    vite: { severity: 'high', nodes: ['node_modules/vite'], via: ['picomatch'] },
  } },
  lock: { packages: {
    'node_modules/picomatch': { version: '4.0.7', dev: true },
    'node_modules/vite': { version: '8.3.5', dev: true },
  } },
});
const check = ({ audit, lock }, today = '2026-11-18') => evaluateAudit(audit, lock, today);

test('the dated exception covers only the known development-only advisory and its dependency effects', () => {
  const result = check(fixture());
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.exceptions, ['picomatch', 'vite']);
});

test('unknown advisories and production paths still block publication', () => {
  const unknown = fixture();
  unknown.audit.vulnerabilities.picomatch.via.push({ ...advisory, url: 'https://github.com/advisories/GHSA-other' });
  assert.deepEqual(check(unknown).blocked, ['picomatch', 'vite']);
  for (const name of ['picomatch', 'vite']) {
    const runtime = fixture();
    runtime.lock.packages[`node_modules/${name}`].dev = false;
    assert.ok(check(runtime).blocked.includes(name));
  }
});

test('the exception expires and does not silently expand to other versions or severity', () => {
  assert.deepEqual(check(fixture(), '2026-12-19').blocked, ['picomatch', 'vite']);
  const changed = fixture();
  changed.lock.packages['node_modules/picomatch'].version = '4.0.8';
  assert.deepEqual(check(changed).blocked, ['picomatch', 'vite']);
  const critical = fixture();
  critical.audit.vulnerabilities.picomatch.via[0] = { ...advisory, severity: 'critical' };
  assert.deepEqual(check(critical).blocked, ['picomatch', 'vite']);
});

test('missing evidence and dependency cycles cannot turn an audit failure into a pass', () => {
  for (const audit of [{}, { error: { code: 'NETWORK' } }, { auditReportVersion: 2 }]) {
    assert.throws(() => check({ ...fixture(), audit }), /Invalid npm audit report/);
  }
  const missing = fixture();
  delete missing.lock.packages['node_modules/picomatch'];
  assert.deepEqual(check(missing).blocked, ['picomatch', 'vite']);
  const cycle = fixture();
  cycle.audit.vulnerabilities.picomatch.via = ['vite'];
  assert.deepEqual(check(cycle).blocked, ['picomatch', 'vite']);
});

test('a clean audit passes without using any exception', () => {
  assert.deepEqual(evaluateAudit({ auditReportVersion: 2, vulnerabilities: {} }, { packages: {} }, '2026-12-19'), { blocked: [], exceptions: [] });
});
