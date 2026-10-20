import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expandToken } from "../../src/aliases.ts";
import { uniquePapers } from "../../src/identity.ts";
import { matchesQuery, rankResults, suggestTerms, tokenize } from "../../src/search.ts";
import * as search from "../../src/search.ts";
import type { Item, ReviewsData } from "../../src/types.ts";

function paper(title: string, extra: Partial<Item> = {}): Item {
  return { title, year: 2026, url: `https://example.test/${encodeURIComponent(title)}`, source: "", free: false,
    tldr: null, region: "", disease: "", themes: [], populations: [], ...extra };
}

const frozenShoulder = ["冰凍肩", "五十肩", "沾黏性肩關節囊炎", "frozen shoulder", "adhesive capsulitis"];

test("frozen shoulder synonyms match bidirectionally, including whole English phrases", () => {
  for (const query of frozenShoulder) {
    for (const title of frozenShoulder) {
      assert.equal(matchesQuery(paper(title), tokenize(query)), true, `${query} should find ${title}`);
    }
    assert.equal(matchesQuery(paper("Rotator cuff repair", { disease: "肩痛" }), tokenize(query)), false);
  }
  assert.ok(expandToken("Frozen Shoulder").includes("冰凍肩"));
  assert.equal(matchesQuery(paper("五十肩"), tokenize("FROZEN   SHOULDER")), true);
});

test("common Chinese symptoms and major clinical topics find their English synonyms in either direction", () => {
  const groups = [
    ["膝蓋痛", "膝痛", "膝關節疼痛", "knee pain"],
    ["網球肘", "肱骨外上髁病變", "lateral epicondylitis", "tennis elbow"],
    ["媽媽手", "de quervain", "狄奎凡氏症"],
    ["足底筋膜炎", "plantar fasciitis"],
    ["肌少症", "sarcopenia"],
    ["ACL", "前十字韌帶", "anterior cruciate ligament"],
    ["膝退化性關節炎", "膝骨關節炎", "knee osteoarthritis"],
    ["下背痛", "LBP", "low back pain"],
  ];
  for (const group of groups) for (const query of group) for (const title of group) {
    assert.equal(matchesQuery(paper(title), tokenize(query)), true, `${query} should find ${title}`);
  }
});

test("longest known phrases stay together and AND remains a separator with conjunction semantics", () => {
  assert.deepEqual(tokenize("PRP AND frozen shoulder"), ["prp", "frozen shoulder"]);
  assert.deepEqual(tokenize("rotator cuff repair AND rehabilitation"), ["rotator cuff repair", "rehabilitation"]);
  assert.deepEqual(tokenize("PRP and knee pain"), ["prp", "knee pain"]);
  assert.equal(matchesQuery(paper("Platelet-rich plasma for adhesive capsulitis"), tokenize("PRP AND 冰凍肩")), true);
  assert.equal(matchesQuery(paper("Platelet-rich plasma for knee pain"), tokenize("PRP AND 冰凍肩")), false);
  assert.deepEqual(tokenize("PRP OR ACL"), ["prp", "or", "acl"]);
  assert.equal(matchesQuery(paper("PRP"), tokenize("PRP OR ACL")), false, "OR is not silently treated as supported Boolean syntax");
});

test("PRP means platelet-rich plasma and does not expand to platelet-rich fibrin", () => {
  for (const query of ["PRP", "platelet-rich plasma", "platelet rich plasma", "富血小板血漿"]) {
    for (const title of ["PRP for knee pain", "Platelet-rich plasma for knee pain", "富血小板血漿於膝痛"]) {
      assert.equal(matchesQuery(paper(title), tokenize(query)), true, `${query} should find ${title}`);
    }
    for (const title of ["Platelet-rich fibrin for alopecia", "富血小板纖維蛋白", "Antiplatelet-rich plasma assays"]) {
      assert.equal(matchesQuery(paper(title), tokenize(query)), false, `${query} should not find ${title}`);
    }
  }
});

test("short Latin terms keep word boundaries while ordinary word stems remain searchable", () => {
  for (const term of ["at", "ct", "prp"]) {
    assert.equal(matchesQuery(paper("systematic active PRPF review"), tokenize(term)), false, term);
  }
  assert.equal(matchesQuery(paper("AT in athletes"), tokenize("at")), true);
  assert.equal(matchesQuery(paper("Achilles tendinopathy"), tokenize("tendin")), true);
});

test("phrase parsing preserves exact identifiers and case-sensitive publisher paths", () => {
  const item = paper("An unrelated paper", { doi: "10.1007/s40520-025-03235-w", pmid: "40234567", pmcid: "PMC1234567", url: "https://publisher.test/Article/ABC" });
  for (const query of ["DOI: 10.1007/S40520-025-03235-W", "PMID: 40234567", "PMCID: PMC1234567", "https://publisher.test/Article/ABC?utm_source=AND"]) {
    assert.equal(matchesQuery(item, tokenize(query)), true, query);
  }
  for (const query of ["10.1007/s40520-025-03235", "PMID:4023456", "https://publisher.test/article/abc"]) {
    assert.equal(matchesQuery(item, tokenize(query)), false, query);
  }
});

