import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePilotData } from '../../src/kbPilot.ts';
import { buildPilot, feedbackSnapshot, type PilotSource } from '../../scripts/build-kb-pilot.ts';
import type { Item } from '../../src/types.ts';
const titles={ 'prp-knee':'Platelet-rich plasma for knee osteoarthritis: a review', 'acl-rts':'Return to sport after ACL reconstruction: a systematic review','frozen-shoulder':'Interventions for adhesive capsulitis: a systematic review'};
const sources=Object.entries(titles).flatMap(([topic,title],k)=>Array.from({length:10},(_,i)=>({topic,title:`${title} ${i}`,doi:`10.1234/${topic}-${i}`,pmid:String(100+k*10+i),year:2026,sourceUrl:`https://europepmc.org/article/MED/${100+k*10+i}`,sourceCheckedAt:'2026-11-19T00:00:00Z',abstractExcerpt:'An abstract excerpt.'}))) as PilotSource[];
const meta={version:'pilot-v1',generatedAt:'2026-11-19T00:00:00Z',sourceUpdated:'2026-10-01',selectionNote:'A bounded convenience sample'};
test('builder produces 10 per cohort, namespace crosswalk, and deterministic feedback snapshot',()=>{
 const s=sources[0];
 const kb=[{id:'13271',title:s.title,url:`https://doi.org/${s.doi}`,summary:'PRIVATE FULLTEXT MUST NEVER APPEAR'}];
 const catalog=[{...s,url:`https://doi.org/${s.doi}`,themes:[],populations:[],region:'膝',disease:'OA',source:'test'}] as Item[];
 const a=buildPilot(meta,sources,kb,catalog,[]), b=buildPilot(meta,sources,kb,catalog,[]);
 assert.deepEqual(a,b);assert.equal(a.cards.length,30); assert.deepEqual(a.cards[0].kbRefs,[{namespace:'ethanai',id:'13271'}]);
 assert.match(a.cards[0].reviewUrl!,/^\/papers\//);assert.equal(a.cards[0].identityStatus,'matched');assert.equal(JSON.stringify(a).includes('PRIVATE'),false);
 assert.equal(feedbackSnapshot(a).targets[0].sha256,a.cards[0].sourceFingerprint);
 const changed=buildPilot(meta,sources.map((x,i)=>i?x:{...x,sourceCheckedAt:'2026-11-20T00:00:00Z'}),kb,catalog,[]);
 assert.notEqual(changed.cards[0].sourceFingerprint,a.cards[0].sourceFingerprint);
});
test('builder quarantines the known fulltext mismatch and removes its excerpt',()=>{
 const s=sources[0]; const kb=[{id:'13271',title:s.title,url:`https://doi.org/${s.doi}`}];
 const result=buildPilot(meta,sources,kb,[],[{namespace:'ethanai',id:'13271',expectedDoi:s.doi!,observedDoi:'10.1177/03635465241249996',summarySha256:'a'.repeat(64),observedAt:meta.generatedAt,evidenceUrl:'https://pubmed.ncbi.nlm.nih.gov/39754417/'}]);
 assert.equal(result.cards[0].identityStatus,'conflict');assert.equal(result.cards[0].evidenceStatus,'quarantined');assert.equal(result.cards[0].abstractExcerpt,undefined);assert.ok(result.cards[0].warnings.length);
});
test('builder refuses missing cohort, duplicate papers, source identifier mismatch, and wrong disease',()=>{
 assert.throws(()=>buildPilot(meta,sources.slice(1),[],[],[]),/30/);
 assert.throws(()=>buildPilot(meta,[sources[0],...sources.slice(0,29)],[],[],[]),/duplicate/);
 assert.throws(()=>buildPilot(meta,sources.map((x,i)=>i?x:{...x,sourceUrl:'https://europepmc.org/article/MED/999'}),[],[],[]),/source identity/);
 assert.throws(()=>buildPilot(meta,sources.map((x,i)=>i===20?{...x,title:'Shoulder arthritis: a systematic review'}:x),[],[],[]),/topic/);
});
test('committed real pilot retains 30 fixed sources and one quarantined source',()=>{
 const data=validatePilotData(JSON.parse(readFileSync(new URL('../../public/data/kb-pilot.json',import.meta.url),'utf8')));
 assert.equal(data.cards.length,30);
 for(const topic of Object.keys(titles)) assert.equal(data.cards.filter(c=>c.topic===topic).length,10);
 assert.equal(data.cards.filter(c=>c.kbRefs.some(r=>r.namespace==='ethanai')).length,8);
 assert.ok(data.cards.filter(c=>c.kbRefs.some(r=>r.namespace==='rss-kb')).length>=23);
 assert.equal(data.cards.filter(c=>c.evidenceDraft).length,29);
 assert.equal(data.cards.find(c=>c.pmid==='42527106')?.evidenceDraft,undefined);
 assert.ok(data.cards.find(c=>c.pmid==='42527106')?.evidenceMissingReason);
 assert.equal(data.cards.filter(c=>c.access?.freeFullText==='verified').length,16);
 assert.equal(data.cards.filter(c=>c.access?.oaStatus==='yes').length,15);
 assert.equal(data.cards.filter(c=>c.evidenceStatus==='quarantined').length,1);
 assert.equal(data.cards.find(c=>c.evidenceStatus==='quarantined')?.doi,'10.1186/s40001-025-03253-4');
 assert.deepEqual(feedbackSnapshot(data),JSON.parse(readFileSync(new URL('../../data/kb-pilot/feedback-snapshot.json',import.meta.url),'utf8')));
 assert.ok(data.cards.every(c=>c.fields.filter(f=>f.status==='needs-review').length>=3));
});

test('a catalog source reference alone preserves matched KB identity',()=>{
 const s=sources[0];
 const ref={namespace:'rss-kb' as const,id:'cmkwq373x001bzr017y89zf0z'};
 const catalog=[{...s,url:`https://doi.org/${s.doi}`,themes:[],populations:[],region:'膝',disease:'OA',source:'test',sourceRefs:[ref]}] as Item[];
 const result=buildPilot(meta,sources,[],catalog,[]);
 assert.deepEqual(result.cards[0].kbRefs,[ref]);
 assert.equal(result.cards[0].identityStatus,'matched');
});

test('publication rebuild uses the current index date and membership without fetching new evidence', async()=>{
 const { mkdtemp, mkdir, copyFile, writeFile, rm }=await import('node:fs/promises');
 const { tmpdir }=await import('node:os');const path=await import('node:path');
 const { loadPilot }=await import('../../scripts/build-kb-pilot.ts');
 const root=await mkdtemp(path.join(tmpdir(),'pilot-index-publication-'));
 try {
  await mkdir(path.join(root,'data/kb-pilot'),{recursive:true});await mkdir(path.join(root,'public/data'),{recursive:true});
  for(const file of ['manifest','sources','kb-metadata','source-conflicts','evidence-drafts','evidence-receipts','access-metadata'])
   await copyFile(new URL(`../../data/kb-pilot/${file}.json`,import.meta.url),path.join(root,`data/kb-pilot/${file}.json`));
  const seeds=JSON.parse(readFileSync(new URL('../../data/kb-pilot/sources.json',import.meta.url),'utf8'));
  const selected=seeds[20];
  await writeFile(path.join(root,'public/data/reviews-index.json'),JSON.stringify({meta:{updated:'2026-12-01'},items:[{...selected,url:`https://doi.org/${selected.doi}`,themes:[],populations:[],region:'肩',disease:'五十肩',source:'test'}]}));
  await writeFile(path.join(root,'public/data/bibliography.json'),JSON.stringify({records:[]}));
  const result=await loadPilot(root);
  assert.equal(result.sourceUpdated,'2026-12-01');
  assert.equal(result.cards.filter(c=>c.reviewUrl).length,1);
  assert.ok(result.cards.find(c=>c.doi===selected.doi)?.reviewUrl);
  assert.equal(result.cards.filter(c=>c.evidenceDraft).length,29);
 } finally {await rm(root,{recursive:true,force:true});}
});
