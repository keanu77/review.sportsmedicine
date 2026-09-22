import { expect, test, type Page } from "./fixtures";
import type { Job } from "../../shared/contracts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";

// API fixtures test browser behavior only; they are not evidence of deployed authentication or real model output.
export function sampleJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-test-1", input: "PMC1234567", title: "A randomized trial in sports rehabilitation", status: "needs_review", phase: "research", stage: "needs_review", revision: 2,
    draft: { post: "初始 Facebook 草稿", igCaption: "初始 IG 草稿", notes: "待核對", pages: [{ id: "cover", layout: "cover", title: "測試封面", subtitle: "回到原始證據" }, { id: "body", layout: "content", title: "重點", cards: [{ title: "效果", body: "測試內文" }] }], claims: [{ text: "研究主張", locator: "p. 3", quote: "A test evidence excerpt." }] },
    design: { palette: "blue", style: "clinical", imageStyle: "photo", format: "portrait" },
    metadata: { paper: { title: "Test source", license: "CC BY 4.0", fullTextVerified: true, sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/" }, reviews: [{ provider: "claude", status: "unavailable", error: "尚未登入" }, { provider: "gemini", status: "ran", findings: [{ severity: "medium", claim: "研究主張", reason: "請確認族群", sourceVerified: false }] }, { provider: "grok", status: "failed", error: "逾時" }] },
    artifacts: [], error: null, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z", ...overrides,
  };
}

export async function apiFixture(page: Page, jobs: Job[] = [sampleJob()]) {
  const state = { jobs, mutations: [] as { method: string; path: string; body: any }[], conflict: false };
  await page.route("**/api/private/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/api/private", "");
    if (path === "/session") return route.fulfill({ json: { email: "owner@example.test", worker: { lastSeen: new Date().toISOString(), capabilities: {} } } });
    if (request.method() === "GET" && path === "/jobs") return route.fulfill({ json: { jobs: state.jobs } });
    if (request.method() === "POST" && path === "/jobs") {
      const body = request.postDataJSON(); state.mutations.push({ method: "POST", path, body });
      const job = sampleJob({ id: "job-created", input: body.input, title: body.title || "", status: "queued", stage: "queued", draft: null, revision: 1 }); state.jobs.unshift(job);
      return route.fulfill({ json: { job } });
    }
    const match = path.match(/^\/jobs\/([^/]+)(?:\/(draft|render|cancel|retry|review))?$/);
    if (match) {
      const job = state.jobs.find(item => item.id === match[1]);
      if (!job) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing job" } } });
      if (request.method() === "GET") return route.fulfill({ json: { job } });
      const body = request.postData() ? request.postDataJSON() : null;
      state.mutations.push({ method: request.method(), path, body });
      if (state.conflict || (body?.revision && body.revision !== job.revision)) return route.fulfill({ status: 409, json: { error: { code: "CONFLICT", message: "Version conflict" } } });
      if (match[2] === "draft") { job.draft = body.draft; job.status = "needs_review"; }
      if (match[2] === "review") { job.status = "queued"; job.stage = "queued"; job.phase = "review"; }
      if (match[2] === "render") { job.design = body.design; job.status = "queued"; job.stage = "queued"; job.phase = "render"; }
      if (match[2] === "cancel") { job.status = "cancelled"; job.stage = "cancelled"; }
      if (match[2] === "retry") { job.status = "queued"; job.stage = "queued"; }
      job.revision++;
      return route.fulfill({ json: { job } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing fixture" } } });
  });
  return state;
}

test("attachment authentication failure is visible without leaving the editor", async ({ page }) => {
  await apiFixture(page, [sampleJob({ status: "completed", artifacts: [{ id: "zip-test", name: "social.zip", contentType: "application/zip", size: 1200, sha256: "a".repeat(64) }] })]);
  await page.route("**/files/zip-test", route => route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } }));
  await page.goto("/workbench/");
  await page.getByLabel("Facebook 貼文").fill("下載失敗仍須保留的文字");
  await page.getByRole("link", { name: "下載前次 ZIP", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("登入");
  await expect(page.getByLabel("Facebook 貼文")).toHaveValue("下載失敗仍須保留的文字");
});

