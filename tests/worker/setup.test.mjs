import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify, parseEnv } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { generateSetup, parseArgs } from '../../worker/setup-launchagent.mjs';

const exec = promisify(execFile);
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'review-setup-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo & <草稿> "quoted"');
  await mkdir(path.join(repo, 'worker'), { recursive: true });
  await writeFile(path.join(repo, 'worker', 'cli.mjs'), 'throw new Error("setup must not execute worker");');
  return { root, repo, output: path.join(root, 'service with 空格 $(no-shell) $&') };
}

test('writes private reviewable templates with correct plist arguments and no inherited secrets', async t => {
  const { root, repo, output } = await fixture(t);
  const tokenBefore = process.env.REVIEW_WORKER_TOKEN;
  process.env.REVIEW_WORKER_TOKEN = 'DO-NOT-COPY-THIS-SECRET';
  try {
    const result = await generateSetup({ repoDir: repo, outputDir: output, binDirs: ['/opt/CLI & tools/bin'] });
    assert.equal(result.activated, false);
    assert.deepEqual((await readdir(root)).sort(), [path.basename(repo), path.basename(output)].sort());
    assert.deepEqual((await readdir(output)).sort(), ['README.txt', 'logs', 'tw.sportsmedicine.review-worker.plist', 'worker.env.example']);
    const plist = await readFile(result.plist, 'utf8');
    const env = await readFile(result.envTemplate, 'utf8');
    assert.doesNotMatch(plist + env, /DO-NOT-COPY-THIS-SECRET/);
    assert.doesNotMatch(plist, /REVIEW_WORKER_TOKEN|launchctl|<string>\/?bin\/(?:sh|zsh|bash)<\/string>/);
    assert.equal(parseEnv(env).REVIEW_WORKER_TOKEN, '');
    assert.equal(parseEnv(env).REVIEW_WORKSPACE, path.join(output, 'workspace'));
    assert.equal(parseEnv(env).REVIEW_IMAGE_PROBE_DIR, '');
    assert.match(plist, /&amp; &lt;草稿&gt; &quot;quoted&quot;/);
    assert.match(plist, /<key>Umask<\/key><integer>63<\/integer>/);
    assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
    assert.match(plist, /--env-file=/);
    for (const filename of [result.plist, result.envTemplate, path.join(output, 'README.txt')]) assert.equal((await stat(filename)).mode & 0o777, 0o600);
    for (const directory of [output, path.join(output, 'logs')]) assert.equal((await stat(directory)).mode & 0o777, 0o700);
    if (process.platform === 'darwin') {
      await exec('/usr/bin/plutil', ['-lint', result.plist]);
      const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', result.plist]);
      const parsed = JSON.parse(stdout);
      assert.deepEqual(parsed.ProgramArguments, [process.execPath, `--env-file=${path.join(output, 'worker.env')}`, path.join(repo, 'worker', 'cli.mjs'), 'run']);
      assert.equal(parsed.WorkingDirectory, repo);
      assert.equal(parsed.EnvironmentVariables.PATH.split(':')[0], path.dirname(process.execPath));
      assert.equal(parsed.EnvironmentVariables.PATH.includes('/opt/CLI & tools/bin'), true);
    }
  } finally { if (tokenBefore === undefined) delete process.env.REVIEW_WORKER_TOKEN; else process.env.REVIEW_WORKER_TOKEN = tokenBefore; }
});

test('refuses existing directories and symlinks without overwriting any configuration', async t => {
  const { root, repo, output } = await fixture(t);
  await generateSetup({ repoDir: repo, outputDir: output });
  const file = path.join(output, 'worker.env.example');
  await writeFile(file, 'DO-NOT-OVERWRITE');
  await assert.rejects(generateSetup({ repoDir: repo, outputDir: output }), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), 'DO-NOT-OVERWRITE');
  const link = path.join(root, 'linked-service');
  await symlink(output, link);
  await assert.rejects(generateSetup({ repoDir: repo, outputDir: link }), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), 'DO-NOT-OVERWRITE');
});

test('invalid configuration never creates an output directory or echoes credential arguments', async t => {
  const { root, repo, output } = await fixture(t);
  for (const values of [
    { label: '../outside' }, { outputDir: 'relative/path' }, { outputDir: output + '"' },
    { binDirs: ['/path:other'] }, { nodePath: path.join(root, 'missing-node') }, { repoDir: root },
  ]) await assert.rejects(generateSetup({ repoDir: repo, outputDir: output, ...values }));
  assert.deepEqual(await readdir(root), [path.basename(repo)]);
  assert.throws(() => parseArgs(['--token', 'DO-NOT-ECHO']), error => !error.message.includes('DO-NOT-ECHO'));
  assert.throws(() => parseArgs(['--repo', repo]));
  assert.throws(() => parseArgs(['--repo', repo, '--repo', repo, '--output', output]));
  assert.deepEqual(parseArgs(['--repo', repo, '--output', output, '--bin-dir', '/one', '--bin-dir', '/two']), { repoDir: repo, outputDir: output, binDirs: ['/one', '/two'] });
});
