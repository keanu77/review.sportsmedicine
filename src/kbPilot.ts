import { compatibleIdentifiers, identifiersOf, normalizedTitle } from './identity';
import type { SourceRef } from './types';
import { isSourceRef } from './sourceRefs';

export const PILOT_TOPICS = {
  'prp-knee': 'PRP・膝骨關節炎',
  'acl-rts': 'ACL・重返運動',
  'frozen-shoulder': '五十肩・沾黏性肩關節囊炎',
} as const;
export type PilotTopic = keyof typeof PILOT_TOPICS;
export interface PilotField {
  key: string; label: string; text: string; status: 'title-context' | 'needs-review'; sourceUrl: string; locator: string;
}
export interface PilotCard {
  id: string; topic: PilotTopic; title: string; doi?: string; pmid?: string; year?: number;
  sourceUrl: string; sourceCheckedAt: string; reviewUrl?: string;
  kbRefs: SourceRef[];
  identityStatus: 'matched' | 'unmatched' | 'conflict'; evidenceStatus: 'metadata' | 'excerpt' | 'quarantined';
  sourceFingerprint: string; question: string; fields: PilotField[]; abstractExcerpt?: string; warnings: string[];
  evidenceDraft?: EvidenceDraft;
  evidenceMissingReason?: string;
  access?: PilotAccess;
  sourceIssues?: (SourceRef & {reason:string; evidenceUrl:string})[];
}
export const EVIDENCE_KEYS=['design','population','intervention','comparison','results','limitations'] as const;
export function validAbstractLocator(value:unknown):boolean {return typeof value==='string'&&value.length<=200&&value.split(/;\s*/).every(part=>/^abstract(?::[A-Za-z][A-Za-z _/()-]*)?$/.test(part));}
export interface EvidenceDraft {
  sourceUrl:string; sourceSha256:string; sourceCheckedAt:string;
  method:'abstract-paraphrase'; reviewStatus:'needs-clinical-review';
  sections:{key:typeof EVIDENCE_KEYS[number];text:string;locator:string}[];
}
export interface PilotAccess {
  freeFullText:'verified'|'inferred'|'unknown'; url?:string;
  oaStatus:'yes'|'no'|'unknown'; license?:string; checkedAt:string;
}
export interface PilotData {
  schemaVersion: 1; version: string; generatedAt: string; sourceUpdated: string; selectionNote: string; cards: PilotCard[];
}
export interface PilotFeedback {
  schemaVersion: 1; id: string; pilotVersion: string; paperId: string;
  target: { namespace: 'review-pilot'; id: string; field: 'reading_card' };
  expectedSha256: string; proposedValue: string; reason: string; evidence: {url: string; locator: string}[];
}
type IdentityInput = {title: string; url: string; doi?: string | null; pmid?: string | null; pmcid?: string | null};
export function matchIdentity(a: IdentityInput, b: IdentityInput): 'matched' | 'unmatched' | 'conflict' {
  const aa=identifiersOf(a), bb=identifiersOf(b);
  const shared=(['doi','pmid','pmcid'] as const).some(k=>aa[k] && aa[k]===bb[k]);
  if (!compatibleIdentifiers(aa,bb) && (shared || normalizedTitle(a.title)===normalizedTitle(b.title))) return 'conflict';
  return shared && compatibleIdentifiers(aa,bb) ? 'matched' : 'unmatched';
}
export function topicMatches(topic: PilotTopic, title: string): boolean {
  const t=title.normalize('NFKC').replace(/[‐‑–—]/g,'-');
  if (!/review|meta.analysis/i.test(t)) return false;
  if (topic==='prp-knee') return /platelet.rich plasma|\bPRP\b/i.test(t) && /knee/i.test(t) && /osteoarthritis/i.test(t);
  if (topic==='acl-rts') return /anterior cruciate|\bACL\b/i.test(t) && /return.{0,12}(sport|play|performance)/i.test(t);
  return /adhesive capsulitis|frozen shoulder/i.test(t) && !/\bhip\b|rotator cuff pathology/i.test(t);
}
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Invalid pilot: ${message}`); }
function object(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  requireValue(value && typeof value==='object' && !Array.isArray(value),'object');
  requireValue(Object.keys(value).every(k=>allowed.includes(k)),'unknown field');
}
function str(value: unknown, name: string, max=2000): asserts value is string {
  requireValue(typeof value==='string' && value.trim().length>0 && value.length<=max, name);
}
function url(value: unknown) {
  str(value,'url'); let u: URL; try {u=new URL(value);} catch {throw new Error('Invalid pilot: url');}
  requireValue(u.protocol==='https:' && !u.username && !u.password,'url');
}
function date(value: unknown) { str(value,'date',40); requireValue(Number.isFinite(Date.parse(value)),'date'); }
export function validatePilotData(value: unknown): PilotData {
  object(value,['schemaVersion','version','generatedAt','sourceUpdated','selectionNote','cards']);
  requireValue(value.schemaVersion===1,'schemaVersion'); str(value.version,'version',100); date(value.generatedAt); date(value.sourceUpdated); str(value.selectionNote,'selectionNote',4000);
  requireValue(Array.isArray(value.cards) && value.cards.length<=30,'cards');
  const ids=new Set<string>();
  for (const c of value.cards) {
    object(c,['id','topic','title','doi','pmid','year','sourceUrl','sourceCheckedAt','reviewUrl','kbRefs','identityStatus','evidenceStatus','sourceFingerprint','question','fields','abstractExcerpt','warnings','evidenceDraft','evidenceMissingReason','access','sourceIssues']);
    str(c.id,'id',300); requireValue(/^(doi:10\.\d{4,9}\/\S+|pmid:\d+)$/.test(c.id),'id'); requireValue(!ids.has(c.id),'duplicate id'); ids.add(c.id);
    requireValue(typeof c.topic==='string' && Object.prototype.hasOwnProperty.call(PILOT_TOPICS,c.topic),'topic'); str(c.title,'title');
    requireValue(topicMatches(c.topic as PilotTopic,c.title),'topic scope');
    if(c.doi!==undefined) requireValue(typeof c.doi==='string' && /^10\.\d{4,9}\/\S+$/.test(c.doi),'doi');
    if(c.pmid!==undefined) requireValue(typeof c.pmid==='string' && /^\d+$/.test(c.pmid),'pmid');
    requireValue(c.id===(c.doi ? `doi:${c.doi}` : `pmid:${c.pmid}`),'canonical id');
    if(c.year!==undefined) requireValue(Number.isInteger(c.year) && Number(c.year)>1900 && Number(c.year)<2100,'year');
    url(c.sourceUrl); date(c.sourceCheckedAt);
    if(c.reviewUrl!==undefined) {str(c.reviewUrl,'reviewUrl'); requireValue(/^\/papers\/[a-zA-Z0-9%-]+\/$/.test(c.reviewUrl),'reviewUrl');}
    requireValue(Array.isArray(c.kbRefs) && c.kbRefs.length<=10,'kbRefs');
    const refs=new Set<string>();
    for(const ref of c.kbRefs) {requireValue(isSourceRef(ref),'kbRef'); const key=`${ref.namespace}:${ref.id}`;requireValue(!refs.has(key),'duplicate kbRef');refs.add(key);}
    requireValue(['matched','unmatched','conflict'].includes(String(c.identityStatus)),'identityStatus');
    requireValue(['metadata','excerpt','quarantined'].includes(String(c.evidenceStatus)),'evidenceStatus');
    requireValue(c.identityStatus!=='conflict' || c.evidenceStatus==='quarantined','conflict quarantine');
    requireValue(typeof c.sourceFingerprint==='string' && /^[a-f0-9]{64}$/.test(c.sourceFingerprint),'fingerprint'); str(c.question,'question');
    requireValue(Array.isArray(c.fields) && c.fields.length<=8,'fields');
    const fieldKeys=new Set();
    for(const f of c.fields) { object(f,['key','label','text','status','sourceUrl','locator']); str(f.key,'field key',50); requireValue(!fieldKeys.has(f.key),'duplicate field'); fieldKeys.add(f.key); str(f.label,'label',100); str(f.text,'text'); str(f.locator,'locator',200); url(f.sourceUrl); requireValue(['title-context','needs-review'].includes(String(f.status)),'field status'); }
    if(c.abstractExcerpt!==undefined) {str(c.abstractExcerpt,'excerpt',500); requireValue(c.abstractExcerpt.trim().split(/\s+/).length<=25,'excerpt word limit'); requireValue(c.evidenceStatus==='excerpt','quarantine excerpt');}
    requireValue(Array.isArray(c.warnings) && c.warnings.length<=10,'warnings'); for(const w of c.warnings) str(w,'warning');
    requireValue(c.evidenceStatus!=='quarantined' || c.warnings.length>0,'quarantine warning');
    if(c.evidenceDraft!==undefined) {
      const d=c.evidenceDraft;object(d,['sourceUrl','sourceSha256','sourceCheckedAt','method','reviewStatus','sections']);
      url(d.sourceUrl);requireValue(d.sourceUrl===c.sourceUrl,'draft source identity');
      requireValue(typeof d.sourceSha256==='string' && /^[a-f0-9]{64}$/.test(d.sourceSha256),'draft source hash');date(d.sourceCheckedAt);
      requireValue(d.method==='abstract-paraphrase' && d.reviewStatus==='needs-clinical-review','draft review state');
      requireValue(Array.isArray(d.sections) && d.sections.length===EVIDENCE_KEYS.length,'draft sections');
      const keys=new Set();for(const s of d.sections) {object(s,['key','text','locator']);requireValue(EVIDENCE_KEYS.includes(s.key as typeof EVIDENCE_KEYS[number]) && !keys.has(s.key),'draft section key');keys.add(s.key);str(s.text,'draft text',1000);str(s.locator,'draft locator',200);requireValue(validAbstractLocator(s.locator),'draft locator');}
    }
    if(c.evidenceMissingReason!==undefined) {str(c.evidenceMissingReason,'missing abstract reason',1000);requireValue(c.evidenceDraft===undefined,'conflicting draft states');}
    if(c.access!==undefined) {
      const a=c.access;object(a,['freeFullText','url','oaStatus','license','checkedAt']);date(a.checkedAt);
      requireValue(['verified','inferred','unknown'].includes(String(a.freeFullText)),'access state');requireValue(['yes','no','unknown'].includes(String(a.oaStatus)),'OA state');
      if(a.url!==undefined) url(a.url);requireValue(a.freeFullText!=='verified' || typeof a.url==='string','verified access link');
      if(a.license!==undefined) str(a.license,'license',200);
    }
    if(c.sourceIssues!==undefined) {
      requireValue(Array.isArray(c.sourceIssues) && c.sourceIssues.length<=10,'source issues');
      for(const issue of c.sourceIssues) {object(issue,['namespace','id','reason','evidenceUrl']);requireValue(isSourceRef({namespace:issue.namespace,id:issue.id}) && refs.has(`${issue.namespace}:${issue.id}`),'issue source ref');str(issue.reason,'issue reason',2000);url(issue.evidenceUrl);}
    }
  }
  return value as unknown as PilotData;
}
export function makePilotFeedback(card: PilotCard, pilotVersion: string, reason: string, proposedValue: string): PilotFeedback {
  str(reason,'reason',1000); str(proposedValue,'proposedValue',4000); str(pilotVersion,'pilotVersion',100);
  return {schemaVersion:1,id:crypto.randomUUID(),pilotVersion,paperId:card.id,target:{namespace:'review-pilot',id:card.id,field:'reading_card'},expectedSha256:card.sourceFingerprint,proposedValue:proposedValue.trim(),reason:reason.trim(),evidence:[{url:card.sourceUrl,locator:'reading-card'}]};
}
