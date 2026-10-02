// 機器摘要的數字查證：摘要裡每個數字都要在來源（摘要原文＋標題）找到「完整的數值」。
//
// 不能用子字串比對——來源的 115 會替 15 背書、11.5 會替 1.5 背書、0.15 會替 15 背書。
// 但要容許模型把小數截短（14.8 寫成 14、1.55 寫成 1.5），否則正常的摘要也會被大量丟棄。

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 回傳摘要中在來源找不到完整數值依據的數字（空陣列＝全部查得到）。 */
export function unsupportedNumbers(text, source) {
  const missing = [];
  for (const num of String(text ?? "").match(/\d+(?:\.\d+)?/g) ?? []) {
    // 整數可被同整數部位的小數背書（14 ← 14.8）；小數可被更多位數背書（1.5 ← 1.55）。
    const tail = num.includes(".") ? "\\d*" : "(?:\\.\\d+)?";
    const pattern = new RegExp(`(?<!\\d|\\d\\.)${escape(num)}${tail}(?![\\d])`);
    if (!pattern.test(String(source ?? ""))) missing.push(num);
  }
  return missing;
}
