// Browser-safe layout shared by the Mac renderer and the workbench live preview:
// page HTML, per-style CSS, geometry checks and text auto-fit. No Node APIs here.
export const PALETTES = {
  blue: ['#2563eb', '#eff6ff', '#bfdbfe'], cyan: ['#0891b2', '#ecfeff', '#a5f3fc'],
  emerald: ['#059669', '#ecfdf5', '#a7f3d0'], 'orange-light': ['#ea580c', '#fff7ed', '#fed7aa'],
  gold: ['#eab308', '#19180f', '#454021'], orange: ['#fb923c', '#201810', '#493020'],
  sky: ['#7dd3fc', '#101b23', '#253f50'],
  // 2026 trend palettes: [accent, surface, border, page background].
  sage: ['#4f7a5a', '#eef3ea', '#c6d6c1', '#fbf8f1'], coral: ['#d9485f', '#fff0ee', '#f5c2bc', '#fffaf8'],
  lavender: ['#7651c2', '#f3effc', '#d8cdf1', '#fcfbff'], mono: ['#111111', '#f2f2f2', '#cfcfcf', '#ffffff'],
  clash: ['#2438ff', '#e6ff4f', '#aab4ff', '#ffffff'],
};
export const STYLES = ['clinical', 'editorial', 'bold', 'contrast', 'notebook', 'journal', 'roadmap', 'seamless'];
export const IMAGE_STYLES = ['photo', 'illustration', 'flat', 'watercolor', 'film'];
export const FORMATS = { square: 1080, portrait: 1350, story: 1920 };
export const DARK = ['gold', 'orange', 'sky'];
// Readable text on a solid accent background (WCAG relative luminance).
const onAccent = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#111111' : '#ffffff';
};
export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A card titled "label + number" (e.g. 回歸比例99.3%) is shown as a large figure.
const NUM = '\\d+(?:\\.\\d+)?(?:%|％)?';
const STAT = new RegExp(`^(.{0,10}?)\\s*((?:約|<|>|≤|≥)?${NUM}(?:\\s*(?:–|—|-|~|～|至|到)\\s*${NUM})?\\s*(?:%|％|週|個月|年|天|倍|人|分|次|公斤|kg|cm|mm|歲)?)$`);
export function statParts(title) {
  const match = String(title).trim().match(STAT);
  return match && title.length <= 16 ? { label: match[1].trim(), value: match[2].replace(/\s+/g, '') } : null;
}
function cardHTML(card, i) {
  const stat = statParts(card.title);
  if (stat) return `<article class="card stat" data-check><div class="stat-value" data-check>${escape(stat.value)}</div><div class="card-copy">${stat.label ? `<h2 data-check>${escape(stat.label)}</h2>` : ''}<p data-check>${escape(card.body)}</p></div></article>`;
  return `<article class="card" data-check><div class="card-number" aria-hidden="true">${String(i + 1).padStart(2, '0')}</div><div class="card-copy"><h2 data-check>${escape(card.title)}</h2><p data-check>${escape(card.body)}</p></div></article>`;
}
// Outro pages end with the call to action, a QR code and the short disclaimer.
function outroHTML(outro, qr) {
  if (!outro) return '';
  const code = qr ? `<figure class="qr" data-check><div class="qr-code" aria-hidden="true">${qr}</div><figcaption data-check>${escape(outro.qr.label)}</figcaption></figure>` : '';
  const copy = [outro.cta && `<p class="cta" data-check>${escape(outro.cta)}</p>`, outro.disclaimer && `<p class="disclaimer" data-check>${escape(outro.disclaimer)}</p>`].filter(Boolean).join('');
  return `<div class="outro-extra" data-check>${code}${copy ? `<div class="outro-copy">${copy}</div>` : ''}</div>`;
}

