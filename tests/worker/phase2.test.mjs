import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { reelPlan, reelArgs, makeReel, defaultDuration } from '../../worker/reel.mjs';
import { outroBlock, sourceLink, exportTexts } from '../../worker/render.mjs';
import { reviseDraft, voiceGuide } from '../../worker/draft.mjs';
import { render } from '../../worker/renderer/render-hybrid.mjs';
import { DISCLAIMER, SHORT_DISCLAIMER, checkDraft, hashtags } from '../../shared/quality.mjs';

const temporary = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), 'review-phase2-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('reel pages hold 3 s on the hook, 6 s per point and 5 s on the outro, cross-faded', () => {
  assert.deepEqual([0, 1, 2, 3].map(i => defaultDuration(i, 4)), [3, 6, 6, 5]);
  const report = { design: { format: 'story' }, results: [{ file: 'series/page-01.png', duration: 3 }, { file: 'series/page-02.png', duration: null }, { file: 'series/page-03.png', duration: 5 }, { file: 'cover-1200x630.png' }] };
  const plan = reelPlan(report, '/r');
  assert.deepEqual(plan.map(p => [p.file, p.duration]), [['/r/series/page-01.png', 3], ['/r/series/page-02.png', 6], ['/r/series/page-03.png', 5]]);
  const { args, length } = reelArgs(plan, '/r/reel.mp4');
  assert.equal(length, 13, '3 + 6 + 5 minus two 0.5 s fades');
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /xfade=transition=fade:duration=0\.5:offset=2\.50\[x1\]/);
  assert.match(filter, /xfade=transition=fade:duration=0\.5:offset=8\.00\[x2\]/);
  assert.ok(args.includes('-an') && args.includes('+faststart') && args.at(-1) === '/r/reel.mp4');
  assert.throws(() => reelPlan({ ...report, design: { format: 'portrait' } }, '/r'), /9:16/);
});

test('a missing ffmpeg explains how to fix it', async () => {
  const report = { design: { format: 'story' }, results: [{ file: 'series/page-01.png' }] };
  await assert.rejects(makeReel(report, '/r', '/r/reel.mp4', { run: async () => { throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }); } }), /brew install ffmpeg/);
});

test('rendered 9:16 pages become a 1080×1920 H.264 reel that starts on the first page', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async t => {
  const tmp = await temporary(t);
  const manifest = { version: 1, title: '測試', design: { palette: 'blue', style: 'clinical', imageStyle: 'photo', format: 'story', brand: '吳易澄醫師｜運動醫學' },
    pages: [{ id: 'hook', layout: 'cover', title: '手肘脫臼能回場嗎', duration: 1 }, { id: 'end', layout: 'outro', title: '先釐清目標', duration: 1 }] };
  await writeFile(path.join(tmp, 'm.json'), JSON.stringify(manifest));
  const { report } = await render(path.join(tmp, 'm.json'), path.join(tmp, 'out'), { textOnly: true });
  const reel = await makeReel(report, path.join(tmp, 'out'), path.join(tmp, 'reel.mp4'));
  assert.equal(reel.seconds, 1.5);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,pix_fmt', '-of', 'csv=p=0', reel.file], { encoding: 'utf8' }).trim();
  assert.equal(probe, 'h264,1080,1920,yuv420p');
  assert.equal((await readFile(reel.file)).subarray(4, 8).toString('ascii'), 'ftyp');
});

test('the outro QR points at the paper and falls back to an https source URL', () => {
  assert.equal(sourceLink({ doi: '10.1177/23259671261419505' }), 'https://doi.org/10.1177/23259671261419505');
  assert.equal(sourceLink({ pmcid: 'PMC1', sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/' }), 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/');
  assert.equal(sourceLink({ sourceUrl: 'http://insecure.example' }), null);
  const block = outroBlock({ doi: '10.1/x' });
  assert.equal(block.disclaimer, SHORT_DISCLAIMER); assert.equal(block.qr.label, '掃描看原始論文'); assert.ok(block.cta);
  assert.equal(outroBlock({}).qr, undefined);
});

test('IG captions keep hashtags last, after the disclaimer, and the gate counts them', () => {
  const files = exportTexts({ post: '內文', igCaption: '重點一\n重點二\n\n#運動醫學 #手肘 #衛教' });
  assert.equal(files['ig-caption.md'], `重點一\n重點二\n\n${DISCLAIMER}\n\n#運動醫學 #手肘 #衛教`);
  assert.deepEqual(hashtags('a #運動醫學 #ACL b'), ['#運動醫學', '#ACL']);
  const draft = { post: '有助於改善', igCaption: '#一 #二', pages: [], claims: [] };
  assert.ok(checkDraft(draft).warnings.some(w => w.code === 'HASHTAGS'));
  assert.ok(!checkDraft({ ...draft, igCaption: '#一 #二 #三' }).warnings.some(w => w.code === 'HASHTAGS'));
});

test('the author voice guide shapes drafts without licence to invent experience; a missing file is fine', async t => {
  const dir = await temporary(t);
  assert.equal(await voiceGuide(path.join(dir, 'missing.md')), '');
  const locked = { text: '274人中272人恢復運動', locator: 'p:1', quote: '272 returned to sport (99.3%)' };
  const source = { paper: { title: 'x', doi: '10.1/x' }, text: 'Of 274 athletes with data, 272 returned to sport (99.3%) after a mean of 11.4 weeks.' };
  const draft = { post: '內文', igCaption: '說明', notes: '筆記', pages: [{ id: 'c', layout: 'cover', title: '封面' }, { id: 'p', layout: 'content', title: '內容', cards: [] }, { id: 'o', layout: 'outro', title: '結尾' }], claims: [locked] };
  let prompt;
  await reviseDraft(source, draft, { id: 'v1', findings: [], instructions: '更口語', lockedClaims: [locked] }, dir, { voice: '不用破折號，最重的話用最短的句子講。', run: async (_p, input) => { prompt = input; return draft; } });
  assert.match(prompt, /<voice_guide>[\s\S]*最重的話用最短的句子講/);
  assert.match(prompt, /不得依它捏造門診故事/);
  assert.match(prompt, /回歸比例99\.3%/); assert.match(prompt, /hashtag/);
});
