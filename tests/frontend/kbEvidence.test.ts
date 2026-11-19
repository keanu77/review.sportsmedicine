import test from 'node:test';
import assert from 'node:assert/strict';
import { bindEvidence, numericTokens } from '../../scripts/kb-pilot-evidence.ts';
const source={doi:'10.1234/a',pmid:'123',title:'A review',sourceUrl:'https://europepmc.org/article/MED/123'};
const receipt={...source,sourceSha256:'a'.repeat(64),sourceCheckedAt:'2026-11-19T00:00:00Z',hasAbstract:true,numericTokens:['10','1000','95','0.05']};
const draft={...source,sourceSha256:receipt.sourceSha256,sourceCheckedAt:receipt.sourceCheckedAt,method:'abstract-paraphrase',reviewStatus:'needs-clinical-review',sections:['design','population','intervention','comparison','results','limitations'].map(key=>({key,text:key==='results'?'納入 10 項研究，合計 1,000 人。':'原始摘要未提供。',locator:'abstract'}))};
const access={doi:source.doi,pmid:source.pmid,freeFullText:'verified',url:'https://example.org/article',oaStatus:'no',checkedAt:receipt.sourceCheckedAt};
test('evidence binds source identity, receipt hash and supported numerical tokens',()=>{
 const result=bindEvidence(source,draft,receipt,access);
 assert.equal(result.evidenceDraft?.sections[4].text,draft.sections[4].text);assert.equal(result.access?.oaStatus,'no');assert.equal(result.access?.freeFullText,'verified');
 assert.deepEqual(numericTokens('1,000 人；95% CI；P < 0.05'),['1000','95','0.05']);
});
test('wrong source, stale hash, unsupported numbers and false clinical approval fail closed',()=>{
 for(const change of [{pmid:'456'},{doi:'10.1234/b'},{sourceUrl:'https://europepmc.org/article/MED/456'},{sourceSha256:'b'.repeat(64)},{reviewStatus:'clinically-approved'},{sections:draft.sections.map((s,i)=>i===4?{...s,text:'治癒率 99%'}:s)}]) {
  assert.throws(()=>bindEvidence(source,{...draft,...change},receipt,access));
 }
 assert.throws(()=>bindEvidence(source,draft,{...receipt,title:'Different study'},access),/identity/);
 assert.throws(()=>bindEvidence(source,draft,receipt,{...access,pmid:'456'}),/identity/);
});
test('absent abstract stays explicit and never becomes a clinical draft',()=>{
 const missing={doi:source.doi,pmid:source.pmid,sourceUrl:source.sourceUrl,sourceSha256:receipt.sourceSha256,sourceCheckedAt:receipt.sourceCheckedAt,missingReason:'原始來源未提供摘要。'};
 const result=bindEvidence(source,missing,{...receipt,hasAbstract:false,numericTokens:[]},access);
 assert.equal(result.evidenceDraft,undefined);assert.equal(result.evidenceMissingReason,missing.missingReason);
 assert.throws(()=>bindEvidence(source,missing,receipt,access));
});
test('original slash headings and multiple source sections remain traceable',()=>{
 const combined={...draft,sections:draft.sections.map((s,i)=>i===0?{...s,locator:'abstract:Purpose/hypothesis; abstract:Methods'}:s)};
 assert.equal(bindEvidence(source,combined,receipt,access).evidenceDraft?.sections[0].locator,combined.sections[0].locator);
});
