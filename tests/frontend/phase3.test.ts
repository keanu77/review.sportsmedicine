import test from "node:test";
import assert from "node:assert/strict";
import { placeFindings } from "../../src/findingTargets";
import { finishedJobs, titleWithCount } from "../../src/completion";
import type { Draft, Job } from "../../shared/contracts";

const draft: Draft = { post: "手肘脫臼後，多數人能回場。", igCaption: "不能据此判定哪種治療更好。", notes: "",
  pages: [{ id: "cover", layout: "cover", title: "手肘脫臼能回場嗎" }, { id: "treatment-comparison", layout: "content", title: "治療差異怎麼看", cards: [{ title: "觀察到的時間", body: "非手術組平均8.95週" }] }, { id: "end", layout: "outro", title: "先釐清目標" }], claims: [] };
const finding = (claim: string) => ({ severity: "medium", claim, reason: "", suggestion: "改寫", locator: "", quote: "" });

test("findings land next to the fields they name or quote", () => {
  const placed = placeFindings(draft, [
    { provider: "claude", status: "ran", findings: [finding("igCaption使用簡體字「据」：「不能据此判定哪種治療更好」。"), finding("post與treatment-comparison頁僅呈現彙整平均")] },
    { provider: "grok", status: "ran", findings: [finding("「多數人能回場」過度推論"), finding("big picture 缺少背景")] },
    { provider: "gemini", status: "failed", findings: [finding("post 有問題")] },
  ]);
  assert.deepEqual(placed.get("igCaption")?.map(f => [f.provider, f.index]), [["claude", 0]]);
  assert.deepEqual(placed.get("post")?.map(f => [f.provider, f.index]), [["claude", 1], ["grok", 0]]);
  assert.deepEqual(placed.get("page:1")?.map(f => [f.provider, f.index]), [["claude", 1]]);
  assert.equal(placed.get("page:0"), undefined);
  assert.equal([...placed.values()].flat().some(f => f.claim.startsWith("big")), false, "ASCII names match whole words only");
});

test("only jobs that were active at the last poll count as newly finished", () => {
  const job = (id: string, status: Job["status"]) => ({ id, status }) as Job;
  const previous = new Map<string, Job["status"]>([["a", "running"], ["b", "queued"], ["c", "needs_review"], ["d", "running"]]);
  assert.deepEqual(finishedJobs(previous, [job("a", "needs_review"), job("b", "failed"), job("c", "completed"), job("d", "running"), job("e", "completed")]).map(j => j.id), ["a", "b"]);
  assert.equal(titleWithCount("工作台", 2), "(2) 工作台"); assert.equal(titleWithCount("工作台", 0), "工作台");
});
