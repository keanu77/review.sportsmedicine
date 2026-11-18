import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ADVISORY = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const EXPIRES = '2026-12-18';
const levels = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// See docs/security-exceptions.md. This is not a blanket exclusion of dev dependencies.
export function evaluateAudit(audit, lock, today = new Date().toISOString().slice(0, 10)) {
  if (audit?.auditReportVersion !== 2 || audit.error || !object(audit.vulnerabilities) || !object(lock?.packages)) {
    throw new Error('Invalid npm audit report or lockfile; refusing publication');
  }
  const findings = audit.vulnerabilities;
  function excepted(name, seen = new Set()) {
    const finding = findings[name];
    if (today > EXPIRES || seen.has(name) || !object(finding) || finding.severity !== 'high'
      || !Array.isArray(finding.nodes) || !finding.nodes.length
      || !finding.nodes.every(path => lock.packages[path]?.dev === true)
      || !Array.isArray(finding.via) || !finding.via.length) return false;
    const visited = new Set([...seen, name]);
    return finding.via.every(cause => {
      if (typeof cause === 'string') return excepted(cause, visited);
      return name === 'picomatch' && cause?.name === 'picomatch' && cause.url === ADVISORY
        && cause.severity === 'high' && cause.range === '<=4.0.7'
        && finding.nodes.every(path => lock.packages[path].version === '4.0.7');
    });
  }
  const result = { blocked: [], exceptions: [] };
  for (const [name, finding] of Object.entries(findings)) {
    if (!object(finding) || !Object.hasOwn(levels, finding.severity)) throw new Error('Invalid npm audit report finding');
    if (levels[finding.severity] < levels.moderate) continue;
    result[excepted(name) ? 'exceptions' : 'blocked'].push(name);
  }
  return result;
}

function main() {
  const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 10_000_000, timeout: 120_000 });
  if (audit.error || ![0, 1].includes(audit.status)) throw new Error('npm audit did not complete; refusing publication');
  writeFileSync('dependency-audit.json', audit.stdout);
  const result = evaluateAudit(JSON.parse(audit.stdout), JSON.parse(readFileSync('package-lock.json', 'utf8')));
  const summary = result.exceptions.length
    ? `Dependency audit: temporary development-only exception for ${ADVISORY}, expires ${EXPIRES}; affected packages: ${result.exceptions.join(', ')}.`
    : 'Dependency audit: no moderate-or-higher findings accepted by exception.';
  console.log(summary);
  if (result.exceptions.length) console.warn(`::warning::${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (result.blocked.length) throw new Error(`Dependency audit blocks publication: ${result.blocked.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