test("a verified ZIP is saved with the expected filename and exact bytes", async ({ page }) => {
  const bytes = Buffer.from(zipSync({ "post.md": strToU8("Test private social materials") }));
  const artifact = { id: "zip-test", name: "social-materials.zip", contentType: "application/zip", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await apiFixture(page, [sampleJob({ status: "completed", artifacts: [artifact] })]);
  await page.route("**/files/zip-test", route => route.fulfill({ body: bytes, contentType: artifact.contentType,
    headers: { "Content-Disposition": 'attachment; filename="social-materials.zip"', "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "no-store" } }));
  await page.goto("/workbench/");
  const saved = page.waitForEvent("download");
  await page.getByRole("link", { name: "下載完整 ZIP", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "檔案已就緒" })).toBeVisible();
  const download = await saved;
  expect(download.suggestedFilename()).toBe(artifact.name);
  expect(await download.failure()).toBeNull();
  expect(await readFile((await download.path())!)).toEqual(bytes);
  await expect(page.getByRole("link", { name: "儲存 social-materials.zip", exact: true })).toHaveAttribute("href", /^blob:/);
});

test("static preview honestly reports unavailable private service", async ({ page }) => {
  await page.goto("/workbench/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("讓研究");
  await expect(page.getByRole("alert")).toContainText("私人服務尚未可用");
  await expect(page.getByRole("button", { name: "取得全文與草稿" })).toBeDisabled();
});

test("owner session opens source, honest reviewer states and editable cards", async ({ page }, testInfo) => {
  await apiFixture(page); await page.goto("/workbench/");
  await expect(page.getByText("owner@example.test")).toBeVisible();
  await expect(page.getByText("CC BY 4.0")).toBeVisible();
  await expect(page.getByText("未執行／無法使用", { exact: true })).toBeVisible();
  await expect(page.getByText("執行失敗", { exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Gemini" }).click();
  await expect(page.getByText("模型意見，未核對來源", { exact: false })).toBeVisible();
  await page.getByLabel("第 2 頁重點 1 內文").fill("更新卡片內容");
  await expect(page.getByRole("button", { name: "確認已核對，製作圖文" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("workbench-desktop.png"), fullPage: true });
});

test("save sends expected revision; render uses newly saved text and selected design", async ({ page }) => {
  const state = await apiFixture(page); await page.goto("/workbench/");
  await page.getByLabel("Facebook 貼文").fill("已人工核對的文字");
  await page.getByRole("button", { name: "儲存文字", exact: true }).click();
  await expect(page.getByText("文字已儲存。可以排入圖文製作。")).toBeVisible();
  await page.getByLabel("色系", { exact: true }).selectOption("emerald");
  await page.getByLabel("尺寸", { exact: true }).selectOption("square");
  await page.getByRole("button", { name: "確認已核對，製作圖文" }).click();
  await expect(page.getByText("已排入圖文製作。Mac 完成後即可預覽與下載。")).toBeVisible();
  expect(state.mutations[0].body.revision).toBe(2);
  expect(state.mutations[0].body.draft.post).toBe("已人工核對的文字");
  expect(state.mutations[1].body).toEqual({ revision: 3, design: { palette: "emerald", style: "clinical", imageStyle: "photo", format: "square" } });
});

test("polling preserves unsaved edits and exposes remote revision conflict", async ({ page }) => {
  await page.clock.install(); const state = await apiFixture(page); await page.goto("/workbench/");
  await page.getByLabel("Facebook 貼文").fill("我的未儲存文字");
  state.jobs[0] = { ...state.jobs[0], revision: 5, draft: { ...state.jobs[0].draft!, post: "遠端文字" } };
  await page.clock.fastForward(6000);
  await expect(page.getByText(/遠端已更新至版本 5/)).toBeVisible();
  await expect(page.getByLabel("Facebook 貼文")).toHaveValue("我的未儲存文字");
  await expect(page.getByRole("button", { name: "儲存文字", exact: true })).toBeDisabled();
});

test("409 failure keeps the editor text and gives an explicit recovery message", async ({ page }) => {
  const state = await apiFixture(page); state.conflict = true; await page.goto("/workbench/");
  await page.getByLabel("Facebook 貼文").fill("不能遺失的文字");
  await page.getByRole("button", { name: "儲存文字", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("你的文字仍保留");
  await expect(page.getByLabel("Facebook 貼文")).toHaveValue("不能遺失的文字");
});

test("switching projects preserves unsaved text within this page", async ({ page }) => {
  await apiFixture(page, [sampleJob(), sampleJob({ id: "job-test-2", title: "Second paper" })]); await page.goto("/workbench/");
  await page.getByLabel("Facebook 貼文").fill("保留第一篇文字");
  await page.getByRole("button", { name: /Second paper/ }).click();
  await expect(page.getByRole("heading", { name: "Second paper", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /A randomized trial/ }).click();
  await expect(page.getByLabel("Facebook 貼文")).toHaveValue("保留第一篇文字");
});

test("mobile create form is usable at 360px and does not invent a publisher identifier", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); const state = await apiFixture(page, []);
  await page.goto("/workbench/?title=Source%20without%20identifier");
  await expect(page.getByText("索引未提供可用識別碼")).toBeVisible();
  await page.getByLabel("DOI、PMID 或 PMCID", { exact: true }).fill("PMC1234567");
  await page.getByRole("button", { name: "取得全文與草稿" }).click();
  await expect(page.getByText("任務已加入佇列。", { exact: false })).toBeVisible();
  expect(state.mutations[0].body.design).toEqual({ palette: "blue", style: "clinical", imageStyle: "photo", format: "portrait" });
  expect(state.mutations[0].body.input).toBe("PMC1234567");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("mobile editor fits viewport and download URL remains private", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await apiFixture(page, [sampleJob({ status: "completed", artifacts: [{ id: "zip-test", name: "social.zip", contentType: "application/zip", size: 1200, sha256: "a".repeat(64) }] })]);
  await page.goto("/workbench/");
  await page.getByLabel("第 2 頁重點 1 內文").fill("360px 可編輯內文");
  await expect(page.getByRole("link", { name: "下載前次 ZIP" })).toHaveAttribute("href", "/api/private/jobs/job-test-1/files/zip-test");
  const box = await page.getByLabel("第 2 頁重點 1 內文").boundingBox();
  expect(box!.width).toBeGreaterThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("workbench-mobile.png"), fullPage: true });
});

test("cancel and retry change job state through the API", async ({ page }) => {
  const state = await apiFixture(page, [sampleJob({ status: "running", stage: "researching" })]); await page.goto("/workbench/");
  await page.getByRole("button", { name: "取消任務", exact: true }).click();
  await expect(page.getByRole("button", { name: "重試任務", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重試任務", exact: true }).click();
  await expect(page.getByText("已重新排入佇列。", { exact: true })).toBeVisible();
  expect(state.mutations.map(item => item.path)).toEqual(["/jobs/job-test-1/cancel", "/jobs/job-test-1/retry"]);
});

test("completed output remains current after completion increments revision, then becomes previous output on edits", async ({ page }) => {
  const job = sampleJob({ status: "completed", stage: "completed", phase: "render", revision: 4,
    metadata: { render: { revision: 3 } },
    artifacts: [{ id: "zip-test", name: "social.zip", contentType: "application/zip", size: 1200, sha256: "a".repeat(64) }],
  });
  await apiFixture(page, [job]); await page.goto("/workbench/");
  const downloads = page.getByRole("region", { name: "預覽與下載", exact: true });
  await expect(downloads.getByRole("link", { name: "下載完整 ZIP", exact: true })).toBeVisible();
  await expect(downloads.getByText(/前次輸出/)).toHaveCount(0);
  await page.getByLabel("色系", { exact: true }).selectOption("emerald");
  await expect(downloads.getByText(/前次輸出，未包含目前文字／設計變更/)).toBeVisible();
  await page.getByLabel("色系", { exact: true }).selectOption("blue");
  await expect(downloads.getByText(/前次輸出/)).toHaveCount(0);
  await page.getByLabel("Facebook 貼文").fill("需要重新輸出的新文案");
  await expect(downloads.getByRole("link", { name: "下載前次 ZIP", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "儲存文字", exact: true }).click();
  await expect(page.getByText("文字已儲存。可以排入圖文製作。")).toBeVisible();
  await expect(downloads.getByText(/前次輸出，未包含目前文字／設計變更/)).toBeVisible();
  await expect(downloads.getByRole("link", { name: "下載完整 ZIP", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "確認已核對，製作圖文" }).click();
  await expect(downloads.getByText(/新一輪製作尚未完成/)).toBeVisible();
});

test("failed rerender keeps the previous-output warning visible", async ({ page }) => {
  await apiFixture(page, [sampleJob({ status: "failed", phase: "render", revision: 8,
    metadata: { render: { revision: 3 } },
    artifacts: [{ id: "zip-test", name: "social.zip", contentType: "application/zip", size: 1200, sha256: "a".repeat(64) }],
  })]);
  await page.goto("/workbench/");
  await expect(page.getByRole("region", { name: "預覽與下載" }).getByText(/前次輸出，未包含目前文字／設計變更/)).toBeVisible();
  await expect(page.getByRole("link", { name: "下載前次 ZIP", exact: true })).toBeVisible();
});

test("polling adopts remote design updates when unchanged locally and preserves intentional local edits", async ({ page }) => {
  await page.clock.install();
  const state = await apiFixture(page, [sampleJob({ status: "completed", phase: "render", revision: 4 })]);
  await page.goto("/workbench/");
  const palette = page.getByLabel("色系", { exact: true });
  await expect(palette).toHaveValue("blue");
  state.jobs[0] = { ...state.jobs[0], revision: 6, design: { ...state.jobs[0].design, palette: "gold" } };
  await page.clock.fastForward(6000);
  await expect(palette).toHaveValue("gold");
  await palette.selectOption("sky");
  state.jobs[0] = { ...state.jobs[0], revision: 8, design: { ...state.jobs[0].design, palette: "emerald" } };
  await page.clock.fastForward(6000);
  await expect(page.getByText("PMC1234567 · 版本 8")).toBeVisible();
  await expect(palette).toHaveValue("sky");
});

test("XML-only verified full text never implies an available PDF or an obtained license", async ({ page }) => {
  const job = sampleJob();
  job.metadata.paper = { title: "XML-only paper", fullTextVerified: true, fullTextAvailable: true, pdfAvailable: false, xmlAvailable: true,
    pdfStatus: "unavailable", pdfError: "出版社 PDF 回傳 HTTP 403", xmlStatus: "available", license: null,
    pdfUrl: "https://example.test/paper.pdf", sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/" };
  job.draft!.claims = [{ text: "表格中的研究數據", locator: "xml:sec:results/table:1/row:2", quote: "A table cell extracted from XML." }];
  await apiFixture(page, [job]); await page.goto("/workbench/");
  const source = page.getByRole("region", { name: "論文來源", exact: true });
  await expect(source.getByText("全文可讀", { exact: true })).toBeVisible();
  await expect(source.getByText("PDF 未取得（出版社 PDF 回傳 HTTP 403）", { exact: true })).toBeVisible();
  await expect(source.getByText("結構化全文 XML 已取得", { exact: true })).toBeVisible();
  await expect(source.getByText("PDF 已取得", { exact: true })).toHaveCount(0);
  await expect(source.getByText("未取得", { exact: true })).toBeVisible();
  await expect(page.getByText("xml:sec:results/table:1/row:2", { exact: true })).toBeVisible();
});

test("PDF and XML availability are reported independently and page locators stay unchanged", async ({ page }) => {
  const job = sampleJob();
  job.metadata.paper = { title: "PDF plus XML paper", fullTextVerified: true, fullTextAvailable: true, pdfAvailable: true, xmlAvailable: true,
    pdfStatus: "available", xmlStatus: "available", license: "CC BY 4.0" };
  job.draft!.claims = [{ text: "PDF 研究主張", locator: "p:3", quote: "A source quote on page three." }];
  await apiFixture(page, [job]); await page.goto("/workbench/");
  const source = page.getByRole("region", { name: "論文來源", exact: true });
  await expect(source.getByText("全文可讀", { exact: true })).toBeVisible();
  await expect(source.getByText("PDF 已取得", { exact: true })).toBeVisible();
  await expect(source.getByText("結構化全文 XML 已取得", { exact: true })).toBeVisible();
  await expect(source.getByText("CC BY 4.0", { exact: true })).toBeVisible();
  await expect(page.getByText("p:3", { exact: true })).toBeVisible();
});

test("legacy full-text verification does not invent PDF or XML availability", async ({ page }) => {
  await apiFixture(page); await page.goto("/workbench/");
  const source = page.getByRole("region", { name: "論文來源", exact: true });
  await expect(source.getByText("原文已驗證（舊任務未記錄檔案取得狀態）", { exact: true })).toBeVisible();
  await expect(source.getByText("未提供 PDF 取得紀錄", { exact: true })).toBeVisible();
  await expect(source.getByText("未提供 XML 取得紀錄", { exact: true })).toBeVisible();
  await expect(source.getByText("PDF 已取得", { exact: true })).toHaveCount(0);
});

test("unavailable full text keeps explicit source failures visible", async ({ page }) => {
  const job = sampleJob();
  job.metadata.paper = { title: "Unavailable paper", fullTextAvailable: false, fullTextVerified: false, pdfAvailable: false, xmlAvailable: false,
    pdfStatus: "unavailable", pdfError: "無開放取用 PDF", xmlStatus: "unavailable", xmlError: "PMC 未提供 XML" };
  await apiFixture(page, [job]); await page.goto("/workbench/");
  const source = page.getByRole("region", { name: "論文來源", exact: true });
  await expect(source.getByText("全文未取得", { exact: true })).toBeVisible();
  await expect(source.getByText("PDF 未取得（無開放取用 PDF）", { exact: true })).toBeVisible();
  await expect(source.getByText("結構化全文 XML 未取得（PMC 未提供 XML）", { exact: true })).toBeVisible();
});


test("idle edits autosave and display the saved time", async ({ page }) => {
  await page.clock.install(); const state = await apiFixture(page); await page.goto('/workbench/');
  await page.getByLabel('Facebook 貼文').fill('自動儲存的文字');
  await page.clock.fastForward(2000);
  await expect(page.getByText(/最後儲存/)).toBeVisible();
  await expect.poll(() => state.jobs[0].draft?.post).toBe('自動儲存的文字');
  expect(state.mutations.filter(m => m.path.endsWith('/draft'))).toHaveLength(1);
});

test("reload recovers unsaved text and refuses to overwrite a newer remote draft", async ({ page }) => {
  await page.clock.install(); const state = await apiFixture(page); await page.goto('/workbench/');
  await page.getByLabel('Facebook 貼文').fill('異常關機前的文字');
  await expect(page.getByText(/本機復原副本/)).toBeVisible();
  state.jobs[0] = { ...state.jobs[0], revision: 8, draft: { ...state.jobs[0].draft!, post: '另一個分頁的文字' } };
  await page.reload();
  await expect(page.getByLabel('Facebook 貼文')).toHaveValue('異常關機前的文字');
  await expect(page.getByText(/已恢復未儲存/)).toBeVisible();
  await expect(page.getByText(/遠端已更新至版本 8/)).toBeVisible();
  await page.clock.fastForward(3000);
  expect(state.mutations).toHaveLength(0);
});

test("text typed while autosave is pending remains in editor and is saved next", async ({ page }) => {
  await page.clock.install(); const state = await apiFixture(page);
  let release: () => void = () => {}; let arrived = false;
  await page.route('**/api/private/jobs/*/draft', async route => {
    if (!arrived) { arrived = true; await new Promise<void>(resolve => { release = resolve; }); }
    await route.fallback();
  });
  await page.goto('/workbench/'); await page.getByLabel('Facebook 貼文').fill('第一段');
  await page.clock.fastForward(2000); await expect.poll(() => arrived).toBe(true);
  await expect(page.getByLabel('Facebook 貼文')).toBeEnabled();
  await page.getByLabel('Facebook 貼文').fill('第一段加上第二段'); release();
  await expect.poll(() => state.jobs[0].draft?.post).toBe('第一段');
  await expect(page.getByLabel('Facebook 貼文')).toHaveValue('第一段加上第二段');
  await page.clock.fastForward(2000);
  await expect.poll(() => state.jobs[0].draft?.post).toBe('第一段加上第二段');
});

test("saved draft can explicitly enter the re-review queue", async ({ page }) => {
  const state = await apiFixture(page); await page.goto('/workbench/');
  await page.getByRole('button', { name: '重新審核目前版本', exact: true }).click();
  await expect(page.getByText(/已排入重新審核/)).toBeVisible();
  expect(state.mutations[0].body.revision).toBe(2);
  expect(state.jobs[0].phase).toBe('review');
});

test('history compares a saved version and restores it without overwriting history', async ({ page }) => {
  const state = await apiFixture(page);
  const older = { revision: 1, createdAt: '2026-09-20T12:00:00Z', restoredFrom: null, draft: { ...state.jobs[0].draft!, post: '歷史草稿' } };
  await page.route('**/api/private/jobs/*/versions', route => route.fulfill({ json: { versions: [older] } }));
  await page.route('**/api/private/jobs/*/versions/1', route => route.fulfill({ json: { version: older } }));
  await page.route('**/api/private/jobs/*/restore', route => {
    expect(route.request().postDataJSON()).toEqual({ revision: 2, version: 1 });
    state.jobs[0] = { ...state.jobs[0], revision: 3, draftRevision: 3, draft: older.draft };
    return route.fulfill({ json: { job: state.jobs[0] } });
  });
  await page.goto('/workbench/'); await page.getByText('草稿版本紀錄', { exact: true }).click();
  await page.getByLabel('選擇歷史版本').selectOption('1');
  await expect(page.getByRole('cell', { name: '歷史草稿', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '初始 Facebook 草稿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '還原為新版本', exact: true }).click();
  await expect(page.getByLabel('Facebook 貼文')).toHaveValue('歷史草稿');
});

test('review findings require a rejection reason and save the disposition', async ({ page }) => {
  const job = sampleJob(); job.metadata.reviewRunId = 'run-1'; job.metadata.reviewsDraftRevision = 2; job.metadata.reviewsStale = false;
  await apiFixture(page, [job]);
  const run = { id: 'run-1', draftRevision: 2, createdAt: new Date().toISOString(), reviews: job.metadata.reviews, dispositions: [] as any[] };
  await page.route('**/api/private/jobs/*/reviews', route => route.fulfill({ json: { runs: [run] } }));
  await page.route('**/api/private/jobs/*/reviews/run-1/findings/gemini/0', route => {
    const data = route.request().postDataJSON();
    expect(data).toMatchObject({ status: 'rejected', reason: '原文已明確限定族群' });
    run.dispositions = [{ provider: 'gemini', findingIndex: 0, ...data }];
    return route.fulfill({ json: { runs: [run] } });
  });
  await page.goto('/workbench/'); await page.locator('summary').filter({ hasText: 'Gemini' }).click();
  await page.getByLabel('Gemini 意見 1 處理狀態').selectOption('rejected');
  await expect(page.getByRole('button', { name: '儲存 Gemini 意見 1', exact: true })).toBeDisabled();
  await page.getByLabel('Gemini 意見 1 處理理由').fill('原文已明確限定族群');
  await page.getByRole('button', { name: '儲存 Gemini 意見 1', exact: true }).click();
  await expect(page.getByText('意見處理紀錄已儲存。', { exact: true })).toBeVisible();
});

test('legacy review selection retains its unknown draft version after a new review', async ({ page }) => {
  const job = sampleJob({ draftRevision: 2 });
  Object.assign(job.metadata, { reviewRunId: 'new-run', reviewsDraftRevision: 2 });
  await apiFixture(page, [job]);
  const runs = [
    { id: 'new-run', draftRevision: 2, createdAt: '2026-09-22T00:00:00Z', reviews: job.metadata.reviews, dispositions: [] },
    { id: 'legacy-run', draftRevision: null, createdAt: '2026-09-21T00:00:00Z', reviews: job.metadata.reviews, dispositions: [] },
  ];
  await page.route('**/api/private/jobs/*/reviews', route => route.fulfill({ json: { runs } }));
  await page.goto('/workbench/');
  await expect(page.getByText('審核對應草稿版本 2。', { exact: true })).toBeVisible();
  await page.getByLabel('查看審核批次').selectOption('legacy-run');
  await expect(page.getByText(/舊紀錄未保存確切草稿版本/)).toBeVisible();
  await expect(page.getByText('審核對應草稿版本 2。', { exact: true })).toHaveCount(0);
});

test('a clean second tab cannot delete the first tab crash recovery copy', async ({ page, context }) => {
  await page.clock.install(); const state = await apiFixture(page); await page.goto('/workbench/');
  await expect(page.getByLabel('Facebook 貼文')).toBeVisible();
  const second = await context.newPage(); await second.route('https://fonts.googleapis.com/**', route => route.abort()); await second.clock.install();
  await apiFixture(second, state.jobs); await second.goto('/workbench/'); await expect(second.getByLabel('Facebook 貼文')).toBeVisible();
  await page.route('**/api/private/jobs/*/draft', route => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Offline fixture' } } }));
  await page.getByLabel('Facebook 貼文').fill('第一個分頁的未儲存草稿');
  await second.clock.fastForward(6000); await expect(second.getByLabel('Facebook 貼文')).toHaveValue('初始 Facebook 草稿');
  await page.reload(); await expect(page.getByLabel('Facebook 貼文')).toHaveValue('第一個分頁的未儲存草稿');
  await second.close();
});

test('reverting to baseline during a pending save survives a newer poll', async ({ page }) => {
  await page.clock.install(); const state = await apiFixture(page);
  let release: () => void = () => {}, arrived = false;
  await page.route('**/api/private/jobs/*/draft', async route => {
    if (arrived) return route.fallback();
    arrived = true; const data = route.request().postDataJSON();
    state.jobs[0] = { ...state.jobs[0], revision: 3, draft: data.draft };
    const reply = structuredClone(state.jobs[0]);
    await new Promise<void>(resolve => { release = resolve; });
    return route.fulfill({ json: { job: reply } });
  });
  await page.goto('/workbench/'); await page.getByLabel('Facebook 貼文').fill('送出中的 B');
  await page.clock.fastForward(2000); await expect.poll(() => arrived).toBe(true);
  await page.getByLabel('Facebook 貼文').fill('初始 Facebook 草稿');
  await page.clock.fastForward(4000);
  await expect(page.getByLabel('Facebook 貼文')).toHaveValue('初始 Facebook 草稿');
  release(); await page.clock.fastForward(2000);
  await expect(page.getByLabel('Facebook 貼文')).toHaveValue('初始 Facebook 草稿');
});

test('re-review preserves freshness of output matching the current draft', async ({ page }) => {
  const job = sampleJob({ status: 'needs_review', phase: 'review', revision: 8, draftRevision: 4,
    metadata: { render: { draftRevision: 4 } }, artifacts: [{ id: 'zip-test', name: 'social.zip', contentType: 'application/zip', size: 1200, sha256: 'a'.repeat(64) }] });
  await apiFixture(page, [job]); await page.goto('/workbench/');
  await expect(page.getByRole('link', { name: '下載完整 ZIP', exact: true })).toBeVisible();
  await expect(page.getByText(/前次輸出，未包含目前文字/)).toHaveCount(0);
});

test('a pending save crash recovers the submitted draft before server commit', async ({ page }) => {
  await page.clock.install(); const state = await apiFixture(page);
  let release: () => void = () => {}, arrived = false;
  await page.route('**/api/private/jobs/*/draft', async route => {
    if (arrived) return route.fallback();
    arrived = true; await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 503, json: { error: { code: 'INTERRUPTED' } } }).catch(() => {});
  });
  await page.goto('/workbench/'); await page.getByLabel('Facebook 貼文').fill('送出但尚未到達伺服器的文字');
  await page.clock.fastForward(2000); await expect.poll(() => arrived).toBe(true);
  await page.reload(); release();
  await expect(page.getByLabel('Facebook 貼文')).toHaveValue('送出但尚未到達伺服器的文字');
  await expect(page.getByText(/上次儲存結果尚待確認/)).toBeVisible();
  expect(state.jobs[0].draft?.post).toBe('初始 Facebook 草稿');
});

test('an uncertain save failure preserves a later revert through polls and reload', async ({ page }) => {
  await page.clock.install(); const state = await apiFixture(page);
  let release: () => void = () => {}, arrived = false;
  await page.route('**/api/private/jobs/*/draft', async route => {
    if (arrived) return route.fallback();
    arrived = true; const data = route.request().postDataJSON();
    state.jobs[0] = { ...state.jobs[0], revision: 3, draft: data.draft };
    await new Promise<void>(resolve => { release = resolve; });
    return route.fulfill({ status: 503, json: { error: { code: 'LOST_RESPONSE', message: 'Committed but response lost' } } });
  });
  await page.goto('/workbench/'); await page.getByLabel('Facebook 貼文').fill('已送出的 B');
  await page.clock.fastForward(2000); await expect.poll(() => arrived).toBe(true);
  await page.getByLabel('Facebook 貼文').fill('初始 Facebook 草稿'); release();
  await expect(page.getByRole('alert')).toContainText('LOST_RESPONSE');
  await page.clock.fastForward(6000);
  await expect(page.getByLabel('Facebook 貼文')).toHaveValue('初始 Facebook 草稿');
  await page.reload(); await expect(page.getByLabel('Facebook 貼文')).toHaveValue('初始 Facebook 草稿');
  await expect(page.getByText(/遠端已更新至版本 3/)).toBeVisible();
});
