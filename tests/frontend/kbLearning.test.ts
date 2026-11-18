import test from 'node:test';
import assert from 'node:assert/strict';
import { uniquePapers } from '../../src/identity.ts';
import { sourceRefs } from '../../src/sourceRefs.ts';
import { learningReport, parseLocalOverlay } from '../../src/kbLearning.ts';
import { validatePilotData, type PilotCard, type PilotData } from '../../src/kbPilot.ts';
import type { Item } from '../../src/types.ts';
const rss1={namespace:'rss-kb' as const,id:'cmkwq373x001bzr017y89zf0z'},rss2={namespace:'rss-kb' as const,id:'cmnn7ndhj018rzl01e7hx4tz8'},ethan={namespace:'ethanai' as const,id:'13271'};
const card: PilotCard={id:'doi:10.1234/a',doi:'10.1234/a',pmid:'123',topic:'prp-knee',title:'Platelet rich plasma for knee osteoarthritis: a review',sourceUrl:'https://europepmc.org/article/MED/123',sourceCheckedAt:'2026-11-19T00:00:00Z',kbRefs:[rss1,rss2,ethan],identityStatus:'matched',evidenceStatus:'metadata',sourceFingerprint:'a'.repeat(64),question:'研究範圍？',fields:[],warnings:[]};
const data: PilotData={schemaVersion:1,version:'pilot-v2',generatedAt:card.sourceCheckedAt,sourceUpdated:'2026-10-01',selectionNote:'固定樣本',cards:[card]};
const pkg={schemaVersion:1,id:'f62cc1b7-c3ed-5d36-96c9-28c96d642b14',pilotVersion:data.version,paperId:card.id,target:{namespace:'review-pilot',id:card.id,field:'reading_card'},expectedSha256:card.sourceFingerprint,proposedValue:'核對後保留原始研究限制。',reason:'方法需註明。',evidence:[{url:card.sourceUrl,locator:'abstract'}],review:{at:card.sourceCheckedAt,reviewer:'local operator',reason:'核對本機來源',snapshotSha256:'b'.repeat(64)}};
const overlay={schemaVersion:1,scope:'local-review-overlay',clinicalApproval:false,productionWrite:false,entries:[pkg],events:[]};
test('source continuity keeps distinct namespaces and deduplicates repeated refs',()=>{
 assert.deepEqual(sourceRefs([rss2,rss1,ethan,rss1]),[ethan,rss1,rss2].sort((a,b)=>`${a.namespace}:${a.id}`.localeCompare(`${b.namespace}:${b.id}`)));
 assert.deepEqual(sourceRefs([{namespace:'rss-kb',id:'13271'},{namespace:'ethanai',id:'-1'},{namespace:'unknown',id:'123'},rss1]),[rss1]);
 const item={title:card.title,doi:card.doi,url:card.sourceUrl,year:2026,source:'test',free:false,tldr:null,region:'膝',disease:'OA',themes:[],populations:[]} as Item;
 const merged=uniquePapers([{...item,sourceRefs:[rss1]},{...item,sourceRefs:[rss2,ethan,rss1]}]);
 assert.equal(merged.length,1);assert.equal(merged[0].sourceRefs?.length,3);
});
test('report separates membership, access unknown, candidates and per-system lookup without clinical claims',()=>{
 const second={...card,id:'doi:10.1234/b',doi:'10.1234/b',pmid:'456',sourceUrl:'https://europepmc.org/article/MED/456',kbRefs:[],identityStatus:'unmatched' as const,reviewUrl:'/papers/test/',sourceFingerprint:'c'.repeat(64),access:{freeFullText:'unknown' as const,oaStatus:'no' as const,checkedAt:card.sourceCheckedAt}};
 const report=learningReport({...data,cards:[card,second]},data);
 assert.equal(report.counts.total,2);assert.equal(report.counts.rssMatched,1);assert.equal(report.counts.ethanaiMatched,1);assert.equal(report.counts.reviewCandidates,1);assert.equal(report.counts.oaNo,1);assert.equal(report.counts.oaUnknown,1);
 assert.equal(report.actions.filter(a=>a.kind==='kb-lookup-needed').length,2);
 assert.deepEqual(report.changes.added,[second.id]);assert.deepEqual(report.changes.unchanged,[card.id]);assert.equal(report.clinicalApproval,false);
 assert.equal(JSON.stringify(report).includes('缺少此文獻'),false);
});
test('local accepted overlay appears and withdrawn whole snapshot removes it without modifying cards',()=>{
 const before=JSON.stringify(data);const accepted=parseLocalOverlay(overlay,data);
 assert.equal(accepted.notes[card.id].text,pkg.proposedValue);assert.equal(accepted.skipped,0);
 assert.deepEqual(parseLocalOverlay({...overlay,entries:[]},data).notes,{});
 assert.equal(JSON.stringify(data),before);
});
test('local overlay rejects stale or mismatched revisions and duplicate targets atomically',()=>{
 for(const mutation of [{pilotVersion:'old'}, {expectedSha256:'c'.repeat(64)}, {paperId:'doi:10.1234/other'}, {target:{...pkg.target,id:'doi:10.1234/other'}}, {review:{...pkg.review,reviewer:''}}, {unknown:'x'}, {evidence:[{url:'javascript:alert(1)',locator:'x'}]}]) {
  assert.throws(()=>parseLocalOverlay({...overlay,entries:[{...pkg,...mutation}]},data));
 }
 assert.throws(()=>parseLocalOverlay({...overlay,entries:[pkg,{...pkg,id:'562cc1b7-c3ed-5d36-96c9-28c96d642b14'}]},data),/duplicate/);
 assert.throws(()=>parseLocalOverlay({...overlay,productionWrite:true},data));
 assert.throws(()=>parseLocalOverlay({...overlay,entries:[{...pkg,proposedValue:'x'.repeat(4001)}]},data));
});
test('non-reading-card corrections are explicitly skipped and not shown as clinical content',()=>{
 const other={...pkg,target:{namespace:'ethanai',id:'13271',field:'source_identity'}};
 const result=parseLocalOverlay({...overlay,entries:[other]},data);
 assert.equal(result.skipped,1);assert.deepEqual(result.notes,{});
});
test('public runtime accepts validated drafts and keeps OA independent of access',()=>{
 const enhanced={...card,evidenceDraft:{sourceUrl:card.sourceUrl,sourceSha256:'d'.repeat(64),sourceCheckedAt:card.sourceCheckedAt,method:'abstract-paraphrase',reviewStatus:'needs-clinical-review',sections:['design','population','intervention','comparison','results','limitations'].map(key=>({key,text:'原始摘要未提供。',locator:'abstract'}))},access:{freeFullText:'verified',url:'https://example.org/article',oaStatus:'unknown',checkedAt:card.sourceCheckedAt}};
 assert.equal(validatePilotData({...data,cards:[enhanced]}).cards.length,1);
 assert.throws(()=>validatePilotData({...data,cards:[{...enhanced,evidenceDraft:{...enhanced.evidenceDraft,sourceUrl:'https://europepmc.org/article/MED/999'}}]}),/source/);
 assert.throws(()=>validatePilotData({...data,cards:[{...enhanced,evidenceDraft:{...enhanced.evidenceDraft,reviewStatus:'clinically-approved'}}]}));
});
