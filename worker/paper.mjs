import { XMLParser } from 'fast-xml-parser';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { remoteBytes, remoteJSON } from './http.mjs';
import { collectCandidates, fetchCandidatePDF, classifyAttempt, acquisitionFailure, MAX_CANDIDATES } from './sources.mjs';
import { runProcess } from './process.mjs';
import { parseJATS, normalizedTitle, MAX_XML_BYTES, XML_EXTRACTION_VERSION } from './xml.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const S3 = 'https://pmc-oa-opendata.s3.amazonaws.com';
const array = value => value ? Array.isArray(value) ? value : [value] : [];
export { normalizedTitle } from './xml.mjs';
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
  const isManuscript = value => value === true || value === 'yes';
  const published = versions.filter(x => !isManuscript(x.is_manuscript) && (x.pdf_url || x.xml_url));
  const candidates = published.length ? published : versions.filter(x => x.pdf_url || x.xml_url);
  // PMC explicitly states that the largest numeric version need not be preferred.
  if (candidates.length > 1) throw new Error('PMC 有多個可用全文版本，需先確認欲使用的版本');
  const chosen = candidates[0];
  if (!chosen) throw new Error('文章已撤回或全文識別資料不符');
  return { id: `pmc:${pmcid}`, pmcid, pmid: String(chosen.pmid ?? ''), doi: chosen.doi, title: chosen.title,
    citation: chosen.citation, license: chosen.license_code ?? null, version: chosen.version,
    manuscript: chosen.is_manuscript, pdfUrl: httpsS3(chosen.pdf_url), xmlUrl: httpsS3(chosen.xml_url),
    sourceUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`, provider: 'PMC', checkedAt: new Date().toISOString() };
}

// requireFullText=false resolves identity only, for checking an owner-supplied PDF.
export async function resolvePaper(input, { email = process.env.REVIEW_CONTACT_EMAIL, title, signal, getJSON = remoteJSON, getBytes = remoteBytes, requireFullText = true } = {}) {
  const identifier = parseIdentifier(input);
  let ids = { [identifier.kind]: identifier.value };
  let conversionError;
  if (!ids.pmcid) {
    const url = new URL('https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/');
    url.search = new URLSearchParams({ ids: identifier.value, idtype: identifier.kind, format: 'json', tool: 'sportsmedicine-review', ...(email ? { email } : {}) });
    try {
      const data = await getJSON(url, { signal });
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
      const pubmed = await getBytes(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.pmid}&retmode=xml`, { signal, maxBytes: 2000000 });
      const article = parser.parse(pubmed.bytes.toString()).PubmedArticleSet?.PubmedArticle;
      ids.doi = array(article?.PubmedData?.ArticleIdList?.ArticleId).find(x => x['@_IdType'] === 'doi')?.['#text'];
    }
    if (!ids.doi) throw conversionError ?? new Error('未找到可取得的 PMC 全文或 DOI');
    const { candidates, metadata, indexErrors } = await collectCandidates(ids.doi, { email, signal, getJSON });
    if (!candidates.length && requireFullText) {
      const failure = acquisitionFailure([], { indexUnavailable: indexErrors.length === (email ? 3 : 2) });
      throw Object.assign(new Error(failure.message), { failureCode: failure.code });
    }
    if (!metadata.title) throw new Error('公開全文索引沒有提供文獻標題，無法核對身分');
    const first = candidates[0] ?? {};
    paper = { id: `doi:${ids.doi}`, doi: ids.doi, pmid: ids.pmid ?? null, title: metadata.title, year: metadata.year,
      authors: metadata.authors ?? [], journal: metadata.journal,
      citation: `${metadata.title}. ${metadata.journal ?? ''}. ${metadata.year ?? ''}. doi:${ids.doi}`,
      license: first.license ?? null, version: first.version ?? null, pdfUrl: first.pdfUrl ?? null,
      sourceUrl: first.landingUrl ?? `https://doi.org/${ids.doi}`, provider: first.provider,
      candidates: candidates.slice(0, MAX_CANDIDATES), checkedAt: new Date().toISOString() };
  }
  if (title && normalizedTitle(title) !== normalizedTitle(paper.title)) throw new Error('索引標題與取得的文獻不一致，請以 DOI／PMID 重新核對');
  if (requireFullText && !paper.pdfUrl && !paper.xmlUrl && !paper.candidates?.length) throw new Error('沒有可取得的 PDF 或 XML 全文');
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