export function buildHTML(manifest, page, { index = 0, image = null, wide = false, qr = null } = {}) {
  const d = manifest.design;
  const [accent, surface, border, background] = PALETTES[d.palette];
  const dark = DARK.includes(d.palette);
  const height = wide ? 630 : FORMATS[d.format];
  const total = manifest.pages.length;
  const position = page.imagePosition ?? {x:50,y:50};
  const contain = page.imageFit === 'contain';
  const figure = image ? `<figure class="figure${contain ? ' contain' : ''}" data-check><img src="${image.data}" alt="${escape(page.imageAlt ?? '')}" style="object-fit:${contain ? 'contain' : 'cover'};object-position:${Number(position.x)}% ${Number(position.y)}%">${page.caption ? `<figcaption data-check>${escape(page.caption)}</figcaption>` : ''}</figure>` : '';
  const cards = (page.cards ?? []).map(cardHTML).join('');
  const extra = !wide && page.layout === 'outro' ? outroHTML(manifest.outro, qr) : '';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;width:${wide ? 1200 : 1080}px;height:${height}px}body{font-family:'PingFang TC','Noto Sans TC','Heiti TC',-apple-system,BlinkMacSystemFont,sans-serif;color:${dark ? '#fafafa' : '#0f172a'};background:${dark ? '#0a0a0a' : background ?? '#ffffff'};-webkit-font-smoothing:antialiased}
  :root{--accent:${accent};--surface:${surface};--border:${border};--muted:${dark ? '#d4d4d8' : '#334155'};--on-accent:${onAccent(accent)};--ink:${dark ? '#fafafa' : '#0f172a'}}
  .canvas{width:100%;height:100%;padding:48px 60px 34px;display:grid;grid-template-rows:36px minmax(0,1fr) 42px;gap:26px;border-top:10px solid var(--accent)}
  .topbar,.footer{display:flex;align-items:center;justify-content:space-between;gap:20px}.topbar{font-size:20px;font-weight:700;color:var(--accent);letter-spacing:1px}.topbar span:last-child{color:var(--muted);font-size:18px;letter-spacing:0}.footer{border-top:1px solid var(--border);padding-top:14px;font-size:18px;color:var(--muted)}.footer .number{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--accent);font-weight:700}
  .body{min-height:0;display:flex;flex-direction:column;gap:24px}.heading{flex:none}h1,h2,p,figure{margin:0}h1{font-size:61px;line-height:1.22;letter-spacing:-1px;font-weight:800;white-space:pre-line;overflow-wrap:anywhere}.subtitle{font-size:29px;line-height:1.5;margin-top:15px;color:var(--muted);white-space:pre-line;overflow-wrap:anywhere}.cover h1{font-size:76px;line-height:1.17}.outro h1{font-size:69px}.cards{display:flex;flex-direction:column;gap:16px;flex:none}.card{display:flex;gap:20px;padding:23px 26px;background:var(--surface);border:1px solid var(--border);border-radius:18px}.card-number{font-size:24px;color:var(--accent);font-weight:700;padding-top:6px}.card-copy{min-width:0;flex:1}h2{font-size:31px;line-height:1.35;font-weight:750;white-space:pre-line;overflow-wrap:anywhere}.card p{font-size:27px;line-height:1.48;color:var(--muted);margin-top:7px;white-space:pre-line;overflow-wrap:anywhere}
  .figure{flex:1;min-height:220px;position:relative;border-radius:22px;overflow:hidden;background:var(--surface)}.figure.contain{background:#fff;border:1px solid var(--border)}.figure img{position:absolute;width:100%;height:100%;object-fit:cover;display:block}.figure figcaption{position:absolute;bottom:14px;left:16px;right:16px;width:fit-content;max-width:calc(100% - 32px);padding:5px 10px;border-radius:5px;background:#ffffffed;color:#334155;font-size:17px;line-height:1.4}.cover .figure{min-height:350px}.no-image.cover .body,.no-image.outro .body{justify-content:center}.no-image.cover h1{font-size:91px}.no-image.cover .subtitle{font-size:36px;max-width:900px}.no-image .cards{gap:22px}.no-image .card{padding:30px}.no-image .card p{font-size:30px;line-height:1.55}.no-image.content .heading{margin-bottom:18px}
  .editorial .canvas{border-top-width:0;padding-top:42px;grid-template-rows:40px minmax(0,1fr) 42px;gap:30px}.editorial .topbar{border-bottom:2px solid var(--accent);padding-bottom:16px}.editorial h1{font-weight:900;font-size:66px;letter-spacing:-2px}.editorial.cover h1{font-size:82px}.editorial .card{background:transparent;border:none;border-top:1px solid var(--border);border-radius:0;padding:18px 0}.editorial .card-number{font-size:33px;padding-top:0}.editorial .figure{border-radius:0}.editorial .subtitle{border-left:5px solid var(--accent);padding-left:20px}
  .wide .canvas{padding:34px 48px 28px;grid-template-rows:30px minmax(0,1fr) 35px;gap:22px}.wide .body{display:grid;grid-template-columns:${image ? '1fr 1fr' : '1fr'};gap:38px;align-items:center}.wide .heading{min-width:0}.wide h1,.wide.no-image.cover h1,.wide.editorial.cover h1{font-size:${image ? 61 : 78}px;line-height:1.2}.wide .subtitle{font-size:26px}.wide .figure{height:100%;min-height:0}.wide .footer{font-size:16px}.wide .topbar{font-size:18px}
  .body{padding-top:12px;padding-bottom:6px}.editorial .topbar{padding-bottom:0}
  .portrait .body{justify-content:center;gap:32px}.portrait h1{font-size:68px}.portrait .card p{font-size:30px}.portrait h2{font-size:34px}.portrait .figure{flex:none;height:440px}.story .canvas{padding:230px 150px 400px 72px}.story .body{justify-content:center;gap:40px}.story .topbar{font-size:24px}.story .footer{font-size:21px}.story h1{font-size:84px}.story.cover h1,.story.no-image.cover h1{font-size:96px}.story.outro h1{font-size:84px}.story .subtitle{font-size:38px}.story .cards{gap:26px}.story .card{padding:34px 36px}.story h2{font-size:46px}.story .card p{font-size:38px}.story .card-number{font-size:30px}.story .figure{flex:none;height:560px}
  .heading,.cards,.outro-extra{zoom:var(--fit,1)}h1{text-wrap:balance}.subtitle,.card p,.cta,.disclaimer{text-wrap:pretty}
  .card.stat{align-items:center;gap:26px}.stat-value{flex:none;font-size:66px;line-height:1;font-weight:900;color:var(--accent);letter-spacing:-1px;font-variant-numeric:tabular-nums;white-space:nowrap}.story .stat-value{font-size:84px}.contrast .card.stat{background:var(--surface);border:2px solid var(--accent);padding:22px 26px;gap:22px}.contrast .card.stat .card-copy{display:block;border:0}.contrast .card.stat h2{background:transparent;color:var(--ink);padding:0}.contrast .card.stat p{padding:0;background:transparent}.bold .stat-value{color:var(--surface)}
  .outro-extra{display:flex;align-items:center;gap:30px;flex:none}.qr{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px}.qr-code{width:210px;height:210px;padding:12px;background:#fff;border-radius:14px;border:1px solid var(--border)}.qr-code svg{display:block;width:100%;height:100%}.qr figcaption{font-size:20px;font-weight:700;color:var(--accent)}.outro-copy{min-width:0;display:flex;flex-direction:column;gap:14px}.cta{font-size:32px;line-height:1.4;font-weight:800;color:var(--ink);white-space:pre-line;overflow-wrap:anywhere}.disclaimer{font-size:23px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.bold .cta{color:var(--on-accent)}.story .qr-code{width:260px;height:260px}.story .cta{font-size:40px}.story .disclaimer{font-size:26px}.story .qr figcaption{font-size:26px}.story .outro-extra{flex-direction:column;align-items:flex-start}
  ${styleCSS(d.style, { wide, dark })}
  </style></head><body class="${escape(d.style)} ${escape(page.layout ?? 'cover')} ${image ? 'has-image' : 'no-image'} ${wide ? 'wide' : escape(d.format)}">${decoration(d.style, { index, total, wide, height })}<main class="canvas"><header class="topbar" data-region="header"><span data-check>${escape(manifest.title ?? '運動醫學')}</span><span data-check>${escape(d.brand)}</span></header><section class="body" data-region="body"><div class="heading" data-check><h1 data-check>${escape(page.title)}</h1>${page.subtitle ? `<p class="subtitle" data-check>${escape(page.subtitle)}</p>` : ''}</div>${cards ? `<div class="cards" data-check>${cards}</div>` : ''}${figure}${extra}</section><footer class="footer" data-region="footer"><span data-check>${escape(d.footer ?? '')}</span><span class="number" data-check>${wide ? 'SPORTS MEDICINE' : `${String(index + 1).padStart(2, '0')} / ${String(manifest.pages.length).padStart(2, '0')}`}</span></footer></main></body></html>`;
}

// Per-style rules layered on the base layout. Decorations are pseudo-elements or
// aria-hidden backgrounds outside the checked text regions.
function styleCSS(style, { wide, dark }) {
  const common = '';
  const rules = {
    bold: `body{background:var(--accent);color:var(--on-accent)}.bold{--muted:var(--on-accent)}.bold .canvas{border-top:0}.bold .topbar,.bold .topbar span:last-child,.bold .footer,.bold .footer .number{color:var(--on-accent);opacity:.9}.bold .footer{border-top-color:currentColor}
      .bold .heading{padding-top:12px}.bold h1{font-size:${wide ? 72 : 88}px;font-weight:900;letter-spacing:-2px;line-height:1.2}.bold.cover h1{font-size:${wide ? 80 : 112}px}.bold .subtitle{display:inline-block;background:var(--surface);color:var(--accent);padding:6px 16px;border-radius:6px;font-weight:700}
      .bold .card{background:transparent;border:0;border-top:3px solid var(--on-accent);border-radius:0;padding:20px 0}.bold .card-number{color:var(--surface);font-size:40px;font-weight:900;padding-top:0}.bold .card p{color:var(--on-accent);opacity:.92}.bold .no-image.content .heading{margin-bottom:10px}`,
    contrast: `.contrast .canvas{border-top:0}.contrast .card{padding:0;overflow:visible;border:0;background:transparent;gap:0;border-radius:18px}.contrast .card-number{display:none}
      .contrast .card-copy{display:grid;grid-template-columns:${wide ? '1fr' : '38% 1fr'};border-radius:18px;overflow:hidden;border:2px solid var(--accent)}.contrast .card h2{background:var(--accent);color:var(--on-accent);padding:22px 22px;font-size:29px}.contrast .card p{margin:0;padding:22px 24px;background:var(--surface);color:var(--ink)}
      .contrast.cover .heading,.contrast.outro .heading{border-left:18px solid var(--accent);padding-left:28px}.contrast.cover .subtitle{background:var(--surface);color:var(--ink);padding:12px 18px;border-radius:10px}`,
    notebook: `body{background:${dark ? '#1c1a16' : '#fbf7ec'} repeating-linear-gradient(transparent 0 58px,${dark ? '#3a3528' : '#e6dcc2'} 58px 60px)}.notebook .canvas{border-top:0;border-left:4px solid ${dark ? '#7a3b3b' : '#e7a3a3'}}
      .notebook h1,.notebook h2,.notebook .topbar span:first-child{font-family:'Hannotate TC','HanziPen TC','Wawati TC','PingFang TC',sans-serif;font-weight:700}.notebook h1{letter-spacing:0}
      .notebook .subtitle{background:linear-gradient(transparent 55%,color-mix(in srgb,var(--accent) 35%,transparent) 55%);display:inline;padding:0 4px}
      .notebook .cards{gap:26px}.notebook .card{position:relative;background:${dark ? '#2a2720' : '#fffdf6'};border:1px solid var(--border);border-radius:4px;box-shadow:0 3px 0 color-mix(in srgb,var(--accent) 25%,transparent);transform:rotate(-.5deg)}.notebook .card:nth-child(even){transform:rotate(.5deg)}
      .notebook .card::before{content:'';position:absolute;top:-12px;left:42%;width:120px;height:26px;background:color-mix(in srgb,var(--accent) 30%,#ffffff 40%);opacity:.8;transform:rotate(-3deg)}.notebook .card-number{font-family:'Hannotate TC','HanziPen TC',sans-serif}`,
    journal: `body{background:${dark ? '#12110f' : '#fbfaf6'}}.journal .canvas{border-top:0}.journal h1,.journal h2,.journal .subtitle{font-family:'Songti TC','LiSong Pro','Noto Serif TC',serif}.journal h1{font-weight:900;letter-spacing:0}
      .journal .topbar{border-top:6px double var(--ink);border-bottom:1px solid var(--ink);padding:6px 0;color:var(--ink);font-size:18px;letter-spacing:3px}.journal .topbar span:last-child{color:var(--ink)}
      .journal .subtitle{font-style:italic;border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:14px 0}.journal .cards{display:grid;grid-template-columns:${wide ? '1fr' : '1fr 1fr'};gap:0 34px}
      .journal .card{background:transparent;border:0;border-top:2px solid var(--accent);border-radius:0;padding:16px 0 0;flex-direction:column;gap:6px}.journal .card-number{font-family:'Songti TC',serif;font-size:22px;padding:0}.journal .footer{border-top:1px solid var(--ink)}`,
    roadmap: `.roadmap .canvas{border-top:0}.roadmap .cards{gap:30px;padding-left:18px;border-left:4px solid var(--accent);margin-left:28px}.roadmap .card{position:relative;background:var(--surface);margin-left:26px;border-radius:14px}
      .roadmap .card-number{position:absolute;left:-76px;top:18px;width:52px;height:52px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;padding:0;font-size:22px}
      .roadmap .footer{border-top:2px solid var(--accent);padding-top:10px}.roadmap .footer .number{background:var(--accent);color:var(--on-accent);padding:0 12px;line-height:1.2;border-radius:999px}`,
    seamless: `.seamless .canvas{border-top:0;position:relative;z-index:1}.seamless .card{background:color-mix(in srgb,var(--surface) 88%,transparent)}.seamless .footer{border-top-color:var(--accent)}`,
  };
  return `${common}${rules[style] ?? ''}`;
}

// The seamless style draws one wave across every slide, offset per page, so
// consecutive slides join at their edges when swiped.
function decoration(style, { index, total, wide, height }) {
  if (style !== 'seamless') return '';
  const width = 1080 * total, amplitude = height * 0.12;
  // One smooth sine period per 1.5 slides keeps the curve continuous at every slide edge.
  const points = Array.from({ length: total * 40 + 1 }, (_, i) => { const x = i * 27; return `${x},${(height * 0.72 + Math.sin(x / 1620 * 2 * Math.PI) * amplitude).toFixed(1)}`; });
  const offset = wide ? 0 : -index * 1080;
  return `<svg aria-hidden="true" style="position:absolute;left:${offset}px;top:0;width:${width}px;height:${height}px;z-index:0" viewBox="0 0 ${width} ${height}"><polyline points="${points.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/><polygon points="0,${height} ${points.join(' ')} ${width},${height}" fill="var(--surface)" opacity=".7"/></svg>`;
}

// Runs in the browser: verify every text line and block against its region and
// any clipping ancestor, including lines concealed by overflow:hidden. The live
// preview passes an iframe document; Playwright calls it with no argument.
export function geometryCheck(doc = document) {
  const view = doc.defaultView, issues = [];
  const rect = el => el.getBoundingClientRect();
  const inside = (a,b) => a.left >= b.left - 2 && a.top >= b.top - 2 && a.right <= b.right + 2 && a.bottom <= b.bottom + 2;
  const regions = [...doc.querySelectorAll('[data-region]')];
  for (const el of doc.querySelectorAll('[data-check]')) {
    const r = rect(el), region = el.closest('[data-region]');
    if (region && !inside(r, rect(region))) issues.push(`${el.tagName}: block exceeds ${region.dataset.region}`);
    const computed = view.getComputedStyle(el);
    if (/(hidden|clip|auto|scroll)/.test(`${computed.overflowX} ${computed.overflowY}`) && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)) issues.push(`${el.tagName}: internal overflow`);
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement.closest('[data-check]') !== el) continue;
      const range = doc.createRange(); range.selectNodeContents(node);
      for (const line of range.getClientRects()) {
        if (region && !inside(line, rect(region))) issues.push(`${el.tagName}: text line exceeds ${region.dataset.region}`);
        let ancestor = node.parentElement;
        while (ancestor && ancestor !== doc.body) {
          const style = view.getComputedStyle(ancestor);
          if (/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`) && !inside(line, rect(ancestor))) issues.push(`${el.tagName}: text line clipped`);
          ancestor = ancestor.parentElement;
        }
      }
    }
  }
  for (let i=0;i<regions.length;i++) for (let j=i+1;j<regions.length;j++) {
    const a=rect(regions[i]), b=rect(regions[j]);
    if (Math.min(a.right,b.right) > Math.max(a.left,b.left)+1 && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top)+1) issues.push(`Regions overlap: ${regions[i].dataset.region}/${regions[j].dataset.region}`);
  }
  for (const region of regions) {
    const siblings = [...region.children];
    for (let i=0;i<siblings.length;i++) for (let j=i+1;j<siblings.length;j++) {
      const a=rect(siblings[i]), b=rect(siblings[j]);
      if (Math.min(a.right,b.right) > Math.max(a.left,b.left)+2 && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top)+2) issues.push(`Content blocks overlap in ${region.dataset.region}`);
    }
  }
  const images = [...doc.images].map(img => ({ loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt }));
  if (images.some(img => !img.loaded)) issues.push('Image failed to decode');
  return { passed: issues.length === 0, issues: [...new Set(issues)], images };
}

// Runs in the browser (Playwright installs window.__geometryCheck; the preview passes `check`): the largest zoom in
// [min, max] at which every text block fits, never growing past ~88% of the body.
export function autoFit({ min, max }, doc = document, check = d => window.__geometryCheck(d)) {
  const root = doc.documentElement, body = doc.querySelector('.body');
  const set = value => root.style.setProperty('--fit', String(value));
  const filled = () => { const kids = [...body.children]; if (!kids.length) return 0; const r = body.getBoundingClientRect(); return (kids.at(-1).getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top) / r.height; };
  const fits = value => { set(value); return check(doc).passed && (value <= 1 || filled() <= 0.88); };
  if (!fits(min)) { set(1); return 1; }
  let low = min, high = max;
  if (fits(max)) low = max;
  else for (let i = 0; i < 8; i++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; }
  const value = Math.floor(low * 100) / 100;
  set(value); return value;
}
export const FIT_RANGE = { min: 0.8, content: 1.45, headline: 1.12 };

