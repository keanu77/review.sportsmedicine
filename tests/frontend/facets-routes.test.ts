import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FACETS, facetOptions, matchesFacets } from "../../src/facets";
import { paperPath, paperSlugFromPath, safeIndexReturn } from "../../src/paperRoutes";
import type { Item } from "../../src/types";
const item: Item = { title: "Knee trial", year: 2025, url: "https://doi.org/10.1234/one", source: "Journal", free: false, tldr: null, region: "膝", disease: "ACL", themes: ["復健"], populations: ["運動員"] };
test("facets combine with AND and count each paper once per option", () => {
  const state = { ...EMPTY_FACETS, region: "膝", population: "運動員" };
  assert.equal(matchesFacets(item, state), true);
  assert.equal(matchesFacets({ ...item, populations: ["兒童"] }, state), false);
  assert.deepEqual(facetOptions([item, item, { ...item, url: "https://doi.org/10.1234/two", region: "肩" }], state, "region"), [{ value: "肩", count: 1 }, { value: "膝", count: 1 }].sort((a,b)=>a.value.localeCompare(b.value,"zh-Hant")));
  assert.deepEqual(facetOptions([item], { ...state, disease: "不存在" }, "disease").find(x => x.value === "不存在"), { value: "不存在", count: 0 });
});
test("public paths distinguish same titles and punctuation-colliding identifiers", () => {
  assert.notEqual(paperPath(item), paperPath({ ...item, url: "https://doi.org/10.1234/two" }));
  assert.notEqual(paperPath({ ...item, url: "https://doi.org/10.1234/a.b" }), paperPath({ ...item, url: "https://doi.org/10.1234/a-b" }));
  assert.ok(paperSlugFromPath(paperPath(item)));
  assert.equal(paperSlugFromPath("/papers/../../workbench"), null);
});
test("return links keep query filters and reject external redirect targets", () => {
  assert.equal(safeIndexReturn("?from="+encodeURIComponent("?q=ACL&region=膝")), "/?q=ACL&region=膝");
  for (const from of ["https://evil.example", "//evil.example", "javascript:alert(1)", "?"+"a".repeat(4096)]) assert.equal(safeIndexReturn("?from="+encodeURIComponent(from)), "/");
});
