import path from 'node:path';
import { runProcess, modelEnvironment } from './process.mjs';

// 9:16 carousel pages → cross-faded MP4 (topic-flow make-reel.sh ported to Node).
// Text lives on the images, so the reel reads without sound. No music is added.
export const REEL = { width: 1080, height: 1920, fps: 30, fade: 0.5, crf: 20 };
import { defaultDuration } from '../shared/manifest.mjs';
export { defaultDuration };

export function reelPlan(report, directory) {
  if (report.design?.format !== 'story') throw new Error('Reel 需要 9:16（story）版型的圖卡');
  const pages = report.results.filter(item => item.file.startsWith('series/'));
  if (!pages.length) throw new Error('沒有可製作 Reel 的圖卡');
  return pages.map((item, index) => ({ file: path.join(directory, item.file), duration: item.duration ?? defaultDuration(index, pages.length) }));
}

export function reelArgs(plan, output) {
  const inputs = [], filters = [];
  let previous = 'v0', offset = 0;
  plan.forEach(({ file, duration }, i) => {
    inputs.push('-loop', '1', '-framerate', String(REEL.fps), '-t', String(duration), '-i', file);
    // Normalising every frame avoids the dropped-page problem of mixed rgb/rgba PNGs.
    filters.push(`[${i}:v]scale=${REEL.width}:${REEL.height}:flags=lanczos,format=yuv420p,setsar=1[v${i}]`);
    if (i === 0) { offset = duration - REEL.fade; return; }
    filters.push(`[${previous}][v${i}]xfade=transition=fade:duration=${REEL.fade}:offset=${offset.toFixed(2)}[x${i}]`);
    previous = `x${i}`; offset += duration - REEL.fade;
  });
  const length = Number((offset + REEL.fade).toFixed(2));
  return { length, args: ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', `[${previous}]`, '-an', '-t', String(length), '-r', String(REEL.fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(REEL.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output] };
}

export async function makeReel(report, directory, output, { signal, run = runProcess } = {}) {
  const { args, length } = reelArgs(reelPlan(report, directory), output);
  try { await run('ffmpeg', args, { signal, timeout: 5 * 60000, env: modelEnvironment() }); }
  catch (error) { throw error.code === 'ENOENT' ? new Error('Mac 沒有安裝 ffmpeg，無法製作 Reel；請執行 brew install ffmpeg，或改選其他尺寸') : error; }
  return { file: output, seconds: length };
}
