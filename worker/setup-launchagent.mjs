#!/usr/bin/env node
// Only generates reviewable files under a new, explicitly selected directory.
// Never reads credentials, writes to ~/Library, or invokes launchctl / a model.
import path from 'node:path';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_LABEL = 'tw.sportsmedicine.review-worker';
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
const validPath = (value, name) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${name} 必須是絕對路徑且不含控制字元`);
  return path.resolve(value);
};

export async function generateSetup({ outputDir, repoDir, nodePath = process.execPath, label = DEFAULT_LABEL, binDirs = [] }) {
  const output = validPath(outputDir, '--output');
  const repo = await realpath(validPath(repoDir, '--repo'));
  const node = validPath(nodePath, '--node');
  // The generated dotenv value uses double quotes; reject ambiguous delimiters.
  if (/["\\]/.test(output)) throw new Error('--output 路徑不可含雙引號或反斜線');
  if (typeof label !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,99}$/.test(label)) throw new Error('--label 只能包含英數、點和連字號');
  if (!Array.isArray(binDirs)) throw new Error('--bin-dir 必須是路徑陣列');
  const searchDirs = [...new Set([path.dirname(node), ...binDirs.map(dir => validPath(dir, '--bin-dir')), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])];
  if (searchDirs.some(dir => dir.includes(':'))) throw new Error('PATH 目錄不可含冒號');
  const cli = path.join(repo, 'worker', 'cli.mjs');
  await access(cli, constants.R_OK);
  await access(node, constants.X_OK);
  const template = await readFile(new URL('./.env.example', import.meta.url), 'utf8');
  const envTemplate = template.replace(/^REVIEW_WORKSPACE=.*$/m, () => `REVIEW_WORKSPACE="${path.join(output, 'workspace')}"`);
  const envFile = path.join(output, 'worker.env');
  const logs = path.join(output, 'logs');
  const plistFile = path.join(output, `${label}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string>
    <string>${xml(`--env-file=${envFile}`)}</string>
    <string>${xml(cli)}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(searchDirs.join(':'))}</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logs, 'worker.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, 'worker.err.log'))}</string>
</dict></plist>
`;
  // mkdir is exclusive and not recursive: the parent must exist, and an existing
  // output (including a symlink) is never reused or overwritten.
  await mkdir(output, { mode: 0o700 });
  await mkdir(logs, { mode: 0o700 });
  await writeFile(plistFile, plist, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(output, 'worker.env.example'), envTemplate, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(output, 'README.txt'), [
    '僅產生範本，尚未安裝或啟動服務。',
    '1. 檢查 plist 中的 Node、repo、PATH 與日誌路徑。',
    '2. 複製 worker.env.example 為 worker.env，chmod 600，再用編輯器填設定。',
    '3. 依 docs/worker-setup.md 完成 CLI 登入、Cloudflare 設定與前景驗證。',
    '4. 驗證後才自行安裝 LaunchAgent；setup 不會呼叫 launchctl。',
    'LaunchAgent 只在該使用者登入且 Mac 醒著時工作；沒有自動發布功能。',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  return { outputDir: output, plist: plistFile, envTemplate: path.join(output, 'worker.env.example'), activated: false };
}

export function parseArgs(args) {
  const names = { '--output':'outputDir', '--repo':'repoDir', '--node':'nodePath', '--label':'label' };
  const options = { binDirs: [] };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if ((!names[flag] && flag !== '--bin-dir') || !value || value.startsWith('--')) throw new Error('參數錯誤；使用 --help 查看範本產生用法');
    if (flag === '--bin-dir') options.binDirs.push(value);
    else { if (options[names[flag]] !== undefined) throw new Error('同一參數不可重複'); options[names[flag]] = value; }
  }
  if (!options.outputDir || !options.repoDir) throw new Error('必須指定 --output 與 --repo 絕對路徑');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
    console.log('用法：node worker/setup-launchagent.mjs --repo /absolute/repo --output /absolute/new-directory [--node /absolute/node] [--bin-dir /absolute/cli-bin] [--label tw.sportsmedicine.review-worker]\n只寫入指定的新目錄，不讀取 token、不啟動服務。--bin-dir 可重複。');
  } else {
    try { console.log(JSON.stringify(await generateSetup(parseArgs(process.argv.slice(2))), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
