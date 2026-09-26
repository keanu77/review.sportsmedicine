import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import { fixture, fixtureDraft } from './helpers.mjs';
import { normalizeInput, validateDraft } from '../../shared/validation.mjs';

test('identifiers accept only canonical identifier forms', () => {
  assert.equal(normalizeInput('https://doi.org/10.1234/ABC'), '10.1234/abc');
  assert.equal(normalizeInput('12345'), 'PMID:12345');
  assert.equal(normalizeInput('https://pubmed.ncbi.nlm.nih.gov/12345/'), 'PMID:12345');
  assert.equal(normalizeInput('https://pmc.ncbi.nlm.nih.gov/articles/PMC12345/'), 'PMC12345');
  for (const value of ['https://evil.test/10.1234/a', 'https://doi.org@evil.test/10.1234/a', 'http://doi.org/10.1234/a', 'https://doi.org/10.1234/a?x=y', 'file:///tmp/source', 'https://pubmed.ncbi.nlm.nih.gov:443/123/?foo=bar']) assert.throws(() => normalizeInput(value));
  assert.throws(() => validateDraft({ ...fixtureDraft, claims: [{ text: 'Fact', locator: '', quote: '' }] }));
});

test('owner authentication validates signatures, issuer, audience, email and expiry; no worker role escalation', async (t) => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.call('/session')).status, 200);
  assert.equal((await f.call('/session', { role: 'anonymous' })).status, 401);
  assert.equal((await f.call('/session', { headers: { 'Cf-Access-Jwt-Assertion': 'garbage', 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } })).status, 401);
  const wrongOwner = await f.token({ email: 'other@example.com' });
  assert.equal((await f.call('/session', { headers: { 'Cf-Access-Jwt-Assertion': wrongOwner } })).status, 403);
  const otherKeys = await generateKeyPair('RS256');
  const forged = await f.token({}, otherKeys.privateKey);
  assert.equal((await f.call('/session', { headers: { 'Cf-Access-Jwt-Assertion': forged } })).status, 401);
  for (const [issuer, audience, expiration] of [['https://evil.test', 'test-audience', '1h'], ['https://test.cloudflareaccess.com', 'wrong', '1h'], ['https://test.cloudflareaccess.com', 'test-audience', '-1h']]) {
    const jwt = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'RS256' }).setIssuedAt().setIssuer(issuer).setAudience(audience).setExpirationTime(expiration).sign(f.keys.privateKey);
    assert.equal((await f.call('/session', { headers: { 'Cf-Access-Jwt-Assertion': jwt } })).status, 401);
  }
  assert.equal((await f.call('/session', { role: 'anonymous', headers: { Authorization: `Bearer ${f.env.WORKER_TOKEN}` } })).status, 401);
  assert.equal((await f.call('/session', { overrideEnv: { ...f.env, OWNER_EMAIL: '' } })).status, 503);
  const response = await f.call('/session', { role: 'anonymous' });
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('owner mutations reject missing, null and cross-origin Origin headers', async (t) => {
  const f = await fixture(); t.after(f.close);
  for (const origin of ['', 'null', 'https://evil.example.com']) {
    const response = await f.call('/jobs', { method: 'POST', data: { input: '12345' }, headers: { Origin: origin } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'CSRF_REJECTED');
  }
  assert.equal((await f.create()).status, 'queued');
});

test('atomic claim yields one active job across competing workers', async (t) => {
  const f = await fixture(); t.after(f.close);
  await f.create(); await f.create();
  const claims = await Promise.all(Array.from({ length: 8 }, () => f.claim()));
  assert.equal(claims.filter((value) => value.job).length, 1);
  assert.equal(claims.filter((value) => value.job === null).length, 7);
  assert.equal(claims.find((value) => value.job).job.status, 'running');
});

test('lease expiry fails explicitly and cannot heartbeat or complete, then explicit retry creates a new lease', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const attempt = await f.claim(); await f.upload(job.id, attempt.leaseToken);
  f.advance(120001);
  assert.equal((await f.complete(job.id, attempt.leaseToken)).status, 409);
  assert.equal((await f.call(`/jobs/${job.id}/heartbeat`, { role: 'worker', method: 'POST', data: { leaseToken: attempt.leaseToken, stage: 'late' } })).status, 409);
  assert.equal((await f.claim()).job, null);
  const expired = (await (await f.call(`/jobs/${job.id}`)).json()).job;
  assert.equal(expired.status, 'failed'); assert.equal(expired.error.code, 'LEASE_EXPIRED');
  assert.equal((await f.call(`/jobs/${job.id}/retry`, { method: 'POST' })).status, 200);
  const next = await f.claim(); assert.notEqual(next.leaseToken, attempt.leaseToken);
  assert.equal((await f.complete(job.id, next.leaseToken)).status, 400, 'old attempt artifact cannot be committed');
});

