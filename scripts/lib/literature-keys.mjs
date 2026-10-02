// 文獻比對用的鍵與識別碼。
//
// 標題正規化可以吸收標點與大小寫差異，但「Concussion」「Editorial」這類短標題會撞到不同文獻；
// 兩筆標題相同、卻各自帶著不同的 DOI 或 PMID 時，必須當成兩篇。

export const titleKey = (title) => String(title ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function doiOf(url) {
  const m = String(url ?? "").match(/(?:doi\.org\/|\/doi\/(?:abs|full|pdf)\/)(10\.\d{4,9}\/\S+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/[).]+$/, "");
  } catch {
    return m[1].replace(/[).]+$/, "");
  }
}

function identifiersOf(item) {
  const doi = doiOf(item?.url);
  return { pmid: item?.pmid ? String(item.pmid) : null, doi: doi ? doi.toLowerCase() : null };
}

/** 兩筆都有同一種識別碼且值不同 → 確定不是同一篇。缺識別碼不算衝突。 */
export function identifiersConflict(a, b) {
  const x = identifiersOf(a);
  const y = identifiersOf(b);
  return Boolean((x.pmid && y.pmid && x.pmid !== y.pmid) || (x.doi && y.doi && x.doi !== y.doi));
}
