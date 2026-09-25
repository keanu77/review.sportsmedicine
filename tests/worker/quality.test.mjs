import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDraft, claimKey, sourceNumberSet, extractNumbers, DISCLAIMER, withDisclaimer } from '../../shared/quality.mjs';

const claims = [
  { text: '274人中272人恢復運動，比例99.3%', locator: 'p:1', quote: '272 of 274 athletes (99.3%) returned to sport' },
  { text: '平均回歸時間11.4週', locator: 'p:1', quote: 'after a mean of 11.4 weeks' },
];
const clean = () => ({
  post: `274人中272人恢復運動，比例99.3%，平均11.4週。\n\n${DISCLAIMER}`,
  igCaption: `平均11.4週回歸。\n\n${DISCLAIMER}`, notes: '筆記',
  pages: [{ id: 'cover', layout: 'cover', title: '手肘脫臼能回場嗎' }, { id: 'p2', layout: 'content', title: '多數恢復運動', cards: [{ title: '比例99.3%', body: '272人恢復運動' }] }, { id: 'end', layout: 'outro', title: '先釐清目標' }],
  claims,
});
const locked = { decisions: Object.fromEntries(claims.map(c => [claimKey(c), { status: 'locked' }])) };
const sourceNumbers = sourceNumberSet('Nine studies with 970 athletes; 272 of 274 athletes (99.3%) returned after a mean of 11.4 weeks; three studies reported 60% to 100%.');
const codes = result => result.errors.map(e => e.code);

test('a clean draft with every claim locked and numbers found in the source passes', () => {
  const result = checkDraft(clean(), { claimReview: locked, sourceNumbers });
  assert.deepEqual(result.errors, []);
});

test('claims must all be decided, at least one locked, and rejected claims must leave the draft', () => {
  assert.ok(codes(checkDraft(clean(), { sourceNumbers })).includes('CLAIMS_UNDECIDED'));
  const rejected = { decisions: { [claimKey(claims[0])]: { status: 'locked' }, [claimKey(claims[1])]: { status: 'rejected' } } };
  const result = checkDraft(clean(), { claimReview: rejected, sourceNumbers });
  assert.ok(codes(result).includes('CLAIM_REJECTED_PRESENT'));
  assert.equal(result.errors.find(e => e.code === 'CLAIM_REJECTED_PRESENT').overridable, false);
  const allRejected = { decisions: Object.fromEntries(claims.map(c => [claimKey(c), { status: 'rejected' }])) };
  assert.ok(codes(checkDraft({ ...clean(), claims }, { claimReview: allRejected, sourceNumbers })).includes('NO_LOCKED_CLAIM'));
});

test('simplified characters, §85 guarantees, 病歷 and missing disclaimers are located precisely', () => {
  const draft = clean();
  draft.igCaption = `不能据此判定哪种治疗更好。`;
  draft.pages[1].cards[0].body = '保證治癒，免開刀';
  draft.post = draft.post.replace(DISCLAIMER, '請帶病歷就診');
  const result = checkDraft(draft, { claimReview: locked, sourceNumbers });
  const simplified = result.errors.find(e => e.code === 'SIMPLIFIED');
  assert.match(simplified.message, /据/); assert.match(simplified.message, /种/); assert.match(simplified.where, /IG/);
  assert.ok(result.errors.some(e => e.code === 'COMPLIANCE' && /保證治癒/.test(e.message) && /第 2 頁/.test(e.where)));
  assert.ok(result.errors.some(e => e.code === 'MEDICAL_RECORD'));
  assert.deepEqual(result.warnings.filter(e => e.code === 'DISCLAIMER').map(e => e.where).sort(), ['FB 貼文', 'IG 文案'].sort());
  assert.equal(result.errors.some(e => e.code === 'DISCLAIMER'), false, 'exports add the disclaimer, so it never blocks');
});

test('traditional characters that look simplified are not flagged', () => {
  const draft = clean(); draft.post = `皇后、里程、干擾、台灣、只有、系統、面對、准備、余光、于姓。\n\n${DISCLAIMER}`;
  assert.equal(checkDraft(draft, { claimReview: locked, sourceNumbers }).errors.filter(e => e.code === 'SIMPLIFIED').length, 0);
});

test('numbers must appear in the verified source text; spelled-out English counts and ranges are understood', () => {
  const draft = clean();
  draft.pages[1].cards[0].body = '9篇研究共970人，3篇回報60%至100%';
  assert.equal(checkDraft(draft, { claimReview: locked, sourceNumbers }).errors.filter(e => e.code === 'NUMBER_NOT_IN_SOURCE').length, 0);
  draft.pages[1].cards[0].body = '約85%在8週內回場';
  const bad = checkDraft(draft, { claimReview: locked, sourceNumbers }).errors.filter(e => e.code === 'NUMBER_NOT_IN_SOURCE');
  assert.deepEqual(bad.map(e => e.message.match(/「(.+?)」/)[1]).sort(), ['85%', '8週'].sort());
  assert.equal(bad[0].overridable, true);
});

test('without stored source numbers, numbers outside locked claims are only warnings', () => {
  const draft = clean(); draft.pages[1].cards[0].body = '約85%回場';
  const result = checkDraft(draft, { claimReview: locked });
  assert.equal(result.errors.filter(e => /NUMBER/.test(e.code)).length, 0);
  assert.ok(result.warnings.some(w => w.code === 'NUMBER_NOT_IN_CLAIMS' && /85%/.test(w.message)));
});

test('style warnings, number extraction and disclaimer helper', () => {
  const draft = clean(); draft.post = `這不是休息，而是調整負荷——很重要。\n\n${DISCLAIMER}`;
  const result = checkDraft(draft, { claimReview: locked, sourceNumbers });
  assert.ok(result.warnings.some(w => w.code === 'NOT_BUT')); assert.ok(result.warnings.some(w => w.code === 'DASH'));
  assert.deepEqual(extractNumbers('介於６０％至100% 之間，約 11.4 週，三個月'), ['60%至100%', '11.4週']);
  assert.equal(withDisclaimer('內文'), `內文\n\n${DISCLAIMER}`);
  assert.equal(withDisclaimer(`內文\n\n${DISCLAIMER}`), `內文\n\n${DISCLAIMER}`);
  assert.equal(claimKey(claims[0]), claimKey({ ...claims[0] })); assert.notEqual(claimKey(claims[0]), claimKey(claims[1]));
});
