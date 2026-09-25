import test from 'node:test';
import assert from 'node:assert/strict';
import { antigravityStatus, reviewerStatus, GEMINI_MODEL } from '../../worker/reviewers.mjs';

test('Gemini reviews run through Antigravity, available only when a signed-in agy lists the model', async () => {
  const listing = `Fetching available models...\n${GEMINI_MODEL}\tGemini 3.1 Pro (High)\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n`;
  let called;
  const ok = await antigravityStatus(async (command, args) => { called = [command, ...args]; return { stdout: listing, stderr: '' }; });
  assert.deepEqual(called, ['agy', 'models']);
  assert.equal(ok.available, true); assert.match(ok.detail, /Antigravity/);
  const missing = await antigravityStatus(async () => ({ stdout: 'Fetching available models...\ngemini-3.8-flash-high\tFlash\n', stderr: '' }));
  assert.equal(missing.available, false); assert.match(missing.detail, new RegExp(GEMINI_MODEL));
  const signedOut = await antigravityStatus(async () => { throw new Error('agy 失敗 (1)：please sign in'); });
  assert.equal(signedOut.available, false); assert.match(signedOut.detail, /sign in/);
  const absent = await antigravityStatus(async () => { throw Object.assign(new Error('spawn agy ENOENT'), { code: 'ENOENT' }); });
  assert.match(absent.detail, /未安裝/);
});

test('reviewer summary names each configured reviewer with a fix for the unavailable ones', () => {
  const summary = reviewerStatus({ claude: { available: true }, grok: { available: false, detail: 'spawn grok ENOENT' } }, { available: false, detail: '尚未登入' }, ['claude', 'gemini', 'grok']);
  assert.deepEqual(Object.keys(summary), ['claude', 'gemini', 'grok']);
  assert.equal(summary.claude.available, true);
  assert.equal(summary.gemini.available, false); assert.match(summary.gemini.fix, /agy/);
  assert.equal(summary.grok.available, false); assert.match(summary.grok.fix, /grok/);
  assert.equal(JSON.stringify(summary).length < 2000, true, 'small enough for the capabilities payload');
});
