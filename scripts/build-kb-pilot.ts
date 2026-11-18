import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { enrichItems } from '../src/enrich.ts';
import { uniquePapers } from '../src/identity.ts';
import { paperPath } from '../src/paperRoutes.ts';
import { matchIdentity, topicMatches, validatePilotData, type PilotCard, type PilotData, type PilotTopic } from '../src/kbPilot.ts';
import type { Item } from '../src/types.ts';

export interface PilotSource {
  topic: PilotTopic; title: string; doi?: string; pmid: string; year?: number;
  sourceUrl: string; sourceCheckedAt: string; abstractExcerpt?: string | null;
}
interface KbSource { id: string; title: string; url: string; doi?: string; pmid?: string; }
interface Mismatch {
  namespace: 'ethanai'; id: string; expectedDoi: string; observedDoi: string;
  summarySha256: string; observedAt: string; evidenceUrl: string;
}
type Meta = Omit<PilotData,'schemaVersion'|'cards'>;
const TOPIC_CONTEXT = {
  'prp-knee': {population:'膝骨關節炎；年齡、疾病嚴重度與排除條件待核對。',intervention:'PRP；製備方式、濃度、注射次數及合併治療待核對。',question:'這篇回顧研究哪一群膝骨關節炎患者？PRP 製備與對照是否可比較？'},
  'acl-rts': {population:'ACL 損傷／重建相關族群；運動層級、性別與年齡待核對。',intervention:'重返運動相關處置或評估；實際復健、手術及測試條件待核對。',question:'重返運動、重返原有層級與重返表現是否被分開定義？'},
  'frozen-shoulder': {population:'五十肩／沾黏性肩關節囊炎；原發或續發、病程階段與共病待核對。',intervention:'題名所述治療或評估策略；具體方法與劑量待核對。',question:'研究納入哪個五十肩階段？對照治療及追蹤時間是否符合要回答的問題？'},
} as const;

/** Fixed inputs only. No network, models, database writes, or copied KB summaries. */
export function buildPilot(meta: Meta, sources: PilotSource[], kb: KbSource[], catalog: Item[], mismatches: Mismatch[]): PilotData {
  if(sources.length!==30) throw new Error('Pilot requires exactly 30 sources');
  const cards: PilotCard[]=sources.map(s=>{
    if(!topicMatches(s.topic,s.title)) throw new Error('Invalid topic scope');
    if(s.sourceUrl!==`https://europepmc.org/article/MED/${s.pmid}` || !/^\d+$/.test(s.pmid)) throw new Error('Invalid source identity');
    const reference={title:s.title,url:s.sourceUrl,doi:s.doi,pmid:s.pmid};
    const matchedKb=kb.filter(k=>matchIdentity(reference,k)==='matched');
    const review=catalog.find(k=>matchIdentity(reference,k)==='matched');
    const idConflict=[...kb,...catalog].some(k=>matchIdentity(reference,k)==='conflict');
    const mismatched=matchedKb.flatMap(k=>mismatches.filter(m=>m.namespace==='ethanai' && m.id===k.id && m.expectedDoi===s.doi));
    const warnings: string[]=[];
    if(idConflict) warnings.push('相同識別或題名對應到互相衝突的書目，已隔離，請核對原始文獻。');
    for(const m of mismatched) warnings.push(`知識庫 Ethanai ${m.id} 的全文屬於另一篇文獻（DOI ${m.observedDoi}；查核 ${m.observedAt.slice(0,10)}）。已隔離該來源，未採用其全文或臨床結論。`);
    const quarantine=idConflict || mismatched.length>0;
    const context=TOPIC_CONTEXT[s.topic];
    const fields: PilotCard['fields']=[
      {key:'population',label:'研究族群與範圍',text:context.population,status:'title-context',sourceUrl:s.sourceUrl,locator:'title'},
      {key:'intervention',label:'介入或評估',text:context.intervention,status:'title-context',sourceUrl:s.sourceUrl,locator:'title'},
      {key:'comparison',label:'對照與追蹤時間',text:'待逐篇核對原始方法；不從其他研究補入。',status:'needs-review',sourceUrl:s.sourceUrl,locator:'methods — not yet reviewed'},
      {key:'outcomes',label:'效果量與結果',text:'尚未完成數據與原文位置核對，暫不提供療效結論。',status:'needs-review',sourceUrl:s.sourceUrl,locator:'results — not yet reviewed'},
      {key:'limitations',label:'偏差風險與臨床適用性',text:'尚待人工評讀；期刊、文體及題名不代表證據品質。',status:'needs-review',sourceUrl:s.sourceUrl,locator:'limitations — not yet reviewed'},
    ];
    const card: PilotCard={id:s.doi ? `doi:${s.doi}` : `pmid:${s.pmid}`,topic:s.topic,title:s.title,
      ...(s.doi?{doi:s.doi}:{}),pmid:s.pmid,...(s.year?{year:s.year}:{}),sourceUrl:s.sourceUrl,sourceCheckedAt:s.sourceCheckedAt,
      ...(review&&!idConflict?{reviewUrl:paperPath(review)}:{}),
      kbRefs:[...new Set(matchedKb.map(k=>k.id))].sort().map(id=>({namespace:'ethanai' as const,id})),
      identityStatus:quarantine?'conflict':matchedKb.length?'matched':'unmatched',evidenceStatus:quarantine?'quarantined':s.abstractExcerpt?'excerpt':'metadata',
      sourceFingerprint:'',question:context.question,fields,...(!quarantine&&s.abstractExcerpt?{abstractExcerpt:s.abstractExcerpt}:{}),warnings};
    // Includes field state and membership, so source or card updates invalidate old feedback.
    card.sourceFingerprint=createHash('sha256').update(JSON.stringify({...card,sourceFingerprint:undefined})).digest('hex');
    return card;
  });
  const data=validatePilotData({schemaVersion:1,...meta,cards});
  for(const topic of Object.keys(TOPIC_CONTEXT)) if(cards.filter(c=>c.topic===topic).length!==10) throw new Error(`Expected 10 papers: ${topic}`);
  return data;
}
export function feedbackSnapshot(data: PilotData) {
  return {schemaVersion:1,pilotVersion:data.version,targets:data.cards.map(c=>({namespace:'review-pilot',id:c.id,field:'reading_card',sha256:c.sourceFingerprint}))};
}
async function main() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const read=async(p:string)=>JSON.parse(await readFile(path.join(root,p),'utf8'));
  const [meta,sources,kb,mismatches,index,bibliography]=await Promise.all(['data/kb-pilot/manifest.json','data/kb-pilot/sources.json','data/kb-pilot/kb-metadata.json','data/kb-pilot/source-conflicts.json','public/data/reviews-index.json','public/data/bibliography.json'].map(read));
  // Use actual current catalog membership; supplied source reviewUrl is not authoritative.
  const catalog=uniquePapers(enrichItems(index.items,{},{},bibliography.records));
  const data=buildPilot(meta,sources,kb,catalog,mismatches);
  await mkdir(path.join(root,'public/data'),{recursive:true});
  await writeFile(path.join(root,'public/data/kb-pilot.json'),JSON.stringify(data,null,2)+'\n');
  await writeFile(path.join(root,'data/kb-pilot/feedback-snapshot.json'),JSON.stringify(feedbackSnapshot(data),null,2)+'\n');
  const counts={total:data.cards.length,inReview:data.cards.filter(c=>c.reviewUrl).length,kbMatched:data.cards.filter(c=>c.kbRefs.length).length,quarantined:data.cards.filter(c=>c.evidenceStatus==='quarantined').length};
  console.log(JSON.stringify(counts));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
