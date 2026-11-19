import { validatePilotData, type PilotData, type PilotCard } from './kbPilot';
import { isSourceRef } from './sourceRefs';

export interface LearningAction {kind:'review-candidate'|'kb-lookup-needed'|'source-conflict';paperId:string;title:string;sourceUrl:string;target:'review'|'rss-kb'|'ethanai';reason:string;}
export interface LearningBaseline { version:string; cards:Pick<PilotCard,'id'|'sourceFingerprint'>[]; }
export function learningReport(input: PilotData, baseline?: LearningBaseline) {
  const data=validatePilotData(input);
  if(baseline) {
    check(typeof baseline.version==='string'&&baseline.version.length>0&&baseline.version.length<=100&&Array.isArray(baseline.cards)&&baseline.cards.length<=30,'baseline');
    const seen=new Set();for(const card of baseline.cards){check(typeof card.id==='string'&&/^(doi:10\.\d{4,9}\/\S+|pmid:[1-9]\d*)$/.test(card.id)&&!seen.has(card.id),'baseline identity');hash(card.sourceFingerprint);seen.add(card.id);}
  }
  const actions:LearningAction[]=[];
  for(const c of data.cards) {
    const base={paperId:c.id,title:c.title,sourceUrl:c.sourceUrl};
    if(!c.reviewUrl) actions.push({...base,kind:'review-candidate',target:'review',reason:'固定樣本內的待收錄候選，需核對研究範圍與索引分類。'});
    for(const namespace of ['rss-kb','ethanai'] as const) if(!c.kbRefs.some(r=>r.namespace===namespace)) actions.push({...base,kind:'kb-lookup-needed',target:namespace,reason:'本次來源快照與搜尋未對應；需進一步查找，不代表知識庫未收錄。'});
    for(const issue of c.sourceIssues??[]) actions.push({...base,kind:'source-conflict',target:issue.namespace,reason:`${issue.namespace}:${issue.id} — ${issue.reason}`});
    if(c.identityStatus==='conflict' && !c.sourceIssues?.length) actions.push({...base,kind:'source-conflict',target:'review',reason:c.warnings.join(' ')});
  }
  const old=new Map(baseline?.cards.map(c=>[c.id,c.sourceFingerprint])??[]), current=new Set(data.cards.map(c=>c.id));
  return {schemaVersion:1 as const,pilotVersion:data.version,scope:'fixed-pilot' as const,clinicalApproval:false as const,productionWrite:false as const,
    counts:{total:data.cards.length,inReview:data.cards.filter(c=>c.reviewUrl).length,reviewCandidates:data.cards.filter(c=>!c.reviewUrl).length,
      rssMatched:data.cards.filter(c=>c.kbRefs.some(r=>r.namespace==='rss-kb')).length,ethanaiMatched:data.cards.filter(c=>c.kbRefs.some(r=>r.namespace==='ethanai')).length,
      anyKbMatched:data.cards.filter(c=>c.kbRefs.length).length,sourceConflicts:data.cards.filter(c=>c.identityStatus==='conflict').length,abstractDrafts:data.cards.filter(c=>c.evidenceDraft).length,
      oaYes:data.cards.filter(c=>c.access?.oaStatus==='yes').length,oaNo:data.cards.filter(c=>c.access?.oaStatus==='no').length,oaUnknown:data.cards.filter(c=>!c.access || c.access.oaStatus==='unknown').length},
    actions,changes:{added:data.cards.filter(c=>!old.has(c.id)).map(c=>c.id),changed:data.cards.filter(c=>old.has(c.id)&&old.get(c.id)!==c.sourceFingerprint).map(c=>c.id),unchanged:data.cards.filter(c=>old.get(c.id)===c.sourceFingerprint).map(c=>c.id),removed:[...old.keys()].filter(id=>!current.has(id))}};
}
function check(ok:unknown,message:string):asserts ok {if(!ok) throw new Error(`無法套用批註：${message}`);}
function obj(value:unknown,keys:string[]):asserts value is Record<string,unknown> {check(!!value&&typeof value==='object'&&!Array.isArray(value),'格式錯誤');check(Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k)),'unknown fields');}
function txt(value:unknown,max:number):asserts value is string {check(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),'文字格式或長度不符');}
function hash(value:unknown) {check(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'來源指紋格式錯誤');}
function safeUrl(value:unknown) {txt(value,2000);let parsed:URL;try{parsed=new URL(value);}catch{throw new Error('無法套用批註：來源網址錯誤');}check(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!/\s/.test(value),'來源網址錯誤');}
export interface LocalNote {text:string;reviewer:string;reviewedAt:string;reason:string;}
export function parseLocalOverlay(value:unknown,input:PilotData):{notes:Record<string,LocalNote>;skipped:number} {
  const data=validatePilotData(input);
  // Bound even programmatic callers; UI also checks File.size before reading.
  check(JSON.stringify(value)?.length<=1_048_576,'檔案超過 1 MiB');
  obj(value,['schemaVersion','scope','clinicalApproval','productionWrite','entries','events']);
  check(value.schemaVersion===1&&value.scope==='local-review-overlay'&&value.clinicalApproval===false&&value.productionWrite===false,'僅接受本機回饋匯出檔');
  check(Array.isArray(value.entries)&&value.entries.length<=1000&&Array.isArray(value.events)&&value.events.length<=1000,'提案清單格式錯誤');
  const notes:Record<string,LocalNote>={}, seen=new Set<string>(), ids=new Set<string>();let skipped=0;
  for(const entry of value.entries) {
    obj(entry,['schemaVersion','id','pilotVersion','paperId','target','expectedSha256','proposedValue','reason','evidence','review']);
    check(entry.schemaVersion===1,'版本錯誤');txt(entry.id,36);check(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(entry.id),'提案 ID 格式錯誤');check(!ids.has(entry.id),'duplicate proposal');ids.add(entry.id);
    txt(entry.pilotVersion,100);txt(entry.paperId,300);check(/^(doi:10\.\d{4,9}\/\S+|pmid:[1-9]\d*)$/.test(entry.paperId),'文獻 ID 格式錯誤');
    hash(entry.expectedSha256);txt(entry.proposedValue,4000);txt(entry.reason,1000);
    obj(entry.target,['namespace','id','field']);const target=entry.target;txt(target.id,300);check(['reading_card','source_identity','topic'].includes(String(target.field)),'不支援的修正欄位');
    check(target.namespace==='review-pilot'?target.id===entry.paperId:isSourceRef({namespace:target.namespace,id:target.id}),'來源 namespace 或文獻不符');
    check(target.field!=='reading_card'||target.namespace==='review-pilot','閱讀卡來源 namespace 不符');
    const key=`${target.namespace}:${target.id}:${target.field}`;check(!seen.has(key),'duplicate target');seen.add(key);
    check(Array.isArray(entry.evidence)&&entry.evidence.length>0&&entry.evidence.length<=10,'缺少來源');
    for(const evidence of entry.evidence){obj(evidence,['url','locator']);safeUrl(evidence.url);txt(evidence.locator,200);}
    obj(entry.review,['at','reviewer','reason','snapshotSha256']);txt(entry.review.at,40);check(Number.isFinite(Date.parse(entry.review.at)),'審核時間錯誤');txt(entry.review.reviewer,200);txt(entry.review.reason,1000);hash(entry.review.snapshotSha256);
    if(target.field!=='reading_card'){skipped++;continue;}
    const card=data.cards.find(c=>c.id===entry.paperId);
    check(card&&entry.pilotVersion===data.version&&entry.expectedSha256===card.sourceFingerprint,'來源版本已變更，請重新核對');
    notes[card.id]={text:entry.proposedValue,reviewer:entry.review.reviewer,reviewedAt:entry.review.at,reason:entry.review.reason};
  }
  return {notes,skipped};
}