test('heartbeat extends a live lease, but cancellation invalidates heartbeat/upload/complete/fail', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  f.advance(90000);
  assert.equal((await f.call(`/jobs/${job.id}/heartbeat`, { role: 'worker', method: 'POST', data: { leaseToken, stage: 'drafting' } })).status, 200);
  f.advance(90000);
  assert.equal((await f.upload(job.id, leaseToken)).status, 201);
  assert.equal((await f.call(`/jobs/${job.id}/cancel`, { method: 'POST' })).status, 200);
  assert.equal((await f.complete(job.id, leaseToken)).status, 409);
  assert.equal((await f.upload(job.id, leaseToken, 'late')).status, 409);
  assert.equal((await f.call(`/jobs/${job.id}/fail`, { role: 'worker', method: 'POST', data: { leaseToken, code: 'MODEL_ERROR', message: 'Failed' } })).status, 409);
});

test('classified full-text failure codes and next-step messages round-trip to the owner', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  const message = '公開來源拒絕自動下載。已嘗試 2 個來源：onlinelibrary.wiley.com（HTTP 403）、europepmc.org（HTTP 404）。';
  assert.equal((await f.call(`/jobs/${job.id}/fail`, { role: 'worker', method: 'POST', data: { leaseToken, code: 'FULLTEXT_ACCESS_DENIED', message } })).status, 200);
  const failed = (await (await f.call(`/jobs/${job.id}`)).json()).job;
  assert.deepEqual(failed.error, { code: 'FULLTEXT_ACCESS_DENIED', message, recoverable: true });
});

test('draft CAS rejects stale revisions and an active render cannot change the snapshot', async (t) => {
  const f = await fixture(); t.after(f.close);
  const rereview = async current => {
    await f.call(`/jobs/${current.id}/review`, { method: 'POST', data: { revision: current.revision } });
    const claimed = await f.claim({ reviewDraft: true }), fileId = `review-${current.revision}`;
    await f.upload(current.id, claimed.leaseToken, fileId);
    const response = await f.complete(current.id, claimed.leaseToken, [fileId], null);
    assert.equal(response.status, 200);
    return (await response.json()).job;
  };
  const job = await f.create(); const { leaseToken } = await f.claim(); await f.upload(job.id, leaseToken);
  const reviewed = (await (await f.complete(job.id, leaseToken)).json()).job;
  const results = await Promise.all([1, 2].map((index) => f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: reviewed.revision, draft: { ...fixtureDraft, post: `revision ${index}` } } })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const edited = (await (await f.call(`/jobs/${job.id}`)).json()).job;
  await f.approve(job.id);
  assert.equal((await f.call(`/jobs/${job.id}/render`, { method: 'POST', data: { revision: reviewed.revision, design: {} } })).status, 409);
  await f.approve(job.id);
  const currentReview = await rereview(edited);
  const renderResponse = await f.call(`/jobs/${job.id}/render`, { method: 'POST', data: { revision: currentReview.revision, design: { format: 'square' } } });
  assert.equal(renderResponse.status, 200);
  const render = (await renderResponse.json()).job;
  assert.equal((await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: render.revision, draft: fixtureDraft } })).status, 409);
  const second = await f.claim(); await f.upload(job.id, second.leaseToken, 'rendered');
  assert.equal((await f.complete(job.id, second.leaseToken, ['rendered'])).status, 400, 'render cannot overwrite approved draft');
  const finished = await f.complete(job.id, second.leaseToken, ['rendered'], null);
  assert.equal(finished.status, 200);
  const result = (await finished.json()).job;
  assert.equal(result.status, 'completed'); assert.equal(result.draft.post, edited.draft.post);
  assert.equal(result.artifacts.length, 3, 'research and review artifacts survive rendering');
  const updated = await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: result.revision, draft: fixtureDraft } });
  const updatedJob = (await updated.json()).job;
  assert.equal(updatedJob.status, 'needs_review');
  await f.approve(job.id);
  const updatedReview = await rereview(updatedJob);
  await f.call(`/jobs/${job.id}/render`, { method: 'POST', data: { revision: updatedReview.revision, design: {} } });
  const third = await f.claim(); await f.upload(job.id, third.leaseToken, 'rerendered');
  const rerendered = (await (await f.complete(job.id, third.leaseToken, ['rerendered'], null)).json()).job;
  assert.deepEqual(rerendered.artifacts.map((file) => file.id).sort(), ['rerendered', `review-${edited.revision}`, `review-${updatedJob.revision}`, 'source'].sort());
  assert.equal((await f.call(`/jobs/${job.id}/files/rendered`)).status, 404, 'superseded render downloads are no longer visible');
});

