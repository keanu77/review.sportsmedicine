export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
export function publicDocument(template: string, value: { title: string; description: string; canonical: string; body: string; bootstrap?: { id: string; data: unknown }; noindex?: boolean }): string {
  const { title, description, canonical, body, bootstrap, noindex } = value;
  // Function replacements preserve source text containing $&, $` or $' literally.
  let html = template.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, () => `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/<meta\s+property="og:title"[\s\S]*?\/>/, () => `<meta property="og:title" content="${escapeHtml(title)}" />`)
    .replace(/<meta\s+property="og:description"[\s\S]*?\/>/, () => `<meta property="og:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta\s+property="og:url"[\s\S]*?\/>/, () => `<meta property="og:url" content="${escapeHtml(canonical)}" />`)
    .replace(/<link\s+rel="canonical"[\s\S]*?\/>/, () => `<link rel="canonical" href="${escapeHtml(canonical)}" />`)
    .replace('<div id="root"></div>', () => `<div id="root">${body}</div>${bootstrap ? `<script type="application/json" id="${escapeHtml(bootstrap.id)}">${scriptJson(bootstrap.data)}</script>` : ""}`);
  if (noindex) html = html.replace("</head>", '<meta name="robots" content="noindex, nofollow" /></head>');
  return html;
}
