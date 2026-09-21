import { XMLParser } from 'fast-xml-parser';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { remoteBytes, remoteJSON } from './http.mjs';
import { runProcess } from './process.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const S3 = 'https://pmc-oa-opendata.s3.amazonaws.com';
const array = value => value ? Array.isArray(value) ? value : [value] : [];
export const normalizedTitle = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function parseIdentifier(value) {
  let input = String(value).trim();
  if (/^https:\/\/(?:dx\.)?doi\.org\//i.test(input)) input = decodeURIComponent(new URL(input).pathname.slice(1));
  else if (/^https:\/\/(?:pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov)\//i.test(input)) {
    const url = new URL(input); input = url.pathname.match(/PMC\d+/i)?.[0] ?? url.pathname.match(/^\/(\d+)\/?$/)?.[1] ?? '';
  }
  input = input.replace(/^doi:\s*/i, '');
  if (/^PMC\d+$/i.test(input)) return { kind: 'pmcid', value: input.toUpperCase() };
  if (/^(?:PMID:\s*)?\d{1,9}$/i.test(input)) return { kind: 'pmid', value: input.replace(/^PMID:\s*/i, '') };
  if (/^10\.\d{4,9}\/[^\s<>"#?]+$/i.test(input) && input.length <= 250) return { kind: 'doi', value: input.toLowerCase() };
  throw new Error('請提供 DOI、PMID 或 PMCID；不接受任意下載網址');
}

function httpsS3(value) {
  if (!value) return null;
  if (value.startsWith('s3://pmc-oa-opendata/')) return value.replace('s3://pmc-oa-opendata', S3);
  if (value.startsWith(`${S3}/`)) return value;
  throw new Error('PMC metadata 含有非官方檔案來源');
}

async function pmcPaper(pmcid, expected, signal) {
  const result = await remoteBytes(`${S3}/?list-type=2&prefix=${encodeURIComponent(`metadata/${pmcid}.`)}&max-keys=30`, { signal, maxBytes: 256000 });
  const listing = parser.parse(result.bytes.toString());
  const keys = array(listing.ListBucketResult?.Contents).map(x => x.Key).filter(key => new RegExp(`^metadata/${pmcid}\\.\\d+\\.json$`).test(key));
  if (!keys.length) return null;
  const versions = [];
  for (const key of keys.slice(0, 12)) {
    const metadata = await remoteJSON(`${S3}/${key}`, { signal });
    if (metadata.pmcid !== pmcid) throw new Error('PMC 文獻身分不符');
    if (expected.doi && metadata.doi?.toLowerCase() !== expected.doi.toLowerCase()) continue;
    if (expected.pmid && String(metadata.pmid) !== String(expected.pmid)) continue;
    if (!metadata.is_retracted) versions.push(metadata);
  }
  const published = versions.filter(x => !x.is_manuscript && x.pdf_url);
  const candidates = published.length ? published : versions.filter(x => x.pdf_url);
  // PMC explicitly states that the largest numeric version need not be preferred.
  if (candidates.length > 1) throw new Error('PMC 有多個可用全文版本，需先確認欲使用的版本');
  const chosen = candidates[0] ?? versions[0];
  if (!chosen) throw new Error('文章已撤回或全文識別資料不符');
  return { id: `pmc:${pmcid}`, pmcid, pmid: String(chosen.pmid ?? ''), doi: chosen.doi, title: chosen.title,
    citation: chosen.citation, license: chosen.license_code ?? null, version: chosen.version,
    manuscript: chosen.is_manuscript, pdfUrl: httpsS3(chosen.pdf_url), xmlUrl: httpsS3(chosen.xml_url),
    sourceUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`, provider: 'PMC', checkedAt: new Date().toISOString() };
}

export async function resolvePaper(input, { email = process.env.REVIEW_CONTACT_EMAIL, title, signal } = {}) {
  const identifier = parseIdentifier(input);
  let ids = { [identifier.kind]: identifier.value };
  let conversionError;
  if (!ids.pmcid) {
    const url = new URL('https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/');
    url.search = new URLSearchParams({ ids: identifier.value, idtype: identifier.kind, format: 'json', tool: 'sportsmedicine-review', ...(email ? { email } : {}) });
    try {
      const data = await remoteJSON(url, { signal });
      const record = data.records?.[0];
      if (record?.pmcid) {
        if (ids.doi && record.doi?.toLowerCase() !== ids.doi.toLowerCase()) throw new Error('ID 轉換結果 DOI 與原始輸入不符');
        if (ids.pmid && String(record.pmid) !== ids.pmid) throw new Error('ID 轉換結果 PMID 與原始輸入不符');
        ids = { pmcid: record.pmcid, doi: record.doi, pmid: record.pmid, ...ids };
      }
    } catch (error) { if (signal?.aborted) throw error; conversionError = error; }
  }
  let paper;
  if (ids.pmcid) paper = await pmcPaper(ids.pmcid, ids, signal);
  if (!paper) {
    if (!ids.doi && ids.pmid) {
      const pubmed = await remoteBytes(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.pmid}&retmode=xml`, { signal, maxBytes: 2000000 });
      const article = parser.parse(pubmed.bytes.toString()).PubmedArticleSet?.PubmedArticle;
      ids.doi = array(article?.PubmedData?.ArticleIdList?.ArticleId).find(x => x['@_IdType'] === 'doi')?.['#text'];
    }
    if (!ids.doi) throw conversionError ?? new Error('未找到可取得的 PMC 全文或 DOI');
    if (!email) throw new Error('此篇需使用 Unpaywall 查詢；請先設定 REVIEW_CONTACT_EMAIL');
    const data = await remoteJSON(`https://api.unpaywall.org/v2/${encodeURIComponent(ids.doi)}?email=${encodeURIComponent(email)}`, { signal });
    if (data.doi?.toLowerCase() !== ids.doi.toLowerCase()) throw new Error('DOI 全文來源身分不符');
    const location = [data.best_oa_location, ...array(data.oa_locations)].find(x => x?.url_for_pdf);
    if (!data.is_oa || !location) throw new Error('未找到已公開的 PDF；不能以摘要代替全文');
    paper = { id: `doi:${ids.doi}`, doi: ids.doi, pmid: ids.pmid ?? null, title: data.title, year: data.year,
      authors: array(data.z_authors).map(x => `${x.given ?? ''} ${x.family ?? ''}`.trim()), journal: data.journal_name,
      citation: `${data.title}. ${data.journal_name ?? ''}. ${data.year ?? ''}. doi:${ids.doi}`,
      license: location.license ?? null, version: location.version, pdfUrl: location.url_for_pdf,
      sourceUrl: location.url_for_landing_page ?? `https://doi.org/${ids.doi}`, provider: 'Unpaywall', checkedAt: new Date().toISOString() };
  }
  if (title && normalizedTitle(title) !== normalizedTitle(paper.title)) throw new Error('索引標題與取得的文獻不一致，請以 DOI／PMID 重新核對');
  if (!paper.pdfUrl) throw new Error('全文資料存在，但沒有可下載的 PDF');
  return paper;
}

export function verifyPDF(bytes, text, paper) {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下載內容不是 PDF，可能是登入頁或錯誤頁');
  const firstPage = text.split('\f')[0].split(/\breferences\b/i)[0];
  const front = normalizedTitle(firstPage.slice(0, 1600));
  if (!front.includes(normalizedTitle(paper.title))) throw new Error('PDF 中未核對到完整標題，請人工確認文獻身分');
  if (paper.doi && !firstPage.toLowerCase().replace(/\s+/g, '').includes(paper.doi.toLowerCase())) throw new Error('PDF 首頁未核對到 DOI，請人工確認文獻身分');
  if (text.trim().length < 300) throw new Error('PDF 無可用全文文字，需要 OCR 或人工處理');
}

export async function downloadPaper(paper, directory, { signal } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadataFile = path.join(directory, 'source.json'), pdfFile = path.join(directory, 'paper.pdf'), textFile = path.join(directory, 'paper.txt');
  try {
    const old = JSON.parse(await readFile(metadataFile, 'utf8'));
    if (old.id === paper.id && old.pdfUrl === paper.pdfUrl && old.sha256 && old.textExtractionVersion === 1) {
      const bytes = await readFile(pdfFile), text = await readFile(textFile, 'utf8');
      if (createHash('sha256').update(bytes).digest('hex') === old.sha256) { verifyPDF(bytes, text, old); return { paper: old, text, pdfFile, textFile, metadataFile }; }
    }
  } catch {}
  const { bytes } = await remoteBytes(paper.pdfUrl, { signal });
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('下載內容不是 PDF');
  const temporary = path.join(directory, 'paper.download.pdf');
  await writeFile(temporary, bytes, { mode: 0o600 });
  const { stdout: text } = await runProcess('pdftotext', ['-enc', 'UTF-8', temporary, '-'], { signal });
  verifyPDF(bytes, text, paper);
  const verified = { ...paper, sha256: createHash('sha256').update(bytes).digest('hex'), textExtractionVersion: 1, downloadedAt: new Date().toISOString(), fullTextVerified: true };
  await rename(temporary, pdfFile); await writeFile(textFile, text, { mode: 0o600 });
  await writeFile(metadataFile, JSON.stringify(verified, null, 2), { mode: 0o600 });
  return { paper: verified, text, pdfFile, textFile, metadataFile };
}