test('artifacts remain private, cannot cross job boundaries, preserve hashes and hide storage keys', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  const uploaded = await f.upload(job.id, leaseToken);
  assert.equal(uploaded.status, 201);
  const artifact = (await uploaded.json()).artifact;
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/); assert.equal(artifact.key, undefined);
  assert.equal((await f.call(`/jobs/${job.id}/files/source`)).status, 404, 'uncommitted files are hidden');
  assert.equal((await f.complete(job.id, leaseToken, ['source', 'unknown'])).status, 400);
  assert.equal((await f.complete(job.id, leaseToken)).status, 200);
  const download = await f.call(`/jobs/${job.id}/files/source`);
  assert.equal(download.status, 200); assert.equal(download.headers.get('X-Content-SHA256'), artifact.sha256);
  assert.equal(await download.text(), 'Exercise was assessed.');
  assert.equal((await f.call(`/jobs/${job.id}/files/source`, { role: 'anonymous' })).status, 401);
  const other = await f.create();
  assert.equal((await f.call(`/jobs/${other.id}/files/source`)).status, 404);
  const serialized = await (await f.call(`/jobs/${job.id}`)).text();
  assert.ok(!serialized.includes('object_key')); assert.ok(!serialized.includes('lease_hash')); assert.ok(!serialized.includes('attempt_id'));
});

test('upload validates file names, media signatures, hash and size before storing bytes', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  for (const [name, contentType, raw, extra, status] of [
    ['../secret.txt', 'text/plain', 'content', {}, 400],
    ['source.pdf', 'application/pdf', '<html>Not a PDF</html>', {}, 400],
    ['bad.png', 'image/png', 'fake image', {}, 400],
    ['source.txt', 'text/plain', 'content', { 'X-Content-SHA256': '00' }, 400],
    ['source.txt', 'text/plain', 'content', { 'Content-Length': '999999999' }, 413],
    ['source.svg', 'image/svg+xml', '<svg/>', {}, 415],
    ['reel.mp4', 'video/mp4', 'not a video file', {}, 400],
    ['reel.mov', 'video/mp4', new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0]), {}, 400],
  ]) {
    const response = await f.call(`/jobs/${job.id}/files/test`, { method: 'PUT', role: 'worker', raw, headers: { 'X-Lease-Token': leaseToken, 'X-File-Name': encodeURIComponent(name), 'Content-Type': contentType, ...extra } });
    assert.equal(response.status, status, name);
  }
  assert.equal(f.objects.size, 0);
  const reel = await f.call(`/jobs/${job.id}/files/reel`, { method: 'PUT', role: 'worker', raw: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0]), headers: { 'X-Lease-Token': leaseToken, 'X-File-Name': 'reel.mp4', 'Content-Type': 'video/mp4' } });
  assert.equal(reel.status, 201, 'an MP4 reel with an ftyp box is accepted');
  assert.equal((await f.upload(job.id, leaseToken)).status, 201);
  assert.equal((await f.upload(job.id, leaseToken)).status, 200, 'identical retransmission returns the existing artifact');
  assert.equal(f.objects.size, 2, 'an identical retransmission does not create an additional R2 object');
});

