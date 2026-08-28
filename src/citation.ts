// 引用格式化。
//
// 資料沒有作者欄位，所以只能組出「無作者」版本的 Vancouver 條目——這是誠實的取捨：
// 寧可少一個欄位，也不要編造作者。使用者貼進病歷討論或投影片時，
// 標題／期刊／年份／PMID／DOI 已足夠回溯原文。

import type { Item } from "./types";

/** 從各種網址形態裡取出 DOI。 */
export function doiOf(item: Item): string | null {
  const m = String(item.url ?? "").match(
    /(?:doi\.org\/|\/doi\/(?:abs|full|pdf)\/)(10\.\d{4,9}\/\S+)/i,
  );
  return m ? decodeURIComponent(m[1]).replace(/[).]+$/, "") : null;
}

// source 有時是來源網域（jsams.org、journals.sagepub.com）而非期刊名。
// 把網域當期刊名寫進引用會誤導，寧可缺這個欄位。
function looksLikeDomain(text: string): boolean {
  return /^[\w.-]+\.[a-z]{2,}$/i.test(text.trim());
}

function journalOf(item: Item): string {
  const journal = (item.journal || "").trim();
  if (journal && !looksLikeDomain(journal)) return journal;
  const source = (item.source || "").trim();
  return source && !looksLikeDomain(source) ? source : "";
}

// BibTeX 走 LaTeX，這些字元不跳脫會讓使用者的文件編譯失敗。
function escapeBibTeX(text: string): string {
  return text.replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}");
}

/** Vancouver 風格的一行引用（無作者欄位時省略作者段）。 */
export function toVancouver(item: Item): string {
  const title = item.title.trim().replace(/\.$/, "");
  const journal = journalOf(item);
  const doi = doiOf(item);
  const parts = [`${title}.`];
  if (journal) parts.push(`${journal}.`);
  if (item.year) parts.push(`${item.year}.`);
  if (item.pmid) parts.push(`PMID: ${item.pmid}.`);
  if (doi) parts.push(`doi:${doi}`);
  return parts.join(" ");
}

/** BibTeX 條目。key 用 PMID，沒有 PMID 才退回標題衍生的 slug。 */
export function toBibTeX(item: Item): string {
  const key =
    item.pmid ??
    item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) ??
    "review";
  const doi = doiOf(item);
  const fields: [string, string | number][] = [
    ["title", `{${escapeBibTeX(item.title.trim())}}`],
  ];
  const journal = journalOf(item);
  if (journal) fields.push(["journal", `{${escapeBibTeX(journal)}}`]);
  if (item.year) fields.push(["year", item.year]);
  if (doi) fields.push(["doi", `{${doi}}`]);
  if (item.pmid) fields.push(["pmid", `{${item.pmid}}`]);
  fields.push(["url", `{${item.freeUrl || item.url}}`]);
  const body = fields.map(([k, v]) => `  ${k} = ${v},`).join("\n");
  return `@article{pmid${key},\n${body}\n}`;
}

/**
 * 複製到剪貼簿。navigator.clipboard 需要安全來源，
 * 在 http 的區網預覽下會失敗，因此保留 execCommand 後路。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到後路 */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
