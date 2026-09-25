import { runProcess, modelEnvironment } from './process.mjs';

// Google stopped serving Gemini CLI personal (Code Assist) logins in 2026-09
// ("migrate to Antigravity"), so Gemini reviews run through the Antigravity CLI.
export const GEMINI_MODEL = process.env.REVIEW_GEMINI_MODEL ?? 'gemini-3.1-pro-high';

const FIXES = {
  claude: '在 Mac 執行 claude，完成訂閱登入。',
  gemini: '在 Mac 的終端機執行 agy，完成 Antigravity 登入。',
  grok: '在 Mac 安裝並登入 grok CLI。',
};

// `agy models` needs a signed-in account but spends no review usage.
export async function antigravityStatus(run = runProcess) {
  try {
    const { stdout } = await run('agy', ['models'], { timeout: 30000, env: modelEnvironment() });
    if (!stdout.split('\n').some(line => line.split('\t')[0].trim() === GEMINI_MODEL)) return { available: false, detail: `Antigravity 沒有提供 ${GEMINI_MODEL}；可用 REVIEW_GEMINI_MODEL 改用其他 Gemini 模型` };
    return { available: true, detail: `Antigravity（${GEMINI_MODEL}）` };
  } catch (error) {
    return { available: false, detail: error.code === 'ENOENT' ? 'Antigravity CLI（agy）未安裝' : String(error.message).slice(0, 160) };
  }
}

export function reviewerStatus(checks, gemini, providers) {
  const detail = { claude: checks.claude, gemini, grok: checks.grok };
  return Object.fromEntries(providers.filter(name => detail[name] !== undefined || FIXES[name]).map(name => {
    const status = detail[name] ?? { available: false, detail: '未檢查' };
    return [name, { available: Boolean(status.available), detail: String(status.detail ?? '').slice(0, 160), ...(status.available ? {} : { fix: FIXES[name] }) }];
  }));
}
