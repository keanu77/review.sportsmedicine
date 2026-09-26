import { spawn } from 'node:child_process';

export function runProcess(command, args, { cwd, input, signal, timeout = 60000, maxOutput = 16 * 1024 * 1024, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', failure, killTimer;
    const stop = reason => {
      failure ??= reason;
      try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer ??= setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
      killTimer.unref();
    };
    const abort = () => stop(signal.reason ?? new Error('工作已取消'));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(Object.assign(new Error('工具執行逾時；重試前請檢查既有輸出'), { code: 'ETIMEDOUT' })), timeout);
    const collect = name => chunk => { if (name === 'out') stdout += chunk; else stderr += chunk; if (stdout.length + stderr.length > maxOutput) stop(new Error('工具輸出超過限制')); };
    child.stdout.on('data', collect('out')); child.stderr.on('data', collect('err'));
    child.on('error', error => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      // A timed-out model may already have printed its answer; callers can recover it.
      if (failure) reject(failure.code === 'ETIMEDOUT' ? Object.assign(failure, { stdout }) : failure);
      else if (code !== 0) reject(new Error(`${command} 失敗 (${code})：${stderr.slice(-1200)}`));
      else resolve({ stdout, stderr });
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

export function modelEnvironment() {
  const allowed = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'NO_COLOR']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key)));
}

export function codexRestrictedArgs({ images = false } = {}) {
  const disabled = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'memories', 'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'in_app_local_automation'];
  if (!images) disabled.push('image_generation', 'view_image');
  return ['--ignore-user-config', ...disabled.flatMap(feature => ['--disable', feature]), '-c', 'web_search="disabled"'];
}
