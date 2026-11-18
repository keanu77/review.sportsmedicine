import { compatibleIdentifiers, identifiersOf, normalizedTitle } from './identity';

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
  kbRefs: { namespace: 'ethanai'; id: string }[];
  identityStatus: 'matched' | 'unmatched' | 'conflict'; evidenceStatus: 'metadata' | 'excerpt' | 'quarantined';
  sourceFingerprint: string; question: string; fields: PilotField[]; abstractExcerpt?: string; warnings: string[];
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
    object(c,['id','topic','title','doi','pmid','year','sourceUrl','sourceCheckedAt','reviewUrl','kbRefs','identityStatus','evidenceStatus','sourceFingerprint','question','fields','abstractExcerpt','warnings']);
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
    for(const ref of c.kbRefs) {object(ref,['namespace','id']); requireValue(ref.namespace==='ethanai' && typeof ref.id==='string' && /^\d+$/.test(ref.id),'kbRef');}
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
  }
  return value as unknown as PilotData;
}
export function makePilotFeedback(card: PilotCard, pilotVersion: string, reason: string, proposedValue: string): PilotFeedback {
  str(reason,'reason',1000); str(proposedValue,'proposedValue',4000); str(pilotVersion,'pilotVersion',100);
  return {schemaVersion:1,id:crypto.randomUUID(),pilotVersion,paperId:card.id,target:{namespace:'review-pilot',id:card.id,field:'reading_card'},expectedSha256:card.sourceFingerprint,proposedValue:proposedValue.trim(),reason:reason.trim(),evidence:[{url:card.sourceUrl,locator:'reading-card'}]};
}