// Resume from verified original files. Derived JSON is a convenience export,
// never the authority for source text or evidence locators.
export async function loadPaper(directory, { signal } = {}) {
  signal?.throwIfAborted();
  const metadataFile = path.join(directory, 'source.json');
  const paper = JSON.parse(await readFile(metadataFile, 'utf8'));
  if (paper.fullTextVerified !== true) throw new Error('全文尚未完成來源核對，請先執行 prepare');
  const hash = value => createHash('sha256').update(value).digest('hex');
  let structured, text = '', xmlFile = null, pdfFile = null, textFile = null;
  if (paper.xmlAvailable === true) {
    xmlFile = path.join(directory, 'paper.xml');
    const bytes = await readFile(xmlFile);
    if (!paper.xmlSha256 || hash(bytes) !== paper.xmlSha256) throw new Error('XML 原始檔雜湊不符，請重新取得全文');
    structured = parseJATS(new TextDecoder('utf-8', { fatal: true }).decode(bytes), paper);
  }
  // Earlier PDF-only jobs predate the acquisition flags and text checksum.
  if (paper.pdfAvailable === true || (paper.pdfAvailable === undefined && paper.sha256)) {
    pdfFile = path.join(directory, 'paper.pdf');
    const bytes = await readFile(pdfFile);
    if (!paper.sha256 || hash(bytes) !== paper.sha256) throw new Error('PDF 原始檔雜湊不符，請重新取得全文');
    if (paper.textSha256) {
      textFile = path.join(directory, 'paper.txt');
      text = await readFile(textFile, 'utf8');
      if (hash(text) !== paper.textSha256) throw new Error('PDF 文字檔雜湊不符，請重新取得全文');
    } else {
      text = (await runProcess('pdftotext', ['-enc', 'UTF-8', pdfFile, '-'], { signal })).stdout;
    }
    verifyPDF(bytes, text, paper);
  }
  signal?.throwIfAborted();
  if (!structured && !text) throw new Error('全文沒有可核對的 XML 或 PDF，請先執行 prepare');
  return { paper, text, metadataFile, pdfFile, textFile, xmlFile,
    structuredText: structured?.structuredText ?? null, locators: structured?.locators ?? null };
}

