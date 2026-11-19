import test from 'node:test';
import assert from 'node:assert/strict';
import { topicMatches, matchIdentity, validatePilotData, makePilotFeedback, type PilotCard } from '../../src/kbPilot.ts';

test('pilot topic scope excludes other diseases and requires review type', () => {
  assert.equal(topicMatches('prp-knee', 'Platelet-rich plasma for knee osteoarthritis: a meta-analysis'), true);
  assert.equal(topicMatches('prp-knee', 'Platelet rich plasma for perianal fistula: systematic review'), false);
  assert.equal(topicMatches('frozen-shoulder', 'Injections for shoulder arthritis: a systematic review'), false);
  assert.equal(topicMatches('frozen-shoulder', 'Hydrodilatation for adhesive capsulitis: a systematic review'), true);
  assert.equal(topicMatches('frozen-shoulder', 'Adhesive Capsulitis of the Hip: A systematic review'), false);
  assert.equal(topicMatches('acl-rts', 'ACL reconstruction and return-to-sport: a scoping review'), true);
  assert.equal(topicMatches('acl-rts', 'ACL reconstruction: a randomized trial'), false);
});
test('matching rejects explicit identifier conflicts and title-only matches', () => {
  const a = { title:'Title', url:'https://doi.org/10.1234/ABC', pmid:'123' };
  assert.equal(matchIdentity(a, {...a,url:'https://doi.org/10.1234/abc'}),'matched');
  assert.equal(matchIdentity(a, {...a,pmid:'456'}),'conflict');
  assert.equal(matchIdentity(a, {...a,url:'https://doi.org/10.1234/other'}),'conflict');
  assert.equal(matchIdentity(a, {title:'Title', url:'https://example.org/article'}),'unmatched');
});
const card: PilotCard = {id:'doi:10.1234/abc',topic:'prp-knee',title:'Platelet-rich plasma for knee osteoarthritis: a review',doi:'10.1234/abc',sourceUrl:'https://doi.org/10.1234/abc',sourceCheckedAt:'2026-11-19T00:00:00Z',kbRefs:[],identityStatus:'unmatched',evidenceStatus:'metadata',sourceFingerprint:'a'.repeat(64),question:'研究問題',fields:[],warnings:[]};
test('runtime data validates source boundaries, duplicate IDs, and quarantine', () => {
  const data={schemaVersion:1,version:'pilot-v1',generatedAt:'2026-11-19T00:00:00Z',sourceUpdated:'2026-10-01',selectionNote:'sample',cards:[card]};
  assert.deepEqual(validatePilotData(data), data);
  assert.throws(()=>validatePilotData({...data,cards:[card,card]}),/duplicate/);
  assert.throws(()=>validatePilotData({...data,cards:[{...card,summary:'private'}]}),/unknown/);
  assert.throws(()=>validatePilotData({...data,cards:[{...card,sourceUrl:'javascript:alert(1)'}]}),/url/);
  assert.throws(()=>validatePilotData({...data,cards:[{...card,evidenceStatus:'quarantined',abstractExcerpt:'private'}]}),/quarantin/);
  assert.throws(()=>validatePilotData({...data,cards:[{...card,abstractExcerpt:Array(26).fill('word').join(' ')}]}),/excerpt/);
});
test('feedback is proposed and bound to the card version and fingerprint', () => {
  const p=makePilotFeedback(card,'pilot-v1','族群需重新核對','核對原文族群');
  assert.equal(p.expectedSha256,card.sourceFingerprint);
  assert.equal(p.pilotVersion,'pilot-v1');
  assert.deepEqual(p.target,{namespace:'review-pilot',id:card.id,field:'reading_card'});
  assert.equal(p.evidence[0].url,card.sourceUrl);
  assert.equal('reviewer' in p,false);
  assert.throws(()=>makePilotFeedback(card,'pilot-v1',' ','x'),/reason/);
});
