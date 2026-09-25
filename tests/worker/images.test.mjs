import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recoverImage, verifiedImage, generateHero, imagePrompt } from '../../worker/images.mjs';

test('image recovery binds a completed session, exact output path, request and file hash', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'review-image-'));
  try {
    const root = path.join(dir, 'generated'), session = 'test-session', sourceDir = path.join(root, session);
    await mkdir(sourceDir, {recursive: true});
    const source = path.join(sourceDir, 'exec-result.png');
    const png = Buffer.alloc(40);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1536,16);png.writeUInt32BE(1024,20);
    await writeFile(source,png);
    const design={palette:'blue',style:'clinical',imageStyle:'photo',format:'portrait'}, prompt=imagePrompt('Running',design);
    const request={prompt,design,startedAt:new Date(Date.now()-500).toISOString()};
    const events=[{type:'thread.started',thread_id:session},{type:'item.completed',item:{type:'agent_message',text:source}},{type:'turn.completed'}];
    const transcript=events.map(e=>JSON.stringify(e)).join('\n');
    await assert.rejects(recoverImage(dir,request,events.slice(0,2).map(e=>JSON.stringify(e)).join('\n'),root),/完成/);
    await assert.rejects(recoverImage(dir,request,transcript.replace(source,'/other.png'),root),/唯一/);
    assert.equal(await recoverImage(dir,request,transcript,root),'assets/hero-v1.png');
    const proof=await verifiedImage(dir,{prompt,design});assert.match(proof.sha256,/^[a-f0-9]{64}$/);
    assert.equal(await generateHero('Running',dir,design),'assets/hero-v1.png');
    await assert.rejects(verifiedImage(dir,{prompt:'wrong'}),/不符/);
    png[30]=42;await writeFile(path.join(dir,'assets/hero-v1.png'),png);
    await assert.rejects(verifiedImage(dir),/不符/);
    await writeFile(path.join(dir,'image-request.json'),JSON.stringify(request));
    await assert.rejects(generateHero('Running',dir,design),/明確重試/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('new image styles and palettes get their own prompt while existing prompts stay byte-identical for the cache', async () => {
  const { imagePrompt } = await import('../../worker/images.mjs');
  const legacy = imagePrompt('Running', { palette: 'blue', style: 'clinical', imageStyle: 'photo', format: 'portrait' });
  assert.equal(legacy, '請使用內建圖片生成工具製作一張社群衛教情境主視覺。主題：Running。自然寫實攝影，虛構成年人物，明亮白色背景，blue點綴，橫式3:2，人物與動作自然。不要文字、字母、數字、標誌、箭頭、QR或解剖剖面。請回報產生的PNG完整路徑；不要用程式畫佔位圖。');
  assert.match(imagePrompt('Running', { palette: 'gold', imageStyle: 'illustration' }), /清爽醫療插畫，深色背景，gold點綴/);
  const cases = { flat: /扁平向量/, watercolor: /水彩/, film: /底片/ };
  for (const [imageStyle, pattern] of Object.entries(cases)) {
    const prompt = imagePrompt('Running', { palette: 'sage', imageStyle });
    assert.match(prompt, pattern); assert.match(prompt, /鼠尾草綠/); assert.match(prompt, /不要文字/); assert.match(prompt, /虛構/);
  }
});