// An owner-supplied PDF passes the same identity checks as a downloaded one.
// It carries no inferred licence or public URL: the owner obtained it privately.
export async function importManualPaper(paper, directory, bytes, upload, { signal, extractPDF = async (file, options) => (await runProcess('pdftotext', ['-enc', 'UTF-8', file, '-'], options)).stdout } = {}) {
  signal?.throwIfAborted();
  const hash = value => createHash('sha256').update(value).digest('hex');
  if (bytes.length !== upload.size || hash(bytes) !== upload.sha256) throw new Error('上傳檔案雜湊不符，請重新上傳 PDF');
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('上傳的檔案不是 PDF');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadataFile = path.join(directory, 'source.json'), pdfFile = path.join(directory, 'paper.pdf'), textFile = path.join(directory, 'paper.txt');
  const temporary = path.join(directory, 'paper.upload.pdf');
  await writeFile(temporary, bytes, { mode: 0o600 });
  const text = await extractPDF(temporary, { signal });
  try { verifyPDF(bytes, text, paper); }
  catch (error) {
    await rm(temporary, { force: true });
    throw Object.assign(new Error(`上傳的 PDF 未通過文獻核對：${error.message}。請確認上傳的是這篇文獻的正式全文。`), { failureCode: 'FULLTEXT_MANUAL_MISMATCH' });
  }
  await rename(temporary, pdfFile); await writeFile(textFile, text, { mode: 0o600 });
  const { candidates, acquisitionAttempts, xmlUrl, ...identity } = paper;
  for (const field of ['xmlSha256', 'xmlError', 'xmlDownloadedAt', 'xmlExtractionVersion', 'pdfError']) delete identity[field];
  const verified = { ...identity, provider: '手動上傳', license: null, version: null, pdfUrl: null, xmlUrl: null,
    sourceUrl: paper.doi ? `https://doi.org/${paper.doi}` : paper.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` : null,
    manualUpload: upload, fullTextAvailable: true, fullTextVerified: true, fullTextFormat: 'pdf', pdfAvailable: true, pdfStatus: 'available',
    xmlAvailable: false, xmlStatus: 'unavailable', sha256: hash(bytes), textSha256: hash(text), textExtractionVersion: 1, downloadedAt: upload.uploadedAt };
  await writeFile(metadataFile, JSON.stringify(verified, null, 2), { mode: 0o600 });
  return { paper: verified, text, pdfFile, textFile, metadataFile, structuredText: null, locators: null, xmlFile: null, structuredFile: null };
}

export async function downloadPaper(paper, directory, { signal, fetchBytes = remoteBytes, pause = ms => delay(ms, undefined, { signal }), extractPDF = async (file, options) => (await runProcess('pdftotext', ['-enc', 'UTF-8', file, '-'], options)).stdout } = {}) {
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadataFile = path.join(directory, 'source.json'), pdfFile = path.join(directory, 'paper.pdf'), textFile = path.join(directory, 'paper.txt');
  const xmlFile = path.join(directory, 'paper.xml'), structuredFile = path.join(directory, 'paper-structured.json');
  const hash = value => createHash('sha256').update(value).digest('hex');
  let old = {}; try { old = JSON.parse(await readFile(metadataFile, 'utf8')); } catch {}
  let text = '', xml, structured, pdfBytes, cachedXML = false, cachedPDF = false;
  const { candidates: listed, ...paperFields } = paper;
  // PMC and older jobs carry one pdfUrl; DOI lookups carry an ordered OA candidate list.
  const candidates = (listed ?? (paper.pdfUrl ? [{ pdfUrl: paper.pdfUrl, landingUrl: paper.sourceUrl, provider: paper.provider, license: paper.license, version: paper.version }] : [])).slice(0, MAX_CANDIDATES);
  const attempts = [];
  const verified = { ...paperFields, fullTextAvailable: false, pdfAvailable: false, xmlAvailable: false,
    pdfStatus: 'unavailable', xmlStatus: 'unavailable', fullTextVerified: false };
  // Never inherit successful acquisition fields from a previous attempt/source.
  for (const field of ['sha256', 'xmlSha256', 'textSha256', 'pdfError', 'xmlError', 'downloadedAt', 'xmlDownloadedAt', 'textExtractionVersion', 'xmlExtractionVersion', 'acquisitionAttempts']) delete verified[field];
  if (paper.xmlUrl) {
    try {
      const xmlURL = httpsS3(paper.xmlUrl);
      if (old.id === paper.id && old.xmlUrl === paper.xmlUrl && old.xmlSha256 && old.xmlExtractionVersion === XML_EXTRACTION_VERSION) {
        try { const cached = await readFile(xmlFile); if (hash(cached) === old.xmlSha256) { xml = cached; cachedXML = true; } } catch {}
      }
      if (!xml) {
        const downloaded = await fetchBytes(xmlURL, { signal, maxBytes: MAX_XML_BYTES });
        // Redirects retain the standard HTTP/DNS checks, and XML remains official.
        if (downloaded.url) httpsS3(downloaded.url);
        xml = downloaded.bytes;
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(xml);
      structured = parseJATS(decoded, paper);
      await writeFile(xmlFile, xml, { mode: 0o600 });
      await writeFile(structuredFile, JSON.stringify(structured, null, 2), { mode: 0o600 });
      Object.assign(verified, { xmlAvailable: true, xmlStatus: 'available', xmlSha256: hash(xml), xmlExtractionVersion: XML_EXTRACTION_VERSION, xmlDownloadedAt: cachedXML ? old.xmlDownloadedAt : new Date().toISOString() });
    } catch (error) {
      signal?.throwIfAborted();
      structured = undefined;
      verified.xmlStatus = /XML|PMC|DTD|entity|include|decode/i.test(error.message) ? 'rejected' : 'unavailable';
      verified.xmlError = error.message.slice(0, 600);
    }
  } else verified.xmlError = '來源沒有提供 XML 全文';
  const sourceFields = candidate => ({ pdfUrl: candidate.pdfUrl, license: candidate.license ?? null, version: candidate.version ?? null,
    provider: candidate.provider ?? paper.provider, sourceUrl: candidate.landingUrl ?? candidate.pdfUrl ?? paper.sourceUrl });
  const cachedCandidate = old.id === paper.id && old.sha256 && old.textExtractionVersion === 1 && candidates.some(c => c.pdfUrl === old.pdfUrl || c.landingUrl === old.sourceUrl);
  if (cachedCandidate) {
    try {
      const cached = await readFile(pdfFile), cachedText = await readFile(textFile, 'utf8');
      if (hash(cached) === old.sha256 && (!old.textSha256 || hash(cachedText) === old.textSha256)) {
        verifyPDF(cached, cachedText, paper); pdfBytes = cached; text = cachedText; cachedPDF = true;
        Object.assign(verified, { pdfUrl: old.pdfUrl, license: old.license ?? null, version: old.version ?? null, provider: old.provider, sourceUrl: old.sourceUrl });
      }
    } catch {}
  }
  for (const [index, candidate] of candidates.entries()) {
    if (pdfBytes) break;
    signal?.throwIfAborted();
    if (index) await pause(1000);
    const target = candidate.pdfUrl ?? candidate.landingUrl;
    try {
      const { bytes, url } = await fetchCandidatePDF(candidate, { fetchBytes, signal });
      const temporary = path.join(directory, 'paper.download.pdf');
      await writeFile(temporary, bytes, { mode: 0o600 });
      const extracted = await extractPDF(temporary, { signal });
      verifyPDF(bytes, extracted, paper);
      await rename(temporary, pdfFile); await writeFile(textFile, extracted, { mode: 0o600 });
      pdfBytes = bytes; text = extracted;
      // Licence, version and source must describe the source actually used.
      Object.assign(verified, sourceFields({ ...candidate, pdfUrl: url }));
      attempts.push({ host: new URL(target).hostname, provider: candidate.provider ?? null, kind: 'ok' });
    } catch (error) {
      signal?.throwIfAborted();
      const host = new URL(target).hostname, kind = classifyAttempt(error, host);
      attempts.push({ host, provider: candidate.provider ?? null, kind, detail: error.status ? `HTTP ${error.status}` : kind });
      verified.pdfStatus = kind === 'identity' || kind === 'not_pdf' ? 'rejected' : 'unavailable';
      verified.pdfError = error.message.slice(0, 600);
    }
  }
  if (pdfBytes) {
    Object.assign(verified, { pdfAvailable: true, pdfStatus: 'available', sha256: hash(pdfBytes), textSha256: hash(text), textExtractionVersion: 1, downloadedAt: cachedPDF ? old.downloadedAt : new Date().toISOString() });
    delete verified.pdfError;
  } else { text = ''; if (!candidates.length) verified.pdfError = '全文可讀，但來源沒有提供可下載的 PDF'; }
  if (attempts.length) verified.acquisitionAttempts = attempts;
  verified.fullTextAvailable = verified.pdfAvailable || verified.xmlAvailable;
  verified.fullTextVerified = verified.fullTextAvailable;
  verified.fullTextFormat = verified.xmlAvailable ? 'xml' : verified.pdfAvailable ? 'pdf' : null;
  await writeFile(metadataFile, JSON.stringify(verified, null, 2), { mode: 0o600 });
  if (!verified.fullTextAvailable) {
    if (candidates.length) {
      const failure = acquisitionFailure(attempts);
      const xmlNote = paper.xmlUrl ? ` XML：${verified.xmlError}` : '';
      throw Object.assign(new Error(`${failure.message}${xmlNote}`), { source: verified, failureCode: failure.code });
    }
    throw Object.assign(new Error(`未取得可驗證全文。XML：${verified.xmlError}；PDF：${verified.pdfError}`), { source: verified });
  }
  return { paper: verified, text, pdfFile: verified.pdfAvailable ? pdfFile : null, textFile: verified.pdfAvailable ? textFile : null, metadataFile,
    structuredText: structured?.structuredText ?? null, locators: structured?.locators ?? null,
    xmlFile: verified.xmlAvailable ? xmlFile : null, structuredFile: verified.xmlAvailable ? structuredFile : null };
}