test("generic PRP favors explicit sports and musculoskeletal evidence without dropping other papers", () => {
  const hair = paper("PRP for androgenetic alopecia", { year: 2026, region: "頭頸／腦震盪", disease: "富血小板血漿治療" });
  const fertility = paper("PRP for ovarian infertility", { year: 2026, region: "髖與鼠蹊", disease: "富血小板血漿治療" });
  const knee = paper("Platelet-rich plasma for knee osteoarthritis", { year: 2020, region: "注射・再生・儀器治療", disease: "膝骨關節炎" });
  const muscle = paper("Platelet-rich plasma for acute muscle injuries in athletes", { year: 2020 });
  const inputs = [hair, fertility, knee, muscle];
  for (const query of ["PRP", "platelet-rich plasma", "富血小板血漿"]) {
    const tokens = tokenize(query);
    const results = rankResults(inputs.filter(item => matchesQuery(item, tokens)), tokens, "relevance");
    assert.equal(results.length, 4, "ranking retains off-domain literature");
    assert.ok(results.indexOf(knee) < results.indexOf(hair));
    assert.ok(results.indexOf(muscle) < results.indexOf(fertility));
  }
  assert.equal(rankResults(inputs, tokenize("PRP"), "latest")[0]?.year, 2026);
});

test("the sports bonus is explainable and disabled for qualified PRP searches", () => {
  assert.equal(typeof search.relevanceScore, "function");
  const knee = paper("PRP for knee osteoarthritis", { disease: "膝骨關節炎" });
  const hair = paper("PRP for alopecia", { region: "肩", disease: "落髮" });
  const explicit = tokenize("PRP alopecia");
  assert.ok(search.relevanceScore(knee, tokenize("PRP")).sportsContext > 0);
  assert.equal(search.relevanceScore(hair, tokenize("PRP")).sportsContext, 0, "anatomical region alone is not topic evidence");
  assert.equal(search.relevanceScore(knee, explicit).sportsContext, 0);
  assert.equal(search.relevanceScore(hair, explicit).sportsContext, 0);
  assert.equal(rankResults([knee, hair], explicit, "relevance")[0], hair);
  assert.deepEqual([knee, hair].filter(item => matchesQuery(item, explicit)), [hair]);
});

test("structured recovery suggestions have executable queries and deduplicated result counts", () => {
  assert.equal(typeof search.suggestQueries, "function");
  const one = paper("ACL rehabilitation", { disease: "前十字韌帶損傷", themes: ["復健"] });
  const duplicate = { ...one, url: `${one.url}?utm_source=duplicate` };
  const two = paper("Anterior cruciate ligament surgery", { disease: "前十字韌帶損傷" });
  const items = [one, duplicate, two];
  const suggestions = search.suggestQueries(items, "ACL impossiblecondition");
  assert.ok(suggestions.length > 0);
  for (const suggestion of suggestions) {
    assert.ok(suggestion.query.length > 0);
    assert.equal(suggestion.count, uniquePapers(items.filter(item => matchesQuery(item, tokenize(suggestion.query)))).length);
  }
  assert.deepEqual(suggestTerms(items, "ACL impossiblecondition"), suggestions.map(s => `${s.label}（${s.count}）`));
  assert.deepEqual(search.suggestQueries(items, "gibberish"), []);
  assert.deepEqual(search.suggestQueries(items, ""), []);
  assert.equal(search.suggestQueries(items, "ACL impossiblecondition", 1).length, 1);
});

test("the current catalog finds the same frozen shoulder papers across Chinese and English queries", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../public/data/reviews-index.json", import.meta.url), "utf8")) as ReviewsData;
  const find = (query: string) => uniquePapers(catalog.items.filter(item => matchesQuery(item, tokenize(query)))).map(item => item.title).sort();
  const expected = find("frozen shoulder");
  assert.ok(expected.some(title => /frozen shoulder/i.test(title)), "catalog contains a real frozen shoulder paper");
  assert.ok(expected.some(title => /adhesive capsulitis/i.test(title)), "catalog contains a real adhesive capsulitis paper");
  for (const query of frozenShoulder) assert.deepEqual(find(query), expected, query);
});

test("the current catalog ranks a musculoskeletal PRP title before the alopecia paper", async () => {
  const { enrichItems } = await import("../../src/enrich.ts");
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../public/data/${name}.json`, import.meta.url), "utf8"));
  const catalog = enrichItems(read("reviews-index").items, read("summaries").summaries, read("tags").tags);
  const tokens = tokenize("PRP");
  const matches = uniquePapers(catalog.filter(item => matchesQuery(item, tokens)));
  const result = rankResults(matches, tokens, "relevance");
  assert.ok(result.length > 0);
  assert.match(result[0].title, /osteoarthritis|tendinopathy|muscle|rotator cuff/i);
  const alopecia = result.findIndex(item => /alopecia/i.test(item.title));
  assert.ok(alopecia > 0, "the explicitly PRP-tagged alopecia paper remains discoverable below sports/MSK papers");
  assert.equal(result.length, matches.length, "ranking must never drop a matched paper");
});

test("ordinary search text cannot access inherited dictionary properties", () => {
  for (const query of ["constructor", "__proto__", "toString"]) {
    assert.deepEqual(expandToken(query), [query.toLowerCase()]);
    assert.equal(matchesQuery(paper("Knee osteoarthritis"), tokenize(query)), false);
  }
});
