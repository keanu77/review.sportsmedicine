import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('an unpublished upstream batch waits on day one and reports overdue data while continuing daily retries', () => {
  const early = syncDecision({ event: 'schedule', today: '2026-11-01', current: index('2026-10-01'), upstream: index('2026-10-01') });
  assert.equal(early.run, false);
  assert.match(early.reason, /尚未發布/);
  for (const today of ['2026-11-02', '2026-11-05', '2026-11-30']) {
    assert.throws(() => syncDecision({ event: 'schedule', today, current: index('2026-10-01'), upstream: index('2026-10-01') }), error => {
      assert.match(error.message, /尚未發布/);
      assert.match(error.message, /每日.*重試/);
      assert.doesNotMatch(error.message, /最後一次/);
      return true;
    });
  }
});

test('the workflow keeps a daily catch-up opportunity throughout every month', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/sync-data.yml', import.meta.url), 'utf8');
  const schedules = [...workflow.matchAll(/- cron: '([^']+)'\s+timezone: '([^']+)'/g)];
  assert.ok(schedules.some(([, cron, timezone]) => {
    const [, , day, month, weekday] = cron.split(/\s+/);
    return day === '*' && month === '*' && weekday === '*' && timezone === 'Asia/Taipei';
  }), 'A daily Taipei schedule must remain active after the second day of the month');
});

test('a batch published after the old retry deadline is caught up once and the next month remains eligible', () => {
  const old = index('2026-10-01'), november = index('2026-11-01');
  for (const today of ['2026-11-05', '2026-11-18', '2026-11-30']) {
    assert.equal(syncDecision({ event: 'schedule', today, current: old, upstream: november }).run, true);
    assert.equal(syncDecision({ event: 'schedule', today, current: november, upstream: november }).run, false);
  }
  assert.equal(syncDecision({ event: 'schedule', today: '2026-12-05', current: november, upstream: index('2026-12-01') }).run, true);
});
