import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { geminiAuthStatus, reviewerStatus } from '../../worker/reviewers.mjs';

async function home(t, files = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'review-home-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, '.gemini'), { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, '.gemini', name), content);
  return dir;
}

test('Gemini counts as signed in only with a Google login the worker can actually use', async t => {
  assert.equal((await geminiAuthStatus(await home(t))).available, false);
  assert.match((await geminiAuthStatus(await home(t, { 'settings.json': '{"hooks":{}}' }))).detail, /gemini/);
  const google = await home(t, { 'settings.json': '{"security":{"auth":{"selectedType":"oauth-personal"}}}', 'oauth_creds.json': '{"refresh_token":"x"}' });
  assert.equal((await geminiAuthStatus(google)).available, true);
  const legacy = await home(t, { 'settings.json': '{"selectedAuthType":"oauth-personal"}', 'oauth_creds.json': '{}' });
  assert.equal((await geminiAuthStatus(legacy)).available, true);
  const missingCreds = await home(t, { 'settings.json': '{"security":{"auth":{"selectedType":"oauth-personal"}}}' });
  assert.equal((await geminiAuthStatus(missingCreds)).available, false);
  const apiKey = await home(t, { 'settings.json': '{"security":{"auth":{"selectedType":"gemini-api-key"}}}' });
  assert.match((await geminiAuthStatus(apiKey)).detail, /API key/);
  assert.equal((await geminiAuthStatus(apiKey)).available, false, 'API keys are stripped from the model environment');
  assert.equal((await geminiAuthStatus(await home(t, { 'settings.json': '{broken' }))).available, false);
});

test('reviewer summary names each configured reviewer with a fix for the unavailable ones', () => {
  const summary = reviewerStatus({ claude: { available: true }, grok: { available: false, detail: 'spawn grok ENOENT' } }, { available: false, detail: '尚未登入' }, ['claude', 'gemini', 'grok']);
  assert.deepEqual(Object.keys(summary), ['claude', 'gemini', 'grok']);
  assert.equal(summary.claude.available, true);
  assert.equal(summary.gemini.available, false); assert.match(summary.gemini.fix, /gemini/);
  assert.equal(summary.grok.available, false); assert.match(summary.grok.fix, /grok/);
  assert.equal(JSON.stringify(summary).length < 2000, true, 'small enough for the capabilities payload');
});