test('bad worker credentials and owner JWT cannot authenticate worker routes', async (t) => {
  const f = await fixture(); t.after(f.close);
  const response = await f.call('/claim', { method: 'POST', role: 'worker', data: { workerId: 'test', capabilities: {} }, headers: { Authorization: 'Bearer invalid', 'Cf-Access-Jwt-Assertion': await f.token() } });
  assert.equal(response.status, 401);
  assert.equal((await f.call('/claim', { method: 'POST', role: 'worker', data: {}, overrideEnv: { ...f.env, WORKER_TOKEN: '' } })).status, 503);
});

test('cancellation during R2 upload prevents registration and deletes the unregistered object', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  const originalPut = f.env.ARTIFACTS.put;
  f.env.ARTIFACTS.put = async (...args) => {
    await originalPut(...args);
    await f.call(`/jobs/${job.id}/cancel`, { method: 'POST' });
  };
  assert.equal((await f.upload(job.id, leaseToken)).status, 409);
  assert.equal(f.objects.size, 0);
  assert.equal((await f.call(`/jobs/${job.id}/files/source`)).status, 404);
});

test('attempt file quotas are enforced by the conditional database write', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  const row = await f.env.DB.prepare('SELECT attempt_id FROM jobs WHERE id=?').bind(job.id).first();
  for (let index = 0; index < 32; index++) {
    await f.env.DB.prepare("INSERT INTO artifacts (job_id,id,attempt_id,phase,name,content_type,size,sha256,object_key,created_at) VALUES (?,?,?,'research','small.txt','text/plain',1,'fake',?,?)").bind(job.id, `seed-${index}`, row.attempt_id, `seed-key-${index}`, Date.now()).run();
  }
  assert.equal((await f.upload(job.id, leaseToken)).status, 409);
  assert.equal(f.objects.size, 0);
});

test('photo and illustration render jobs require an explicitly available image capability', async (t) => {
  for (const imageStyle of ['photo', 'illustration']) {
    const f = await fixture(); t.after(f.close);
    const created = await f.create();
    const research = await f.claim({});
    assert.equal(research.job.id, created.id, 'research may run before the image tool is available');
    await f.upload(created.id, research.leaseToken);
    const reviewed = (await (await f.complete(created.id, research.leaseToken)).json()).job;
    await f.approve(created.id);
    const queued = (await (await f.call(`/jobs/${created.id}/render`, { method: 'POST', data: { revision: reviewed.revision, design: { imageStyle } } })).json()).job;
    for (const capabilities of [{}, [], { imageGeneration: false }, { imageGeneration: true }, { imageGeneration: { available: false } }, { imageGeneration: { available: 'true' } }]) {
      assert.equal((await f.claim(capabilities)).job, null, `${imageStyle}: missing or unverified capability cannot claim`);
    }
    const unchanged = (await (await f.call(`/jobs/${created.id}`)).json()).job;
    assert.equal(unchanged.status, 'queued');
    assert.equal(unchanged.revision, queued.revision);
    assert.equal(unchanged.design.imageStyle, imageStyle, 'the requested design is never downgraded');
    const capable = await f.claim({ imageGeneration: { available: true } });
    assert.equal(capable.job.id, created.id);
    assert.equal(capable.job.status, 'running');
    assert.equal(capable.job.design.imageStyle, imageStyle);
  }
});

test('an image-dependent queue head does not block eligible research and text-only rendering', async (t) => {
  const f = await fixture(); t.after(f.close);
  const first = await f.create(); const research = await f.claim({});
  await f.upload(first.id, research.leaseToken);
  const reviewed = (await (await f.complete(first.id, research.leaseToken)).json()).job;
  await f.approve(first.id);
  await f.call(`/jobs/${first.id}/render`, { method: 'POST', data: { revision: reviewed.revision, design: { imageStyle: 'photo' } } });
  f.advance(1000);
  const second = await f.create();
  const eligible = await f.claim({ imageGeneration: { available: false } });
  assert.equal(eligible.job.id, second.id);
  await f.upload(second.id, eligible.leaseToken);
  const secondReviewed = (await (await f.complete(second.id, eligible.leaseToken)).json()).job;
  await f.approve(second.id);
  await f.call(`/jobs/${second.id}/render`, { method: 'POST', data: { revision: secondReviewed.revision, design: { imageStyle: 'none' } } });
  const textOnly = await f.claim({});
  assert.equal(textOnly.job.id, second.id);
  assert.equal(textOnly.job.design.imageStyle, 'none');
  assert.equal((await f.claim({ imageGeneration: { available: true } })).job, null, 'global concurrency remains one');
  assert.equal((await (await f.call(`/jobs/${first.id}`)).json()).job.status, 'queued');
});

