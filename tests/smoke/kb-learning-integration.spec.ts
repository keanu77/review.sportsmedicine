import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

// Run against the companion KB repository's actual CLI, with an isolated test queue.
// No clinical approval or database access is involved.
const cli = process.env.REVIEW_KB_FEEDBACK_CLI;
test('real card download completes the Python accept, browser import and withdrawal loop', async ({ page }) => {
  test.skip(!cli, 'Set REVIEW_KB_FEEDBACK_CLI to the companion scripts/review_kb_feedback.py');
  const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  const run = (...args: string[]) => JSON.parse(execFileSync('python3', [cli!, ...args], { encoding: 'utf8' }));
  const file = (name: string) => test.info().outputPath(name);
  await page.goto('/?view=kb-pilot');
  await expect(page.getByRole('article')).toHaveCount(10);
  const first = page.getByRole('article').first();
  const note = '整合測試批註：僅驗證來源綁定及撤回，不構成臨床審核。';
  await first.getByText('提出閱讀卡修正', { exact: true }).click();
  await first.getByLabel('修正原因', { exact: true }).fill('自動化流程驗證，不修改醫學結論。');
  await first.getByLabel('建議修正內容', { exact: true }).fill(note);
  const downloading = page.waitForEvent('download');
  await first.getByRole('button', { name: '下載待審核修正', exact: true }).click();
  const download = await downloading;
  await download.saveAs(file('proposal.json'));
  const proposal = JSON.parse(readFileSync(file('proposal.json'), 'utf8'));
  const queue = file('queue.json'), snapshot = path.resolve('data/kb-pilot/feedback-snapshot.json');
  const imported = run('import', '--package', file('proposal.json'), '--queue', queue);
  expect(imported.status).toBe('imported');
  const accepted = run('review', '--queue', queue, '--snapshot', snapshot, '--id', proposal.id, '--decision', 'accept', '--reviewer', 'automated-integration-test', '--reason', '非臨床審核；驗證實際 CLI 契約。');
  expect(accepted.status).toBe('accepted');
  expect(run('export', '--queue', queue, '--out', file('accepted.json')).accepted).toBe(1);
  await page.getByLabel('載入本機審核檔').setInputFiles(file('accepted.json'));
  await expect(first.getByRole('complementary', { name: '本機審核批註' }).getByText(note, { exact: true })).toBeVisible();
  const stale = JSON.parse(readFileSync(file('accepted.json'), 'utf8'));
  stale.entries[0].pilotVersion += '-stale';
  await page.getByLabel('載入本機審核檔').setInputFiles({ name: 'stale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stale)) });
  await expect(page.getByRole('alert').filter({ hasText: '無法套用本機審核檔' })).toBeVisible();
  await expect(first.getByRole('complementary', { name: '本機審核批註' }).getByText(note, { exact: true })).toBeVisible();
  expect(run('withdraw', '--queue', queue, '--id', proposal.id, '--reviewer', 'automated-integration-test', '--reason', '撤回測試批註。').status).toBe('withdrawn');
  expect(run('export', '--queue', queue, '--out', file('withdrawn.json')).accepted).toBe(0);
  await page.getByLabel('載入本機審核檔').setInputFiles(file('withdrawn.json'));
  await expect(page.getByRole('heading', { name: '本機審核批註', exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  const receipt = { pilotVersion: proposal.pilotVersion, paperId: proposal.paperId, downloaded: true, pythonImported: true, pythonAccepted: true, browserApplied: true, staleRejected: true, pythonWithdrawn: true, browserCleared: true, networkWrites: writes.length, clinicalApproval: false, productionWrite: false };
  writeFileSync(file('interop-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  await test.info().attach('interop-receipt', { path: file('interop-receipt.json'), contentType: 'application/json' });
});
