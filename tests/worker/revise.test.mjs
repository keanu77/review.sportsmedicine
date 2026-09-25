import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reviseDraft } from '../../worker/draft.mjs';
import { exportTexts } from '../../worker/render.mjs';
import { DISCLAIMER, claimKey } from '../../shared/quality.mjs';

const text = 'Nine studies with 970 athletes were included. Of 274 athletes with data, 272 returned to sport (99.3%) after a mean of 11.4 weeks. Only three studies reported return to preinjury level.';
const source = { paper: { title: 'Return to Sport Following Elbow Dislocation', doi: '10.1/x' }, text };
const locked = { text: '274人中272人恢復運動', locator: 'p:1', quote: '272 returned to sport (99.3%)' };
const rejected = { text: '原有表現有落差', locator: 'p:1', quote: 'Only three studies reported return to preinjury level' };
const draft = { post: '手肘脫臼後，多數人能回場。', igCaption: '不能据此判定。', notes: '筆記',
  pages: [{ id: 'cover', layout: 'cover', title: '手肘脫臼能回場嗎' }, { id: 'p2', layout: 'content', title: '原有表現仍有落差', cards: [{ title: '僅3篇回報', body: '比例不一' }] }, { id: 'end', layout: 'outro', title: '先釐清目標' }],
  claims: [locked, rejected] };
const request = { id: 'r1', findings: [{ provider: 'claude', severity: 'medium', claim: '標題過度推論', reason: '只說資料有限', suggestion: '改寫標題', locator: 'p:1', quote: '', sourceVerified: true }],
  instructions: '語氣更口語', lockedClaims: [locked], rejectedClaims: [rejected], gateIssues: ['IG 文案：出現簡體字：据'] };
async function temporary(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'review-revise-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('revision keeps locked claims verbatim, drops rejected ones, adds the disclaimer and is cached', async t => {
  const directory = await temporary(t); let prompt, calls = 0;
  const run = async (_provider, input) => { calls++; prompt = input; return { ...draft, igCaption: '不能據此判定哪種治療較好。', pages: draft.pages.map(p => p.id === 'p2' ? { ...p, title: '原有水準資料有限' } : p),
    claims: [{ ...locked, text: '模型改寫過的主張' }, { text: '新主張', locator: 'p:1', quote: 'Nine studies with 970 athletes were included' }] }; };
  const revised = await reviseDraft(source, draft, request, directory, { run });
  assert.deepEqual(revised.claims, [locked], 'claims are exactly the locked set');
  assert.equal(revised.pages[1].title, '原有水準資料有限');
  assert.ok(revised.post.endsWith(DISCLAIMER)); assert.ok(revised.igCaption.endsWith(DISCLAIMER));
  for (const needle of ['標題過度推論', '改寫標題', '語氣更口語', '出現簡體字：据', '不要翻譯', locked.text, rejected.text]) assert.ok(prompt.includes(needle), needle);
  const again = await reviseDraft(source, draft, request, directory, { run });
  assert.equal(calls, 1, 'second call is served from the revision cache'); assert.deepEqual(again, revised);
  assert.equal(claimKey(revised.claims[0]), claimKey(locked));
});

test('an interrupted revision is not repeated without an explicit retry', async t => {
  const directory = await temporary(t);
  await assert.rejects(reviseDraft(source, draft, request, directory, { run: async () => { throw new Error('model crashed'); } }), /model crashed/);
  await access(path.join(directory, 'revise-r1-request.json'));
  await assert.rejects(reviseDraft(source, draft, request, directory, { run: async () => draft }), /重試/);
  const retried = await reviseDraft(source, draft, request, directory, { run: async () => draft, allowRetry: true });
  assert.deepEqual(retried.claims, [locked]);
});

test('a revision without any locked claim is refused before calling the model', async t => {
  const directory = await temporary(t); let called = false;
  await assert.rejects(reviseDraft(source, draft, { ...request, lockedClaims: [] }, directory, { run: async () => { called = true; return draft; } }), /鎖定/);
  assert.equal(called, false);
});

test('exported post and caption always carry the disclaimer exactly once', () => {
  const files = exportTexts({ post: '內文', igCaption: `說明\n\n${DISCLAIMER}` });
  assert.equal(files['fb-post.md'], `內文\n\n${DISCLAIMER}`);
  assert.equal(files['ig-caption.md'].split(DISCLAIMER).length - 1, 1);
});
