import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadImage, validateManifest, render } from './render-hybrid.mjs';

const manifest = () => ({ version:1,title:'跑步傷害',design:{palette:'blue',style:'clinical',imageStyle:'photo',format:'square',brand:'吳易澄醫師｜運動醫學',footer:'版型示範'},pages:[{id:'cover',layout:'cover',title:'跑步疼痛\n先停下來了解',subtitle:'注意身體發出的訊號'},{id:'body',layout:'content',title:'先記錄三件事',cards:[{title:'什麼時候痛？',body:'記錄疼痛出現的時間。'},{title:'哪個位置痛？',body:'注意疼痛的位置與範圍。'},{title:'活動有改變嗎？',body:'記錄近期訓練量與恢復狀況。'}]}],cover:{title:'跑步傷害',subtitle:'讀懂身體發出的訊號'} });

test('rejects invalid design, missing assets, traversal, symlink escape and fake image', async () => {
  const tmp=await mkdtemp(path.join(os.tmpdir(),'hybrid-paths-'));
  try {
    const m=manifest();m.design.palette='bogus';assert.throws(()=>validateManifest(m),/palette/);
    const crop=manifest();crop.pages[0].imagePosition={x:50,y:101};assert.throws(()=>validateManifest(crop),/imagePosition/);
    await assert.rejects(loadImage('../outside.png',tmp),/escapes/);
    await assert.rejects(loadImage('missing.png',tmp),/ENOENT/);
    await assert.rejects(loadImage('https://example.com/image.png',tmp),/relative/);
    await symlink(os.tmpdir(),path.join(tmp,'escape'));await assert.rejects(loadImage('escape',tmp),/symlink escapes/);
    await writeFile(path.join(tmp,'fake.png'),'not an image');await assert.rejects(loadImage('fake.png',tmp),/signature/);
  } finally {await rm(tmp,{recursive:true,force:true});}
});

test('renders real pixels for both styles; overflow refuses replacement; previous owned outputs are backed up', async () => {
  const tmp=await mkdtemp(path.join(os.tmpdir(),'hybrid-browser-'));
  try {
    const input=path.join(tmp,'manifest.json'),out=path.join(tmp,'output'),m=manifest();
    await writeFile(input,JSON.stringify(m));
    const first=await render(input,out,{textOnly:true});assert.equal(first.report.results.length,3);
    for(const item of first.report.results){const png=await readFile(path.join(out,item.file));assert.equal(png.readUInt32BE(16),item.width);assert.equal(png.readUInt32BE(20),item.height);assert.equal(item.checks.passed,true);}
    const prior=await readFile(path.join(out,'series/page-01.png'));
    m.pages[1].cards[0].body='這是不可刪除的內容與醫療限定語。'.repeat(90);await writeFile(input,JSON.stringify(m));
    await assert.rejects(render(input,out,{textOnly:true}),/fails layout/);
    assert.deepEqual(await readFile(path.join(out,'series/page-01.png')),prior);
    assert.equal((await readdir(out)).some(f=>f.startsWith('.hybrid-staging-')),false);
    const next=manifest();next.design.style='editorial';next.design.format='portrait';next.pages[1].cards.pop();
    await writeFile(path.join(tmp,'local.png'),prior);
    for(const page of [...next.pages,next.cover]){page.image='local.png';page.imageAlt='本機測試素材';page.imagePosition={x:50,y:30};}
    await writeFile(input,JSON.stringify(next));
    const second=await render(input,out);assert.ok(second.backup);
    assert.deepEqual(await readFile(path.join(second.backup,'series/page-01.png')),prior);
    assert.equal(second.report.design.style,'editorial');
    const portrait=await readFile(path.join(out,'series/page-01.png'));assert.equal(portrait.readUInt32BE(16),1080);assert.equal(portrait.readUInt32BE(20),1350);
    assert.equal(second.report.results.every(page=>page.imageUsed && page.checks.images[0].width===1080),true);
  } finally {await rm(tmp,{recursive:true,force:true});}
});
