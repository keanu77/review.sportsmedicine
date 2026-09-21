import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const XML_EXTRACTION_VERSION = 1;
export const MAX_XML_BYTES = 8 * 1024 * 1024;
export const normalizedTitle = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, processEntities: false,
  parseTagValue: false, trimValues: false, cdataPropName: '#cdata' });
const tag = node => Object.keys(node).find(key => key !== ':@');
const children = node => Array.isArray(node?.[tag(node)]) ? node[tag(node)] : [];
const direct = (node, name) => children(node).filter(child => tag(child) === name);
const one = (node, name) => direct(node, name)[0];
const attribute = (node, name) => node?.[':@']?.[`@_${name}`];
const tidy = text => text.replace(/\s+/gu, ' ').trim();
const block = new Set(['p', 'title', 'label', 'caption', 'fn', 'list-item', 'def-item', 'break', 'tr']);

function decodeXML(value) {
  return value.replace(/&([^;\s]+);/g, (entity, name) => {
    const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, name)) return predefined[name];
    if (!/^#(?:\d+|x[\da-f]+)$/i.test(name)) throw new Error('XML 含有不允許的 entity 參照');
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (!(point === 9 || point === 10 || point === 13 || (point >= 32 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff))) throw new Error('XML 字元參照無效');
    return String.fromCodePoint(point);
  });
}

function plain(node, skip = new Set()) {
  const name = tag(node);
  if (skip.has(name)) return '';
  if (name === '#text') return decodeXML(String(node[name]));
  if (name === '#cdata') return children(node).map(part => String(part['#text'] ?? '')).join('');
  const text = children(node).map(child => plain(child, skip)).join('');
  return block.has(name) ? ` ${text} ` : text;
}
const content = node => node ? tidy(plain(node)) : '';
function descendants(node, name) {
  return children(node).flatMap(child => tag(child) === name ? [child] : descendants(child, name));
}

// External JATS DOCTYPE headers are inert metadata: remove, never resolve them.
// Internal subsets/custom entities and XInclude are rejected before parsing.
function safeDocument(input) {
  if (Buffer.byteLength(input) > MAX_XML_BYTES) throw new Error('XML 全文超過大小限制');
  let xml = String(input).replace(/^\uFEFF/, '');
  if (/<!ENTITY\b/i.test(xml) || /http:\/\/www\.w3\.org\/2001\/XInclude/i.test(xml)) throw new Error('XML 不允許 entity 或外部 include');
  const declaration = /<!DOCTYPE\s+article\s+(?:PUBLIC\s+(?:"[^"<>\[\]]*"|'[^'<>\[\]]*')\s+|SYSTEM\s+)(?:"[^"<>\[\]]*"|'[^'<>\[\]]*')\s*>/g;
  const declarations = xml.match(declaration) ?? [];
  if (declarations.length > 1) throw new Error('XML 含有多個 DTD 宣告');
  xml = xml.replace(declaration, '');
  if (/<!DOCTYPE\b/i.test(xml)) throw new Error('XML 不允許內部 DTD 或無效 DTD 宣告');
  const withoutComments = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(withoutComments)) throw new Error('XML 含有不允許的 entity 參照');
  decodeXML(withoutComments);
  let depth = 0, count = 0;
  for (const match of withoutComments.matchAll(/<\/?[A-Za-z_][^>]*>/g)) {
    if (++count > 100000) throw new Error('XML 節點數超過限制');
    if (match[0].startsWith('</')) depth--;
    else if (!match[0].endsWith('/>') && ++depth > 100) throw new Error('XML 巢狀深度超過限制');
  }
  if (XMLValidator.validate(xml) !== true) throw new Error('XML 格式不完整或無效');
  return xml;
}

function tableData(node) {
  const tables = descendants(node, 'table');
  if (tables.length > 1) throw new Error('XML 含有無法明確定位的巢狀／多重表格');
  const occupied = [], rows = [];
  for (const rowNode of tables[0] ? descendants(tables[0], 'tr') : []) {
    const row = rows.length + 1, cells = []; let column = 1;
    for (const cell of children(rowNode).filter(child => ['td', 'th'].includes(tag(child)))) {
      while ((occupied[column] ?? 0) >= row) column++;
      const rowSpan = Number(attribute(cell, 'rowspan') ?? 1), colSpan = Number(attribute(cell, 'colspan') ?? 1);
      if (![rowSpan, colSpan].every(n => Number.isInteger(n) && n >= 1 && n <= 100)) throw new Error('XML 表格欄列跨度無效');
      for (let offset = 0; offset < colSpan; offset++) {
        if ((occupied[column + offset] ?? 0) >= row) throw new Error('XML 表格欄列重疊');
        occupied[column + offset] = row + rowSpan - 1;
      }
      cells.push({ column, rowSpan, colSpan, header: tag(cell) === 'th', text: content(cell) });
      column += colSpan;
    }
    rows.push({ row, cells });
  }
  const label = content(one(node, 'label')), caption = content(one(node, 'caption'));
  const footnotes = direct(node, 'table-wrap-foot').map(content).filter(Boolean);
  const machineReadable = rows.some(row => row.cells.some(cell => cell.text));
  const text = [label, caption, ...rows.map(({ row, cells }) => `Row ${row}: ${cells.map(cell => `C${cell.column}${cell.header ? ' (header)' : ''}${cell.rowSpan > 1 || cell.colSpan > 1 ? ` [rowspan=${cell.rowSpan}, colspan=${cell.colSpan}]` : ''}: ${cell.text}`).join(' | ')}`), ...footnotes.map(note => `Footnotes: ${note}`), ...(!machineReadable ? ['[machineReadable=false; table cells are unavailable; do not infer values from the caption]'] : [])].filter(Boolean).join('\n');
  return { label, caption, rows, footnotes, text, machineReadable };
}

