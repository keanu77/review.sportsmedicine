import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { fixture, fixtureDraft } from '../server/helpers.mjs';
import { WorkerAPI, processJob } from '../../worker/client.mjs';

// Actual worker/render/upload code and SQLite/JWT API; only research/model output and R2 are fixtures.
test('owner approved revision flows through worker rendering to authenticated ZIP download',async()=>{
  const f=await fixture(),workspace=await mkdtemp(path.join(os.tmpdir(),'review-worker-integration-'));
  try {
    const job=await f.create(),research=await f.claim();await f.upload(job.id,research.leaseToken);
    const draft={...fixtureDraft,post:'已確認的研究文案',pages:[{id:'cover',layout:'cover',title:'運動研究筆記',subtitle:'測試用草稿'},{id:'content',layout:'content',title:'保留研究限制',cards:[{title:'適用範圍',body:'此處使用測試資料，沒有呼叫模型。'}]},{id:'outro',layout:'outro',title:'回到原始文獻'}]};
    const completed=await f.call(`/jobs/${job.id}/complete`,{method:'POST',role:'worker',data:{leaseToken:research.leaseToken,draft,metadata:{paper:{title:'Fixture study',citation:'Fixture study. doi:10.1234/example',doi:'10.1234/example',sourceUrl:'https://doi.org/10.1234/example',license:null,fullTextVerified:true,sha256:'fixture'},reviews:[]},artifacts:['source']}});
    assert.equal(completed.status,200);const ready=(await completed.json()).job;
    const queued=await f.call(`/jobs/${job.id}/render`,{method:'POST',data:{revision:ready.revision,design:{imageStyle:'none',format:'portrait'}}});assert.equal(queued.status,200);
    const config={origin:'https://review.example.com',token:f.env.WORKER_TOKEN,workspace,provider:'codex'};
    let lostUploadResponse = false;
    const fetcher=async(url,options)=>{
      const response=await f.call(new URL(url).pathname.replace('/api/worker',''),{method:options.method,role:'worker',headers:options.headers,raw:options.body});
      if(options.method==='PUT' && response.status===201 && !lostUploadResponse){lostUploadResponse=true;throw new TypeError('fetch failed');}
      return response;
    };
    const api=new WorkerAPI(config,fetcher),claimed=await f.claim({imageGeneration:{available:false}});
    await processJob(api,claimed,config,{onStage:()=>{}});
    const result=(await (await f.call(`/jobs/${job.id}`)).json()).job;
    assert.equal(lostUploadResponse,true);assert.equal(result.status,'completed');assert.equal(result.draft.post,draft.post);
    const zip=result.artifacts.find(file=>file.name==='social-materials.zip');assert.ok(zip);
    assert.equal((await f.call(`/jobs/${job.id}/files/${zip.id}`,{role:'anonymous'})).status,401);
    const response=await f.call(`/jobs/${job.id}/files/${zip.id}`);assert.equal(response.status,200);
    const files=unzipSync(new Uint8Array(await response.arrayBuffer()));
    assert.equal(strFromU8(files['fb-post.md']),draft.post);assert.equal(files['paper.pdf'],undefined);
    const png=Buffer.from(files['series/page-01.png']);assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1350);
    assert.equal(result.metadata.render.revision,claimed.job.revision);
    assert.ok(result.artifacts.some(file=>file.name==='source.txt'),'research artifact remains accessible');
    assert.equal((await api.call('/claim',{data:{workerId:'test-mac',capabilities:{}}})).job,null);
  } finally { f.close();await rm(workspace,{recursive:true,force:true}); }
});
