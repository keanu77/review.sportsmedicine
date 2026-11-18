import { normalizedTitle } from '../src/identity.ts';
import { EVIDENCE_KEYS, validAbstractLocator, type PilotCard, type EvidenceDraft, type PilotAccess } from '../src/kbPilot.ts';
type SourceIdentity={doi?:string;pmid:string;title:string;sourceUrl:string};
export interface EvidenceBundle {drafts:unknown[];receipts:unknown[];access:unknown[];}
const requireValue=(ok:unknown,message:string)=>{if(!ok)throw new Error(`Evidence rejected: ${message}`);};
function record(value:unknown):Record<string,unknown> {requireValue(!!value&&typeof value==='object'&&!Array.isArray(value),'object');return value as Record<string,unknown>;}
const text=(value:unknown,max=2000)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const date=(value:unknown)=>text(value,40)&&Number.isFinite(Date.parse(String(value)));
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function https(value:unknown) {try {const u=new URL(String(value));return text(value)&&u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
export function numericTokens(value:string):string[] {return [...new Set(value.replace(/(?<=\d),(?=\d)/g,'').match(/\d+(?:\.\d+)?/g)??[])];}
export function evidenceFor(source:SourceIdentity,bundle:EvidenceBundle) {
  const select=(rows:unknown[])=>{const matches=rows.filter(r=>record(r).pmid===source.pmid);requireValue(matches.length===1,`exactly one source identity required: ${source.pmid}`);return matches[0];};
  return bindEvidence(source,select(bundle.drafts),select(bundle.receipts),select(bundle.access));
}
export function bindEvidence(source:SourceIdentity,draftInput:unknown,receiptInput:unknown,accessInput:unknown):Pick<PilotCard,'evidenceDraft'|'evidenceMissingReason'|'access'> {
  const draft=record(draftInput), receipt=record(receiptInput), access=record(accessInput);
  for(const r of [draft,receipt,access]) requireValue(r.pmid===source.pmid && (r.doi??undefined)===source.doi,'source identity mismatch');
  for(const r of [draft,receipt]) requireValue(r.sourceUrl===source.sourceUrl && sha(r.sourceSha256)&&date(r.sourceCheckedAt),'source binding');
  requireValue(normalizedTitle(String(receipt.title))===normalizedTitle(source.title),'receipt title identity mismatch');
  requireValue(draft.sourceSha256===receipt.sourceSha256&&draft.sourceCheckedAt===receipt.sourceCheckedAt,'source fingerprint mismatch');
  requireValue(Array.isArray(receipt.numericTokens)&&receipt.numericTokens.length<=1000&&receipt.numericTokens.every(t=>typeof t==='string'&&/^\d+(?:\.\d+)?$/.test(t)),'numeric token receipt');
  requireValue(typeof receipt.hasAbstract==='boolean','abstract receipt');
  requireValue(['verified','inferred','unknown'].includes(String(access.freeFullText))&&['yes','no','unknown'].includes(String(access.oaStatus))&&date(access.checkedAt),'access status');
  requireValue(access.url===undefined||https(access.url),'access URL');requireValue(access.freeFullText!=='verified'||https(access.url),'verified access requires source-listed link');
  requireValue(access.license===undefined||text(access.license,200),'license');
  const result:Pick<PilotCard,'evidenceDraft'|'evidenceMissingReason'|'access'>={access:{freeFullText:access.freeFullText as PilotAccess['freeFullText'],oaStatus:access.oaStatus as PilotAccess['oaStatus'],checkedAt:access.checkedAt as string,...(access.url?{url:access.url as string}:{}),...(access.license?{license:access.license as string}:{})}};
  if(!receipt.hasAbstract) {
    requireValue(text(draft.missingReason,1000)&&draft.sections===undefined,'absent abstract requires missing reason');
    result.evidenceMissingReason=draft.missingReason as string;return result;
  }
  requireValue(draft.missingReason===undefined&&draft.method==='abstract-paraphrase'&&draft.reviewStatus==='needs-clinical-review','draft state');
  requireValue(Array.isArray(draft.sections)&&draft.sections.length===6,'six evidence sections required');
  const keys=new Set<string>(), allowed=new Set(receipt.numericTokens as string[]);
  const sections=(draft.sections as unknown[]).map(raw=>{
    const s=record(raw);requireValue(EVIDENCE_KEYS.includes(s.key as typeof EVIDENCE_KEYS[number])&&!keys.has(String(s.key)),'section key');keys.add(String(s.key));
    requireValue(text(s.text,1000)&&validAbstractLocator(s.locator),'section content or location');
    for(const token of numericTokens(s.text as string)) requireValue(allowed.has(token),`unsupported numerical token ${token} in PMID ${source.pmid}`);
    return {key:s.key as typeof EVIDENCE_KEYS[number],text:s.text as string,locator:s.locator as string};
  });
  result.evidenceDraft={sourceUrl:source.sourceUrl,sourceSha256:draft.sourceSha256 as string,sourceCheckedAt:draft.sourceCheckedAt as string,method:'abstract-paraphrase',reviewStatus:'needs-clinical-review',sections} satisfies EvidenceDraft;
  return result;
}
