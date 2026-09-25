import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResult } from '../../worker/review.mjs';

const finding = { severity: 'medium', claim: '標題過度推論', reason: '原文只說資料有限', locator: 'p:1', quote: 'return to preinjury level was reported', suggestion: '改寫標題' };
const real = { summary: '核心數字相符，標題過度推論', findings: [finding] };

test('Grok camelCase structuredOutput is used even when text holds a progress note plus the answer', () => {
  const placeholder = { summary: 'Reading the full prompt first', findings: [] };
  const raw = JSON.stringify({ text: JSON.stringify(placeholder) + JSON.stringify(real), stopReason: 'end_turn', structuredOutput: real });
  assert.deepEqual(parseResult(raw), real);
});

test('without structured output the last complete JSON object in text is the answer', () => {
  const raw = JSON.stringify({ text: `{ "summary": "Reading first", "findings": [] }${JSON.stringify(real)}` });
  assert.deepEqual(parseResult(raw), real);
  const fenced = JSON.stringify({ result: '```json\n' + JSON.stringify(real) + '\n```' });
  assert.deepEqual(parseResult(fenced), real);
  const withBraceInString = { summary: '含有 } 與 { 的摘要', findings: [finding] };
  assert.deepEqual(parseResult(JSON.stringify({ text: 'note {"x":1} then ' + JSON.stringify(withBraceInString) })), withBraceInString);
});

test('Claude and Gemini shapes keep working and malformed findings are still rejected', () => {
  assert.deepEqual(parseResult(JSON.stringify({ structured_output: real })), real);
  assert.deepEqual(parseResult(JSON.stringify({ response: JSON.stringify(real) })), real);
  assert.throws(() => parseResult(JSON.stringify({ structuredOutput: { summary: 'x', findings: [{ ...finding, severity: 'critical' }] } })), /格式不符/);
  assert.throws(() => parseResult(JSON.stringify({ text: 'no json here' })), /格式不符|JSON/);
});
