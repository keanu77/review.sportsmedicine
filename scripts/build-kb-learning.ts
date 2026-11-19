import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPilot, PILOT_ROOT, writePilot } from './build-kb-pilot.ts';
import { learningReport } from '../src/kbLearning.ts';

const [data,baseline]=await Promise.all([loadPilot(),readFile(path.join(PILOT_ROOT,'data/kb-pilot/baseline-v1.json'),'utf8').then(JSON.parse)]);
const report=learningReport(data,baseline);
const candidates={schemaVersion:1,pilotVersion:data.version,status:'proposed',clinicalApproval:false,productionWrite:false,
  note:'固定試點的書目候選，不是已收錄或已完成臨床評讀的證據。OA 狀態不決定是否收錄。',
  reviewCandidates:data.cards.filter(c=>!c.reviewUrl).map(c=>({id:c.id,topic:c.topic,title:c.title,doi:c.doi,pmid:c.pmid,sourceUrl:c.sourceUrl,sourceCheckedAt:c.sourceCheckedAt,sourceRefs:c.kbRefs,sourceFingerprint:c.sourceFingerprint})),
  kbLookups:report.actions.filter(a=>a.kind==='kb-lookup-needed'),sourceConflicts:report.actions.filter(a=>a.kind==='source-conflict')};
// All identity/evidence/report validation completes before publishing any artifact.
await writePilot(data);
await writeFile(path.join(PILOT_ROOT,'public/data/kb-learning.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(PILOT_ROOT,'public/data/kb-candidates.json'),JSON.stringify(candidates,null,2)+'\n');
console.log(JSON.stringify(report.counts));
