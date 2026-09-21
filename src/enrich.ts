import { paperKey } from "./identity";
import type { Item, TagsData } from "./types";

export function enrichItem(item: Item, summaries: Record<string, string>, tags: TagsData["tags"]): Item {
  const key = paperKey(item);
  let next = summaries[key] ? { ...item, tldr: summaries[key], tldrSource: "local-llm" } : item;
  for (const tag of Object.values(tags)) {
    const current = next[tag.axis] ?? [];
    const renamed = current.map(value => tag.absorbs?.includes(value) ? tag.label : value);
    const add = tag.keys.includes(key) && !renamed.includes(tag.label);
    if (add || renamed.some((value, index) => value !== current[index])) {
      next = { ...next, [tag.axis]: [...new Set(add ? [...renamed, tag.label] : renamed)] };
    }
  }
  return next;
}
