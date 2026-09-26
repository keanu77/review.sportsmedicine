import { useEffect, useRef, useState } from "react";
import { toString as qrToString } from "qrcode";
import type { Design, Draft } from "../shared/contracts";
import { buildManifest } from "../shared/manifest.mjs";
import { FIT_RANGE, FORMATS, autoFit, buildHTML, geometryCheck, type Manifest } from "../worker/renderer/layout.mjs";

type Slide = { key: string; label: string; html: string; width: number; height: number; kind: "cover" | "content" | "outro" | "wide" };
const THUMB = 220;

function slides(manifest: Manifest, qr: string | null): Slide[] {
  const height = FORMATS[manifest.design.format];
  const pages = manifest.pages.map((page, index) => ({ key: page.id, label: `第 ${index + 1} 頁`, kind: page.layout, width: 1080, height, html: buildHTML(manifest, page, { index, qr }) }));
  const cover = manifest.cover ? [{ key: "cover-wide", label: "FB 封面 1200×630", kind: "wide" as const, width: 1200, height: 630, html: buildHTML(manifest, { ...manifest.cover, id: "cover", layout: "cover" }, { wide: true }) }] : [];
  return [...pages, ...cover];
}

/** One page rendered at full size in a script-less iframe, then fitted and checked from this page. */
function Frame({ slide }: { slide: Slide }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [issue, setIssue] = useState("");
  const scale = THUMB / slide.width;
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (!doc?.querySelector(".body")) return;
    const max = slide.kind === "wide" ? 1 : slide.kind === "cover" ? FIT_RANGE.headline : FIT_RANGE.content;
    autoFit({ min: FIT_RANGE.min, max }, doc, geometryCheck);
    const result = geometryCheck(doc);
    setIssue(result.passed ? "" : "文字放不下，請縮短或拆頁");
  };
  return <figure className={`wb-preview-slide${issue ? " has-issue" : ""}`} style={{ width: THUMB }}>
    <div className="wb-preview-frame" style={{ width: THUMB, height: Math.round(slide.height * scale) }}>
      <iframe ref={ref} title={`${slide.label}預覽`} sandbox="allow-same-origin" srcDoc={slide.html} onLoad={fit} tabIndex={-1}
        style={{ width: slide.width, height: slide.height, transform: `scale(${scale})` }} />
    </div>
    <figcaption>{slide.label}{issue && <strong role="status"> · {issue}</strong>}</figcaption>
  </figure>;
}

/** Live carousel preview of the unsaved editor text, laid out by the same code the Mac renderer uses. */
export default function LivePreview({ draft, design, paper }: { draft: Draft; design: Design; paper: Record<string, unknown> }) {
  const [items, setItems] = useState<Slide[]>([]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const manifest = buildManifest({ draft, paper, design });
      const qr = manifest.outro?.qr ? await qrToString(manifest.outro.qr.url, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).catch(() => null) : null;
      if (active) setItems(slides(manifest, qr));
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [draft, design, paper]);
  return <section className="wb-panel wb-live-preview" aria-label="即時預覽">
    <div className="wb-section-heading"><h2>即時預覽</h2><span className="wb-small">未存檔的文字也會即時更新；AI 圖片只在 Mac 製作時加入。</span></div>
    <div className="wb-preview-strip">{items.map(slide => <Frame key={slide.key} slide={slide} />)}</div>
  </section>;
}
