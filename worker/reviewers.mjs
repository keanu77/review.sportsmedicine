import { runProcess, modelEnvironment } from './process.mjs';
import { PRIMARY_REVIEWER } from '../shared/quality.mjs';

// Google stopped serving Gemini CLI personal (Code Assist) logins in 2026-09
// ("migrate to Antigravity"), so Gemini reviews run through the Antigravity CLI.
// Flash reviews as well as Pro and is much faster; it only adds context, never verdicts.
export const GEMINI_MODEL = process.env.REVIEW_GEMINI_MODEL ?? 'gemini-3.8-flash-high';
export const GROK_MODEL = process.env.REVIEW_GROK_MODEL ?? 'grok-4.7-build-fast';
export const DEFAULT_REVIEWERS = 'codex,claude,grok,gemini';
export { PRIMARY_REVIEWER };

export function configuredReviewers(env = process.env) {
  return (env.REVIEW_REVIEWERS ?? DEFAULT_REVIEWERS).split(',').map(name => name.trim()).filter(Boolean);
}

// The primary reviewer must come from another model family than the writer.
export function assertSeats(draftProvider, providers) {
  if (providers.includes(PRIMARY_REVIEWER) && draftProvider === PRIMARY_REVIEWER) throw new Error(`寫稿模型與主審同為 ${PRIMARY_REVIEWER}；請把 REVIEW_MODEL_PROVIDER 改成 claude`);
}

const FIXES = {
  codex: '在 Mac 執行 codex，用 ChatGPT 帳號完成登入。',
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
  const detail = { codex: checks.codex, claude: checks.claude, gemini, grok: checks.grok };
  return Object.fromEntries(providers.filter(name => detail[name] !== undefined || FIXES[name]).map(name => {
    const status = detail[name] ?? { available: false, detail: '未檢查' };
    return [name, { available: Boolean(status.available), detail: String(status.detail ?? '').slice(0, 160), ...(name === PRIMARY_REVIEWER ? { primary: true } : {}), ...(status.available ? {} : { fix: FIXES[name] }) }];
  }));
}