test('editing requires re-review and render completion cannot replace that review evidence', async (t) => {
  const f = await fixture(); t.after(f.close);
  const created = await f.create(); const research = await f.claim();
  await f.upload(created.id, research.leaseToken);
  const reviews = [{ provider: 'codex', status: 'ran', summary: 'Checked the initial draft', findings: [] }];
  const researchResponse = await f.call(`/jobs/${created.id}/complete`, { role: 'worker', method: 'POST', data: {
    leaseToken: research.leaseToken, artifacts: ['source'], draft: fixtureDraft, metadata: { reviews, reviewsStale: true },
  } });
  assert.equal(researchResponse.status, 200);
  const reviewed = (await researchResponse.json()).job;
  assert.equal(reviewed.metadata.reviewsStale, false, 'new research reviews apply to the returned draft');
  const editedResponse = await f.call(`/jobs/${created.id}/draft`, { method: 'PATCH', data: {
    revision: reviewed.revision, draft: { ...fixtureDraft, post: 'Owner changed the conclusion after the review' },
  } });
  assert.equal(editedResponse.status, 200);
  const edited = (await editedResponse.json()).job;
  assert.equal(edited.metadata.reviewsStale, true);
  assert.deepEqual(edited.metadata.reviews, reviews, 'old reviews remain readable with their stale label');
  await f.approve(created.id);
  assert.equal((await f.call(`/jobs/${created.id}/render`, { method: 'POST', data: { revision: edited.revision, design: { imageStyle: 'none' } } })).status, 409);
  await f.call(`/jobs/${created.id}/review`, { method: 'POST', data: { revision: edited.revision } });
  const checking = await f.claim({ reviewDraft: true });
  await f.upload(created.id, checking.leaseToken, 'current-review');
  const currentReviews = [{ ...reviews[0], summary: 'Checked the edited draft' }];
  const refreshed = (await (await f.complete(created.id, checking.leaseToken, ['current-review'], null, { reviews: currentReviews })).json()).job;
  assert.equal((await f.call(`/jobs/${created.id}/render`, { method: 'POST', data: { revision: refreshed.revision, design: { imageStyle: 'none' } } })).status, 200);
  const render = await f.claim({});
  assert.equal(render.job.metadata.reviewsStale, false);
  await f.upload(created.id, render.leaseToken, 'rendered');
  const completeResponse = await f.call(`/jobs/${created.id}/complete`, { role: 'worker', method: 'POST', data: {
    leaseToken: render.leaseToken, artifacts: ['rendered'], metadata: { render: { checked: true }, reviewsStale: true, reviewsDraftRevision: 999, reviews: [] },
  } });
  assert.equal(completeResponse.status, 200);
  const completed = (await completeResponse.json()).job;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.metadata.reviewsStale, false, 'rendering cannot alter the review evidence');
  assert.equal(completed.metadata.reviewsDraftRevision, edited.draftRevision);
  assert.deepEqual(completed.metadata.reviews, currentReviews);
  assert.deepEqual(completed.metadata.render, { checked: true, draftRevision: edited.draftRevision });
});

test('a lost upload response can be retried without a second write or artifact', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  let writes = 0;
  const originalPut = f.env.ARTIFACTS.put;
  f.env.ARTIFACTS.put = async (...args) => { writes++; return originalPut(...args); };
  // Simulate a response lost after server commit: the client never reads its body.
  assert.equal((await f.upload(job.id, leaseToken)).status, 201);
  const retried = await f.upload(job.id, leaseToken);
  assert.equal(retried.status, 200);
  const artifact = (await retried.json()).artifact;
  assert.equal(artifact.id, 'source');
  assert.equal(writes, 1);
  assert.equal(f.objects.size, 1);
  const completed = (await (await f.complete(job.id, leaseToken)).json()).job;
  assert.deepEqual(completed.artifacts, [artifact]);
  assert.equal((await f.upload(job.id, leaseToken)).status, 409, 'completion revokes even otherwise identical retransmissions');
});

