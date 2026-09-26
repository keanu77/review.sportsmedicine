// Types for the browser-safe renderer layout (used by the workbench live preview).
export type Manifest = { version: 1; title?: string; design: { palette: string; style: string; imageStyle: string; format: 'square' | 'portrait' | 'story'; brand: string; footer?: string };
  pages: { id: string; layout: 'cover' | 'content' | 'outro'; title: string; subtitle?: string; cards?: { title: string; body: string }[]; duration?: number }[];
  outro?: { cta?: string; disclaimer?: string; qr?: { url: string; label: string } }; cover?: { title: string; subtitle?: string } };
export type GeometryResult = { passed: boolean; issues: string[] };
export declare const FORMATS: Record<'square' | 'portrait' | 'story', number>;
export declare const FIT_RANGE: { min: number; content: number; headline: number };
export declare function statParts(title: string): { label: string; value: string } | null;
export declare function buildHTML(manifest: Manifest, page: Manifest['pages'][number], options?: { index?: number; image?: null; wide?: boolean; qr?: string | null }): string;
export declare function geometryCheck(doc?: Document): GeometryResult;
export declare function autoFit(range: { min: number; max: number }, doc?: Document, check?: (doc: Document) => GeometryResult): number;
