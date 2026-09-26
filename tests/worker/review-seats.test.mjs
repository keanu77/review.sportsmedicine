import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reviewCommand, reviewDraft, parseResult, REVIEW_TIMEOUT_MS } from '../../worker/review.mjs';
import { assertSeats, configuredReviewers } from '../../worker/reviewers.mjs';
import { fixtureDraft } from '../server/helpers.mjs';

const source = { text: 'Exercise therapy improved pain scores at twelve weeks in the treated group compared with usual care.' };
const answer = findings => JSON.stringify({ summary: 'checked', findings });
const finding = { severity: 'high', claim: '分母不符', reason: 'r', locator: '', quote: '', suggestion: 's' };
const temporary = async t => { const directory = await mkdtemp(path.join(os.tmpdir(), 'review-seats-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; };
const answerFile = args => args[args.indexOf('--output-last-message') + 1];

test('each seat is invoked the way the red-team benchmark ran it', () => {
  const codex = reviewCommand('codex', '/w');
  assert.equal(codex.command, 'codex'); assert.equal(codex.stdin, true);
  for (const flag of ['--sandbox', 'read-only', '--ephemeral', '--output-schema', '--output-last-message', '-']) assert.ok(codex.args.includes(flag), flag);
  const grok = reviewCommand('grok', '/w');
  assert.equal(grok.stdin, false);
  assert.equal(grok.args[grok.args.indexOf('-m') + 1], 'grok-4.7-build-fast');
  assert.equal(grok.args[grok.args.indexOf('--tools') + 1], 'Read');
  assert.equal(grok.args[grok.args.indexOf('--cwd') + 1], '/w');
  assert.ok(!grok.args.includes('--prompt-file'), 'grok truncates prompt files');
  assert.match(grok.args[grok.args.indexOf('-p') + 1], /review-grok-prompt\.txt/);
  const gemini = reviewCommand('gemini', '/w');
  assert.equal(gemini.args[gemini.args.indexOf('--model') + 1], 'gemini-3.8-flash-high');
  assert.equal(REVIEW_TIMEOUT_MS.codex, 15 * 60000); assert.equal(REVIEW_TIMEOUT_MS.default, 10 * 60000);
  assert.deepEqual(configuredReviewers({}), ['codex', 'claude', 'grok', 'gemini']);
});

test('the primary reviewer must come from a different family than the writer', () => {
  assert.throws(() => assertSeats('codex', ['codex', 'grok']), /REVIEW_MODEL_PROVIDER/);
  assert.doesNotThrow(() => assertSeats('claude', ['codex', 'claude']));
  assert.doesNotThrow(() => assertSeats('codex', ['claude', 'grok']));
});

test('the primary reviewer retries once and records its duration; a secondary seat does not retry', async t => {
  const directory = await temporary(t);
  let now = 0, codexCalls = 0, grokCalls = 0;
  const run = async (command, args, options) => {
    if (command === 'codex') {
      codexCalls++; now += 120000;
      if (codexCalls === 1) throw new Error('codex 失敗 (1)：stream disconnected');
      assert.equal(options.timeout, 15 * 60000); assert.match(options.input, /主審/);
      await writeFile(answerFile(args), answer([finding])); return { stdout: 'log', stderr: '' };
    }
    grokCalls++; assert.equal(options.timeout, 10 * 60000); assert.equal(options.input, '');
    throw new Error('grok 失敗 (1)：boom');
  };
  const [codex, grok] = await reviewDraft(source, fixtureDraft, directory, { providers: ['codex', 'grok'], run, clock: () => now });
  assert.equal(codex.status, 'ran'); assert.equal(codex.primary, true); assert.equal(codex.attempts, 2);
  assert.equal(codex.durationSeconds, 240); assert.equal(codex.findings.length, 1);
  assert.equal(grok.status, 'failed'); assert.equal(grokCalls, 1);
});

test('a timed-out Codex answer is recovered from its log instead of counting as absent', async t => {
  const directory = await temporary(t);
  const run = async () => { throw Object.assign(new Error('工具執行逾時'), { code: 'ETIMEDOUT', stdout: `thinking...\ncodex\n${answer([finding])}\ntokens used: 1234` }); };
  const [codex] = await reviewDraft(source, fixtureDraft, directory, { providers: ['codex'], run });
  assert.equal(codex.status, 'ran'); assert.equal(codex.recoveredAfterTimeout, true); assert.equal(codex.attempts, 1);
});

test('a Codex answer file left by an earlier draft is never read back', async t => {
  const directory = await temporary(t);
  await writeFile(path.join(directory, 'review-codex-model.json'), answer([finding]));
  const run = async () => { throw Object.assign(new Error('工具執行逾時'), { code: 'ETIMEDOUT', stdout: 'no answer yet' }); };
  const [codex] = await reviewDraft(source, fixtureDraft, directory, { providers: ['codex'], run });
  assert.equal(codex.status, 'failed');
});

test('plain-text answers parse from the last JSON object', () => {
  assert.equal(parseResult(`note {"x":1}\n${answer([finding])}`).findings.length, 1);
});