test('concurrent identical uploads share one artifact and discard the losing R2 object', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  const originalPut = f.env.ARTIFACTS.put;
  let writes = 0, release;
  const bothWritten = new Promise((resolve) => { release = resolve; });
  f.env.ARTIFACTS.put = async (...args) => {
    await originalPut(...args);
    if (++writes === 2) release();
    await bothWritten;
  };
  const responses = await Promise.all([f.upload(job.id, leaseToken), f.upload(job.id, leaseToken)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const artifacts = await Promise.all(responses.map(async (response) => (await response.json()).artifact));
  assert.deepEqual(artifacts[0], artifacts[1]);
  assert.equal(writes, 2, 'both uploads reached R2 before conditional registration');
  assert.equal(f.objects.size, 1, 'the losing unique object is deleted');
});

test('reusing a file ID with different contents, names, types or a new attempt is rejected', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken);
  for (const [name, contentType, bytes] of [
    ['source.txt', 'text/plain', 'Changed bytes'],
    ['renamed.txt', 'text/plain', 'Exercise was assessed.'],
    ['source.md', 'text/markdown', 'Exercise was assessed.'],
  ]) {
    const response = await f.call(`/jobs/${job.id}/files/source`, { method: 'PUT', role: 'worker', raw: bytes, headers: {
      'Content-Type': contentType, 'X-Lease-Token': leaseToken, 'X-File-Name': name,
    } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'UPLOAD_CONFLICT');
  }
  assert.equal(f.objects.size, 1);
  await f.call(`/jobs/${job.id}/cancel`, { method: 'POST' });
  await f.call(`/jobs/${job.id}/retry`, { method: 'POST' });
  const next = await f.claim();
  assert.equal((await f.upload(job.id, next.leaseToken)).status, 409, 'identical files from an earlier attempt cannot be reused');
  assert.equal(f.objects.size, 1);
});

test('JATS source archives remain private downloads; HTML cannot masquerade as XML', async t=>{
  const f=await fixture();t.after(f.close);
  const job=await f.create(),{leaseToken}=await f.claim();
  const headers={'X-Lease-Token':leaseToken,'X-File-Name':'paper.xml','Content-Type':'application/xml'};
  assert.equal((await f.call(`/jobs/${job.id}/files/bad-xml`,{method:'PUT',role:'worker',headers,raw:'<?xml version="1.0"?><html>Login</html>'})).status,400);
  const xml='<?xml version="1.0"?><article><front><article-meta><article-title>Fixture title</article-title></article-meta></front><body><p>Full text</p></body></article>';
  assert.equal((await f.call(`/jobs/${job.id}/files/jats`,{method:'PUT',role:'worker',headers,raw:xml})).status,201);
  assert.equal((await f.complete(job.id,leaseToken,['jats'])).status,200);
  const download=await f.call(`/jobs/${job.id}/files/jats?inline=1`);assert.equal(download.status,200);assert.match(download.headers.get('Content-Disposition'),/^attachment/);assert.equal(await download.text(),xml);
  assert.equal((await f.call(`/jobs/${job.id}/files/jats`,{role:'anonymous'})).status,401);
});

const manualPdf = Buffer.from(`%PDF-1.7\n${'owner supplied article '.repeat(20)}`);
const manualHash = createHash('sha256').update(manualPdf).digest('hex');
async function failResearch(f) {
  const job = await f.create(); const { leaseToken } = await f.claim();
  await f.call(`/jobs/${job.id}/fail`, { role: 'worker', method: 'POST', data: { leaseToken, code: 'FULLTEXT_BOT_CHECK', message: 'blocked' } });
  return (await (await f.call(`/jobs/${job.id}`)).json()).job;
}
const putSource = (f, job, { revision = job.revision, bytes = manualPdf, headers = {}, role = 'owner' } = {}) => f.call(`/jobs/${job.id}/source?revision=${revision}`, {
  method: 'PUT', role, raw: bytes, headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('我的全文.pdf'), 'X-Content-SHA256': createHash('sha256').update(bytes).digest('hex'), ...headers } });

