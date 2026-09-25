import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pruneWorkspace, prepareResearchDirectory } from '../../worker/client.mjs';

async function temporary(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'review-manage-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const kept = '11111111-1111-4111-8111-111111111111', gone = '22222222-2222-4222-8222-222222222222';

test('workspace pruning removes only UUID folders the server reports as deleted', async t => {
  const workspace = await temporary(t);
  for (const name of [kept, gone, 'manual']) await mkdir(path.join(workspace, name, 'research'), { recursive: true });
  await writeFile(path.join(workspace, 'notes.txt'), 'keep');
  let asked;
  const removed = await pruneWorkspace({ call: async (route, { data }) => { asked = { route, ids: data.ids }; return { unknown: [gone] }; } }, workspace);
  assert.equal(asked.route, '/workspace/unknown'); assert.deepEqual(asked.ids.sort(), [kept, gone].sort());
  assert.deepEqual(removed, [gone]);
  assert.deepEqual((await readdir(workspace)).sort(), [kept, 'manual', 'notes.txt'].sort());
});

test('workspace pruning deletes nothing when the server is unreachable or answers with foreign ids', async t => {
  const workspace = await temporary(t);
  await mkdir(path.join(workspace, gone), { recursive: true });
  await assert.rejects(pruneWorkspace({ call: async () => { throw new Error('offline'); } }, workspace), /offline/);
  assert.deepEqual(await pruneWorkspace({ call: async () => ({ unknown: ['../../etc', kept] }) }, workspace), []);
  assert.deepEqual(await readdir(workspace), [gone]);
});

test('a restart request clears cached research once; later attempts of the same request keep progress', async t => {
  const directory = path.join(await temporary(t), 'research');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'draft.json'), 'old cached draft');
  await prepareResearchDirectory(directory, undefined);
  assert.equal(await readFile(path.join(directory, 'draft.json'), 'utf8'), 'old cached draft', 'ordinary research keeps its cache');
  await prepareResearchDirectory(directory, { id: 'restart-1' });
  assert.deepEqual(await readdir(directory), ['.restart-request']);
  await writeFile(path.join(directory, 'source.json'), 'new progress');
  await prepareResearchDirectory(directory, { id: 'restart-1' });
  assert.equal(await readFile(path.join(directory, 'source.json'), 'utf8'), 'new progress');
  await prepareResearchDirectory(directory, { id: 'restart-2' });
  assert.deepEqual(await readdir(directory), ['.restart-request']);
  await assert.rejects(prepareResearchDirectory(directory, { id: '../x' }), /restart/);
});
