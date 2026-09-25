import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { runProcess, modelEnvironment, codexRestrictedArgs } from './process.mjs';

const output = 'assets/hero-v1.png';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const png = bytes => bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
// Prompts are the image cache key: the photo/illustration wording and the
// original palette names must stay byte-identical to reuse earlier images.
const IMAGE_LOOKS = {
  photo: '自然寫實攝影，虛構成年人物', illustration: '清爽醫療插畫',
  flat: '扁平向量插畫，簡潔色塊與細線條，虛構成年人物', watercolor: '柔和水彩手繪插畫，紙張紋理，虛構成年人物',
  film: '底片復古攝影，細緻顆粒與暖色調，虛構成年人物',
};
const PALETTE_WORDS = { sage: '奶油米白與鼠尾草綠', coral: '珊瑚粉', lavender: '薰衣草紫', mono: '黑白高對比', clash: '電光藍與萊姆綠撞色' };
export function imagePrompt(title, design) {
  return `請使用內建圖片生成工具製作一張社群衛教情境主視覺。主題：${title.slice(0, 140)}。${IMAGE_LOOKS[design.imageStyle] ?? IMAGE_LOOKS.photo}，${['gold','orange','sky'].includes(design.palette) ? '深色背景' : '明亮白色背景'}，${PALETTE_WORDS[design.palette] ?? design.palette}點綴，橫式3:2，人物與動作自然。不要文字、字母、數字、標誌、箭頭、QR或解剖剖面。請回報產生的PNG完整路徑；不要用程式畫佔位圖。`;
}

export async function verifiedImage(directory, { prompt, design } = {}) {
  const record = JSON.parse(await readFile(path.join(directory, 'generation-prompts.json'), 'utf8'));
  const bytes = await readFile(path.join(directory, output));
  if (!png(bytes) || record.sha256 !== sha256(bytes) || record.output !== output || !/^[a-zA-Z0-9-]+$/.test(record.session ?? '') || !record.startedAt || !record.generatedAt || (prompt && record.prompt !== prompt) || (design && JSON.stringify(record.design) !== JSON.stringify(design))) throw new Error('圖片快取與生成紀錄不符');
  return record;
}

// Recover only a completed invocation and the PNG explicitly reported from that exact session.
export async function recoverImage(directory, request, transcript, generatedRoot = path.join(os.homedir(), '.codex', 'generated_images')) {
  const events = transcript.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const session = events.find(e => e.type === 'thread.started')?.thread_id;
  if (!session || !/^[a-zA-Z0-9-]+$/.test(session) || !events.some(e => e.type === 'turn.completed')) throw new Error('Codex 生圖缺少完成紀錄或有效 session');
  const base = await realpath(path.join(generatedRoot, session));
  const root = await realpath(generatedRoot);
  if (base !== path.join(root, session)) throw new Error('圖片 session 路徑越界');
  const messages = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text).join('\n');
  const files = (await readdir(base)).filter(name => /^[a-zA-Z0-9_-]+\.png$/.test(name) && messages.includes(path.join(generatedRoot, session, name)));
  if (files.length !== 1) throw new Error('生圖未明確回報唯一的本次 PNG 產物');
  const source = await realpath(path.join(base, files[0]));
  if (path.dirname(source) !== base) throw new Error('圖片路徑越界');
  const info = await stat(source), bytes = await readFile(source);
  if (!png(bytes) || bytes.length > 16 * 1024 * 1024 || !Number.isFinite(Date.parse(request.startedAt)) || info.mtimeMs < Date.parse(request.startedAt) - 1000) throw new Error('生成圖片格式、大小或生成時間不符');
  await mkdir(path.join(directory, 'assets'), { recursive: true, mode: 0o700 });
  await copyFile(source, path.join(directory, output));
  const record = { prompt: request.prompt, design: request.design, session, output, startedAt: request.startedAt, generatedAt: new Date().toISOString(), sha256: sha256(bytes), provenance: 'completed Codex CLI session + reported generated_images path + file timestamp/hash' };
  await writeFile(path.join(directory, 'generation-prompts.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  return output;
}

export async function generateHero(title, directory, design, { signal, allowRetry = false } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const prompt = imagePrompt(title, design), marker = path.join(directory, 'image-request.json');
  try { await verifiedImage(directory, { prompt, design }); return output; } catch {}
  let previous;
  try { previous = JSON.parse(await readFile(marker, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    if (previous.prompt === prompt && JSON.stringify(previous.design) === JSON.stringify(design)) {
      try { return await recoverImage(directory, previous, await readFile(path.join(directory, 'image-run.jsonl'), 'utf8')); } catch {}
    }
    if (!allowRetry) throw new Error('先前生圖結果不明或設計已變更，請檢查圖片工作日誌後明確重試');
  }
  const request = { prompt, design, startedAt: new Date().toISOString(), tool: 'codex-subscription' };
  await writeFile(marker, JSON.stringify(request, null, 2), { mode: 0o600 });
  // Prevent a new failed invocation being recovered from the previous transcript.
  await writeFile(path.join(directory, 'image-run.jsonl'), '', { mode: 0o600 });
  const { stdout } = await runProcess('codex', ['exec', ...codexRestrictedArgs({ images: true }), '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-'], {
    input: prompt, cwd: directory, signal, timeout: 10 * 60000, env: modelEnvironment(),
  });
  await writeFile(path.join(directory, 'image-run.jsonl'), stdout, { mode: 0o600 });
  return recoverImage(directory, request, stdout);
}
