import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as api from "../../src/privateApi.ts";
import type { Artifact } from "../../shared/contracts.ts";

const bytes = new TextEncoder().encode("private attachment");
const artifact: Artifact = { id: "file-1", name: "notes.txt", contentType: "text/plain", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };

test("private attachment fetch preserves bytes and authenticated request semantics", async t => {
  let request: { url: unknown; options?: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, options?: RequestInit) => {
    request = { url, options };
    return new Response(bytes, { headers: { "Content-Type": "text/plain" } });
  });
  assert.equal(typeof api.fetchArtifact, "function", "attachments need a checked fetch instead of silent navigation");
  const blob = await api.fetchArtifact("job-1", artifact);
  assert.equal(await blob.text(), "private attachment");
  assert.equal(request?.url, "/api/private/jobs/job-1/files/file-1");
  assert.equal(request?.options?.credentials, "same-origin");
  assert.equal(request?.options?.cache, "no-store");
});

test("expired authentication and HTML login responses cannot become saved attachments", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"error":{"code":"UNAUTHORIZED"}}', { status: 401, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(() => api.fetchArtifact("job-1", artifact), error => api.errorText(error).includes("登入"));
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Sign in</html>", { headers: { "Content-Type": "text/html" } }));
  await assert.rejects(() => api.fetchArtifact("job-1", artifact), /登入/);
});

test("truncated and same-size corrupted attachment responses are rejected", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(bytes.slice(1), { headers: { "Content-Type": "text/plain" } }));
  await assert.rejects(() => api.fetchArtifact("job-1", artifact), /不完整/);
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(bytes.length), { headers: { "Content-Type": "text/plain" } }));
  await assert.rejects(() => api.fetchArtifact("job-1", artifact), /檢查未通過/);
});

test("missing attachments and failed connections give actionable errors", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 404 }));
  await assert.rejects(() => api.fetchArtifact("job-1", artifact), /重新整理/);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(() => api.fetchArtifact("job-1", artifact), /連線失敗/);
});

test("leaving the job aborts an in-progress attachment request", async t => {
  const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    assert.equal(options.signal?.aborted, true);
    throw new DOMException("aborted", "AbortError");
  });
  await assert.rejects(() => api.fetchArtifact("job-1", artifact, controller.signal), { name: "AbortError" });
});
