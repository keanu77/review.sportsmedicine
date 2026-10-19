import test from "node:test";
import assert from "node:assert/strict";
import { publicDocument } from "../../scripts/public-document";
const template = '<html><head><title>Index</title><meta name="description" content="Index" /><meta property="og:title" content="Index" /><meta property="og:description" content="Index" /><meta property="og:url" content="https://review.sportsmedicine.tw/" /><link rel="canonical" href="https://review.sportsmedicine.tw/" /></head><body><div id="root"></div></body></html>';
test("public metadata escapes untrusted text and keeps replacement tokens literal", () => {
  const html = publicDocument(template, { title: '$& <img src=x onerror="alert(1)">', description: "$` $' & text", canonical: "https://review.sportsmedicine.tw/papers/test/", body: "<h1>Example $&</h1>" });
  assert.ok(html.includes('<title>$&amp; &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</title>'));
  assert.ok(html.includes('content="$` $\' &amp; text"'));
  assert.ok(html.includes('<h1>Example $&</h1>'));
  assert.equal((html.match(/<html>/g) || []).length, 1);
  assert.ok(html.includes('rel="canonical" href="https://review.sportsmedicine.tw/papers/test/"'));
});
test("bootstrap data cannot close its JSON script and missing pages are noindex", () => {
  const data = { title: '</script><script>alert(1)</script> $&', value: 'p < .001' };
  const html = publicDocument(template, { title: "Missing", description: "Missing", canonical: "https://review.sportsmedicine.tw/404.html", body: "", bootstrap: { id: "paper-data", data }, noindex: true });
  const content = html.match(/<script type="application\/json" id="paper-data">([\s\S]*?)<\/script>/)![1];
  assert.deepEqual(JSON.parse(content), data);
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
});
