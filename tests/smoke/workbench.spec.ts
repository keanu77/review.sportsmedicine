import { expect, test, type Page } from "@playwright/test";
import type { Job } from "../../shared/contracts";

// API fixtures test browser behavior only; they are not evidence of deployed authentication or real model output.
function sampleJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-test-1", input: "PMC1234567", title: "A randomized trial in sports rehabilitation", status: "needs_review", phase: "research", stage: "needs_review", revision: 2,
    draft: { post: "初始 Facebook 草稿", igCaption: "初始 IG 草稿", notes: "待核對", pages: [{ id: "cover", layout: "cover", title: "測試封面", subtitle: "回到原始證據" }, { id: "body", layout: "content", title: "重點", cards: [{ title: "效果", body: "測試內文" }] }], claims: [{ text: "研究主張", locator: "p. 3", quote: "A test evidence excerpt." }] },
    design: { palette: "blue", style: "clinical", imageStyle: "photo", format: "portrait" },
    metadata: { paper: { title: "Test source", license: "CC BY 4.0", fullTextVerified: true, sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/" }, reviews: [{ provider: "claude", status: "unavailable", error: "尚未登入" }, { provider: "gemini", status: "ran", findings: [{ severity: "medium", claim: "研究主張", reason: "請確認族群", sourceVerified: false }] }, { provider: "grok", status: "failed", error: "逾時" }] },
    artifacts: [], error: null, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z", ...overrides,
  };
}

async function apiFixture(page: Page, jobs: Job[] = [sampleJob()]) {
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
    const match = path.match(/^\/jobs\/([^/]+)(?:\/(draft|render|cancel|retry))?$/);
    if (match) {
      const job = state.jobs.find(item => item.id === match[1]);
      if (!job) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing job" } } });
      if (request.method() === "GET") return route.fulfill({ json: { job } });
      const body = request.postData() ? request.postDataJSON() : null;
      state.mutations.push({ method: request.method(), path, body });
      if (state.conflict) return route.fulfill({ status: 409, json: { error: { code: "CONFLICT", message: "Version conflict" } } });
      if (match[2] === "draft") { job.draft = body.draft; job.status = "needs_review"; }
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
