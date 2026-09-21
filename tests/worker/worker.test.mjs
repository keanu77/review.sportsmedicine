import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, validateRemoteURL } from '../../worker/http.mjs';
import { parseIdentifier, verifyPDF } from '../../worker/paper.mjs';
import { validateEvidence } from '../../worker/draft.mjs';
import { verifyReviewQuotes } from '../../worker/review.mjs';
import { modelEnvironment, codexRestrictedArgs, runProcess } from '../../worker/process.mjs';
import { WorkerAPI, workerConfig } from '../../worker/client.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const draft = () => ({ post: '研究有其限制。', igCaption: '研究有其限制。', notes: '研究筆記', pages: ['cover','content','outro'].map((layout,index)=>({id:`p${index}`,layout,title:'研究筆記'})), claims:[{text:'保留限定語',locator:'p:1',quote:'a causal frame-\nwork approach'}] });
test('rejects private, mapped and local addresses and unsafe URLs', () => {
  for (const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1']) assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  for(const url of ['http://example.com/a.pdf','https://localhost/a','https://example.local/a','https://u:p@example.com/a','https://example.com:9443/a','https://[::1]/a']) assert.throws(()=>validateRemoteURL(url));
});
test('parses canonical scientific identifiers and rejects arbitrary targets', () => {
  assert.deepEqual(parseIdentifier('https://doi.org/10.26603/001c.25754'),{kind:'doi',value:'10.26603/001c.25754'});
  assert.deepEqual(parseIdentifier('PMID:34386275'),{kind:'pmid',value:'34386275'});
  assert.deepEqual(parseIdentifier('https://pmc.ncbi.nlm.nih.gov/articles/PMC8329326/'),{kind:'pmcid',value:'PMC8329326'});
  assert.throws(()=>parseIdentifier('https://localhost/private.pdf'));
});
test('PDF identity cannot be established from a reference or HTML login page', () => {
  const paper={title:'Expected Article',doi:'10.1234/correct'};
  assert.throws(()=>verifyPDF(Buffer.from('<html>login</html>'),'Expected Article',paper),/不是 PDF/);
  assert.throws(()=>verifyPDF(Buffer.from('%PDF-1.7'),`Different Article ${'body '.repeat(200)}\nReferences\nExpected Article 10.1234/correct`,paper),/標題/);
  assert.throws(()=>verifyPDF(Buffer.from('%PDF-1.7'),`Expected Article ${'body '.repeat(100)}`,paper),/DOI/);
  verifyPDF(Buffer.from('%PDF-1.7'),`Expected Article doi:10.1234/correct\n${'body '.repeat(100)}`,paper);
});
test('evidence uses actual page and handles only typographic line wrapping', () => {
  validateEvidence(draft(),'The purpose is a causal framework approach.\fSecond page.');
  const wrong=draft();wrong.claims[0].locator='p:2';assert.throws(()=>validateEvidence(wrong,'The purpose is a causal framework approach.\fSecond page.'),/原文/);
  const empty=draft();empty.pages=[];assert.throws(()=>validateEvidence(empty,'a causal framework approach'));
  const result=verifyReviewQuotes({findings:[{quote:'fabricated scientific result',locator:'p:1'}]},'Real original text');
  assert.equal(result.findings[0].sourceVerified,false);
});
test('model environment excludes credentials and execution tools are disabled', () => {
  const names=['OPENAI_API_KEY','GEMINI_API_KEY','REVIEW_WORKER_TOKEN','CLOUDFLARE_API_TOKEN','ANTHROPIC_API_KEY'];
  const before=names.map(name=>process.env[name]);
  try { for(const name of names)process.env[name]='fake-for-test';const env=modelEnvironment();for(const name of names)assert.equal(env[name],undefined);assert.equal(env.HOME,process.env.HOME); }
  finally{names.forEach((name,index)=>before[index]===undefined?delete process.env[name]:process.env[name]=before[index]);}
  assert.ok(codexRestrictedArgs().includes('shell_tool'));assert.ok(codexRestrictedArgs().includes('image_generation'));assert.ok(!codexRestrictedArgs({images:true}).includes('image_generation'));
});
test('subprocess cancellation rejects instead of silently succeeding', async () => {
  const controller=new AbortController();
  const running=runProcess(process.execPath,['-e','setTimeout(()=>{},20000)'],{signal:controller.signal});
  setTimeout(()=>controller.abort(new Error('test cancellation')),60);
  await assert.rejects(running,/test cancellation/);
});
test('API origin disallows insecure remote origin and validates upload hashes',async()=>{
  assert.throws(()=>workerConfig({REVIEW_API_URL:'http://example.com',REVIEW_WORKER_TOKEN:'x'.repeat(32)}));
  const directory=await mkdtemp(path.join(os.tmpdir(),'review-upload-'));
  try{
    const file=path.join(directory,'notes.md');await writeFile(file,'verified bytes');
    let request;
    const api=new WorkerAPI({origin:'https://review.example',token:'private'},async(url,options)=>{request={url,options};return Response.json({artifact:{id:'file',size:14,sha256:createHash('sha256').update('verified bytes').digest('hex')}})});
    assert.equal(await api.upload({id:'job'},'lease',{path:file,name:'notes.md',contentType:'text/markdown'}),'file');
    assert.equal(request.options.redirect,'error');assert.equal(request.options.headers['X-Lease-Token'],'lease');
    api.fetcher=async()=>Response.json({artifact:{size:0,sha256:'wrong'}});await assert.rejects(api.upload({id:'job'},'lease',{path:file,name:'notes.md',contentType:'text/markdown'}),/校驗/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('review model cannot supply provenance or use whitespace as verified evidence',async()=>{
  const {parseResult}=await import('../../worker/review.mjs');
  const parsed=parseResult(JSON.stringify({summary:'review',findings:[],provider:'forged',status:'ran',sourceHash:'forged'}));
  assert.deepEqual(Object.keys(parsed).sort(),['findings','summary']);
  assert.equal(verifyReviewQuotes({findings:[{quote:' '.repeat(20),locator:'p:1'}]},'Actual source').findings[0].sourceVerified,false);
});

test('invalid redirect rejects without uncaught exceptions', async t=>{
  const {default:dns}=await import('node:dns/promises');
  const {default:https}=await import('node:https');
  const {EventEmitter}=await import('node:events');
  const {remoteBytes}=await import('../../worker/http.mjs');
  t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);
  t.mock.method(https,'get',(_url,_options,callback)=>{
    const request=new EventEmitter();request.destroy=()=>request.emit('close');
    process.nextTick(()=>{callback({statusCode:302,headers:{location:'http://['},resume(){}});request.emit('close');});
    return request;
  });
  await assert.rejects(remoteBytes('https://example.com'),/Invalid URL/);
});

test('only transient transfers retry, at most three times; cancellation stops retries', async()=>{
  const {retryTransfer}=await import('../../worker/retry.mjs');
  const pauses=[];let calls=0;
  assert.equal(await retryTransfer(async()=>{if(++calls<3)throw Object.assign(new Error('busy'),{status:503});return 'ok';},{wait:async ms=>pauses.push(ms)}),'ok');
  assert.deepEqual(pauses,[500,1000]);
  calls=0;await assert.rejects(retryTransfer(async()=>{calls++;throw Object.assign(new Error('bad paper'),{status:404});},{wait:async()=>{}}),/bad paper/);assert.equal(calls,1);
  calls=0;await assert.rejects(retryTransfer(async()=>{calls++;throw Object.assign(new Error('offline'),{code:'ECONNRESET'});},{wait:async()=>{}}),/offline/);assert.equal(calls,3);
  const controller=new AbortController();calls=0;
  await assert.rejects(retryTransfer(async()=>{calls++;controller.abort(new Error('cancelled'));throw Object.assign(new Error('offline'),{code:'ECONNRESET'});},{signal:controller.signal,wait:async()=>{throw new Error('should not wait');}}),/offline/);assert.equal(calls,1);
});
