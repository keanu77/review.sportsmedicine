// Types for the pure pre-render gate in quality.mjs (shared with the browser).
import type { Draft } from './contracts';

export type QualityIssue = { code: string; where: string; message: string; overridable?: boolean };
export declare const DISCLAIMER: string;
export declare const COMPLIANCE: { phrase: string; severity: 'high' | 'medium' }[];
export declare function normalize(text: string): string;
export declare function extractNumbers(text: string): string[];
export declare function sourceNumberSet(text: string): string[];
export declare function claimKey(claim: { text: string; locator: string; quote: string }): string;
export declare function withDisclaimer(text: string): string;
export declare function checkDraft(draft: Draft, context?: { claimReview?: unknown; sourceNumbers?: unknown }): { errors: QualityIssue[]; warnings: QualityIssue[] };