test('owner uploads a PDF for a failed research job; it is stored privately and the job is explicitly requeued', async (t) => {
  const f = await fixture(); t.after(f.close);
  const failed = await failResearch(f);
  const response = await putSource(f, failed);
  assert.equal(response.status, 200);
  const { job } = await response.json();
  assert.equal(job.status, 'queued'); assert.equal(job.phase, 'research'); assert.equal(job.error, null); assert.equal(job.revision, failed.revision + 1);
  assert.deepEqual(Object.keys(job.metadata.manualSource).sort(), ['name', 'sha256', 'size', 'uploadedAt']);
  assert.equal(job.metadata.manualSource.name, '我的全文.pdf'); assert.equal(job.metadata.manualSource.sha256, manualHash);
  const keys = [...f.objects.keys()].filter(key => key.includes('/manual/'));
  assert.equal(keys.length, 1); assert.ok(keys[0].startsWith(`jobs/${job.id}/manual/`));
  assert.equal(job.artifacts.length, 0, 'uploaded source is not a downloadable output artifact');
});

test('manual source upload rejects non-PDF bytes, wrong checksum, stale revision, active jobs and worker credentials', async (t) => {
  const f = await fixture(); t.after(f.close);
  const failed = await failResearch(f);
  assert.equal((await putSource(f, failed, { bytes: Buffer.from('<html>login</html>') })).status, 400);
  assert.equal((await putSource(f, failed, { headers: { 'X-Content-SHA256': 'a'.repeat(64) } })).status, 400);
  assert.equal((await putSource(f, failed, { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'a.png' } })).status, 415);
  assert.equal((await putSource(f, failed, { revision: failed.revision - 1 })).status, 409);
  assert.equal((await putSource(f, failed, { role: 'worker' })).status, 404);
  assert.equal((await putSource(f, failed, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal([...f.objects.keys()].filter(key => key.includes('/manual/')).length, 0, 'rejected uploads leave no stored object');
  const queued = await f.create();
  assert.equal((await putSource(f, queued)).status, 409);
});

test('replacing a manual PDF deletes the previous private object', async (t) => {
  const f = await fixture(); t.after(f.close);
  const failed = await failResearch(f);
  const { job } = await (await putSource(f, failed)).json();
  const { leaseToken } = await f.claim();
  await f.call(`/jobs/${job.id}/fail`, { role: 'worker', method: 'POST', data: { leaseToken, code: 'FULLTEXT_MANUAL_MISMATCH', message: 'wrong' } });
  const again = (await (await f.call(`/jobs/${job.id}`)).json()).job;
  const other = Buffer.from(`%PDF-1.7\n${'another article '.repeat(20)}`);
  assert.equal((await putSource(f, again, { bytes: other })).status, 200);
  const keys = [...f.objects.keys()].filter(key => key.includes('/manual/'));
  assert.equal(keys.length, 1);
  assert.equal(f.objects.get(keys[0]).customMetadata.sha256, createHash('sha256').update(other).digest('hex'));
});

test('the worker reads the manual PDF only with the active lease of that job', async (t) => {
  const f = await fixture(); t.after(f.close);
  const failed = await failResearch(f);
  await putSource(f, failed);
  assert.equal((await f.call(`/jobs/${failed.id}/source`, { role: 'worker', headers: { 'X-Lease-Token': '0'.repeat(64) } })).status, 409);
  const { job, leaseToken } = await f.claim();
  assert.equal(job.id, failed.id);
  const response = await f.call(`/jobs/${job.id}/source`, { role: 'worker', headers: { 'X-Lease-Token': leaseToken } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('X-Content-SHA256'), manualHash);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), manualPdf);
  const withoutSource = await f.create();
  await f.call(`/jobs/${job.id}/cancel`, { method: 'POST' });
  const next = await f.claim(); assert.equal(next.job.id, withoutSource.id);
  assert.equal((await f.call(`/jobs/${withoutSource.id}/source`, { role: 'worker', headers: { 'X-Lease-Token': next.leaseToken } })).status, 404);
});
