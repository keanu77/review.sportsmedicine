import type { Draft } from "../shared/contracts";

export type PlacedFinding = { provider: string; index: number; severity: string; claim: string; suggestion: string };
export type FieldKey = "post" | "igCaption" | `page:${number}`;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const plain = (value: string) => value.normalize("NFKC").replace(/[\s，。、：；！？「」『』（）()《》"'.,:;!?-]/g, "").toLowerCase();
// An ASCII field name counts only as a whole word ("ig" must not match "big").
const named = (claim: string, name: string) => /^[a-z]+$/.test(name) ? new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(claim) : claim.includes(name);

function fields(draft: Draft) {
  return [
    { key: "post" as FieldKey, names: ["post", "fb", "facebook", "貼文"], body: draft.post },
    { key: "igCaption" as FieldKey, names: ["igcaption", "ig", "instagram"], body: draft.igCaption },
    ...draft.pages.map((page, i) => ({ key: `page:${i}` as FieldKey, names: [page.id.toLowerCase(), `第${i + 1}頁`, `第 ${i + 1} 頁`],
      body: [page.title, page.subtitle ?? "", ...(page.cards ?? []).flatMap(card => [card.title, card.body])].join("\n") })),
  ];
}

/** Places each review finding next to the draft fields it names or quotes; unplaced findings stay in the review list only. */
export function placeFindings(draft: Draft, reviews: unknown): Map<FieldKey, PlacedFinding[]> {
  const placed = new Map<FieldKey, PlacedFinding[]>(), targets = fields(draft).map(field => ({ ...field, flat: plain(field.body) }));
  for (const review of Array.isArray(reviews) ? reviews.map(record) : []) {
    if (review.status !== "ran" || !Array.isArray(review.findings)) continue;
    review.findings.map(record).forEach((finding, index) => {
      const claim = text(finding.claim), lower = claim.toLowerCase();
      const quotes = [...claim.matchAll(/「([^」]{4,})」/g)].map(match => plain(match[1])).filter(quote => quote.length >= 4);
      const whole = plain(claim);
      for (const field of targets) {
        const hit = field.names.some(name => named(lower, name)) || quotes.some(quote => field.flat.includes(quote)) || (whole.length >= 10 && field.flat.includes(whole));
        if (!hit) continue;
        const item = { provider: text(review.provider), index, severity: text(finding.severity), claim, suggestion: text(finding.suggestion) };
        placed.set(field.key, [...(placed.get(field.key) ?? []), item]);
      }
    });
  }
  return placed;
}