export function parseJATS(input, expected) {
  const document = parser.parse(safeDocument(input));
  const roots = document.filter(node => !tag(node).startsWith('?') && tag(node) !== '#text');
  if (roots.length !== 1 || tag(roots[0]) !== 'article') throw new Error('XML 不是單篇 JATS article');
  const article = roots[0], front = one(article, 'front'), meta = front && one(front, 'article-meta');
  if (direct(article, 'front').length !== 1 || direct(front, 'article-meta').length !== 1 || direct(meta, 'title-group').length !== 1 || direct(one(meta, 'title-group'), 'article-title').length !== 1 || direct(article, 'body').length !== 1) throw new Error('XML 缺少唯一的文章 metadata／正文');
  const titleGroup = meta && one(meta, 'title-group'), title = content(titleGroup && one(titleGroup, 'article-title'));
  if (!expected?.title || !title || normalizedTitle(title) !== normalizedTitle(expected.title)) throw new Error('XML 標題與目標文獻不符');
  if (!expected.doi && !expected.pmcid) throw new Error('XML 缺少可核對的 DOI／PMCID');
  const identifiers = {};
  for (const name of ['doi', 'pmcid', 'pmid']) {
    const nodes = direct(meta, 'article-id').filter(node => name === 'pmcid' ? ['pmcid', 'pmc'].includes(attribute(node, 'pub-id-type')) : attribute(node, 'pub-id-type') === name);
    const normalize = value => name === 'pmcid' ? value.toUpperCase().replace(/^(?:PMC)?(\d+)$/, 'PMC$1') : value.toLowerCase();
    const values = [...new Set(nodes.map(node => normalize(content(node))))];
    if (values.length > 1 || (expected[name] && values[0] !== normalize(String(expected[name])))) throw new Error(`XML ${name.toUpperCase()} 與目標文獻不符`);
    identifiers[name] = values[0] ?? null;
  }
  const body = one(article, 'body');
  if (!body || content(body).length < 300) throw new Error('XML 沒有可用正文，不能以摘要代替全文');
  const ids = new Set();
  const checkIDs = node => {
    if (tag(node) === '#cdata') return;
    const id = attribute(node, 'id');
    if (id) {
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]{0,159}$/.test(id) || ids.has(id)) throw new Error('XML 含有重複或無效的定位 ID');
      ids.add(id);
    }
    // Decode every text node, even outside extracted paragraphs; unknown entities
    // cannot be hidden in metadata and later interpreted by another consumer.
    if (tag(node) === '#text') decodeXML(String(node['#text']));
    children(node).forEach(checkIDs);
  };
  checkIDs(article);
  const locators = Object.create(null), order = []; let generated = 0;
  function add(node, kind, section, text, extra = {}) {
    if (!text) return;
    let id = attribute(node, 'id');
    if (!id) { do { id = `jats-${kind}-${++generated}`; } while (ids.has(id)); ids.add(id); }
    const locator = `xml:${id}`;
    locators[locator] = { kind, section, text, ...extra }; order.push(locator);
  }
  function walk(node, section) {
    const name = tag(node);
    if (['sec', 'abstract'].includes(name)) {
      const heading = content(one(node, 'title')) || (name === 'abstract' ? 'Abstract' : '');
      if (heading) section = [...section, heading];
    }
    if (name === 'table-wrap') { const table = tableData(node); add(node, 'table', section, table.text, { table }); return; }
    if (name === 'fig') { add(node, 'figure-caption', section, content(node)); return; }
    if (name === 'p') {
      add(node, 'paragraph', section, tidy(plain(node, new Set(['table-wrap', 'fig']))));
      for (const embedded of children(node).filter(child => ['table-wrap', 'fig'].includes(tag(child)))) walk(embedded, section);
      return;
    }
    for (const child of children(node)) walk(child, section);
  }
  direct(meta, 'abstract').forEach(abstract => walk(abstract, []));
  walk(body, ['Body']);
  direct(article, 'floats-group').forEach(floats => walk(floats, ['Tables and figures']));
  if (!order.length) throw new Error('XML 未找到可定位的正文段落／表格');
  const structuredText = order.map(locator => `[${locator}]\nSection: ${locators[locator].section.join(' > ')}\n${locators[locator].text}`).join('\n\n');
  return { extractionVersion: XML_EXTRACTION_VERSION, identity: { title, ...identifiers }, structuredText, locators };
}

// Legacy callers can pass a PDF string; XML-only sources never acquire p:N pages.
export function evidenceAt(source, locator) {
  if (typeof source === 'string') source = { text: source };
  if (/^xml:[A-Za-z_][A-Za-z0-9_.:-]*$/.test(locator) && Object.hasOwn(source?.locators ?? {}, locator)) return source.locators[locator].text;
  const page = /^p:([1-9]\d*)$/.exec(locator);
  return page && source?.text ? source.text.split('\f')[Number(page[1]) - 1] : undefined;
}

export function analysisText(source) {
  if (source.structuredText && source.locators && Object.keys(source.locators).length) return { text: source.structuredText, labelled: source.structuredText, format: 'XML', locatorInstruction: 'locator 使用原文列出的 xml:ID（段落或表格），不得捏造 PDF 頁碼' };
  if (!source.text) throw new Error('沒有已核對的可讀全文');
  return { text: source.text, labelled: source.text.split('\f').map((text, index) => `[p:${index + 1}]\n${text}`).join('\n'), format: 'PDF', locatorInstruction: 'locator 嚴格使用 p:1 等頁碼，引用必須存在於該頁' };
}
