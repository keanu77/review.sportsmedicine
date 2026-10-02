import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDecision } from '../../scripts/sync-gate.mjs';

const index = updated => ({ meta: { updated } });

test('manual runs always proceed', () => {
  assert.equal(syncDecision({ event: 'workflow_dispatch', today: '2026-11-01', current: index('2026-10-01'), upstream: index('2026-10-01') }).run, true);
});

test('scheduled runs publish this month\'s batch once, including late upstream batches', () => {
  assert.equal(syncDecision({ event: 'schedule', today: '2026-11-01', current: index('2026-10-01'), upstream: index('2026-11-01') }).run, true);
  // 上游延遲到 1 日中午後才發布：第 2 日的補跑仍接受 11-01 的批次
  assert.equal(syncDecision({ event: 'schedule', today: '2026-11-02', current: index('2026-10-01'), upstream: index('2026-11-01') }).run, true);
  // 已同步過本月：補跑不重做
  const done = syncDecision({ event: 'schedule', today: '2026-11-02', current: index('2026-11-01'), upstream: index('2026-11-01') });
  assert.equal(done.run, false);
  assert.match(done.reason, /已同步/);
});

test('an unpublished upstream batch waits for the catch-up run, then fails loudly on the last attempt', () => {
  const early = syncDecision({ event: 'schedule', today: '2026-11-01', current: index('2026-10-01'), upstream: index('2026-10-01') });
  assert.equal(early.run, false);
  assert.match(early.reason, /尚未發布/);
  assert.throws(() => syncDecision({ event: 'schedule', today: '2026-11-02', current: index('2026-10-01'), upstream: index('2026-10-01') }), /尚未發布/);
});
