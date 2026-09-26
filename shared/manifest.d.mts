import type { Draft, Design } from './contracts';
import type { Manifest } from '../worker/renderer/layout.mjs';
export declare const OUTRO_CTA: string;
export declare const BRAND: string;
export declare function defaultDuration(index: number, total: number): number;
export declare function sourceLink(paper: unknown): string | null;
export declare function outroBlock(paper: unknown): NonNullable<Manifest['outro']>;
export declare function buildManifest(input: { draft: Draft; paper?: Record<string, unknown>; design: Design; hero?: string | null }): Manifest;
