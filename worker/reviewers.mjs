import os from 'node:os';
import path from 'node:path';
import { readFile, access } from 'node:fs/promises';

const FIXES = {
  claude: '在 Mac 執行 claude，完成訂閱登入。',
  gemini: '在 Mac 執行 gemini，選「Login with Google」完成登入。',
  grok: '在 Mac 安裝並登入 grok CLI。',
};

// The worker strips API keys from model environments, so only a stored Google
// login (oauth-personal + oauth_creds.json) lets Gemini run unattended.
export async function geminiAuthStatus(home = os.homedir()) {
  let settings;
  try { settings = JSON.parse(await readFile(path.join(home, '.gemini', 'settings.json'), 'utf8')); }
  catch { return { available: false, detail: 'Gemini CLI 尚未設定登入方式；在 Mac 執行 gemini 完成 Google 登入' }; }
  const type = settings?.security?.auth?.selectedType ?? settings?.selectedAuthType;
  if (!type) return { available: false, detail: 'Gemini CLI 尚未選擇登入方式；在 Mac 執行 gemini 完成 Google 登入' };
  if (type !== 'oauth-personal') return { available: false, detail: `Gemini CLI 使用 ${type}；工作程式不傳遞 API key，請改用 Google 登入` };
  try { await access(path.join(home, '.gemini', 'oauth_creds.json')); }
  catch { return { available: false, detail: 'Gemini CLI 選了 Google 登入但沒有登入憑證；在 Mac 執行 gemini 重新登入' }; }
  return { available: true, detail: 'Google 登入' };
}

export function reviewerStatus(checks, gemini, providers) {
  const detail = { claude: checks.claude, gemini, grok: checks.grok };
  return Object.fromEntries(providers.filter(name => detail[name] !== undefined || FIXES[name]).map(name => {
    const status = detail[name] ?? { available: false, detail: '未檢查' };
    return [name, { available: Boolean(status.available), detail: String(status.detail ?? '').slice(0, 160), ...(status.available ? {} : { fix: FIXES[name] }) }];
  }));
}
