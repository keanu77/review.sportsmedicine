// Types for the pure pre-render gate in quality.mjs (shared with the browser).
import type { Draft } from './contracts';

export type QualityIssue = { code: string; where: string; message: string; overridable?: boolean };
export declare const DISCLAIMER: string;
export declare const SHORT_DISCLAIMER: string;
export declare function hashtags(text: string): string[];
export declare const COMPLIANCE: { phrase: string; severity: 'high' | 'medium' }[];
export declare function normalize(text: string): string;
export declare function extractNumbers(text: string): string[];
export declare function sourceNumberSet(text: string): string[];
export declare function claimKey(claim: { text: string; locator: string; quote: string }): string;
export declare function withDisclaimer(text: string): string;
export type ReviewDecisions = Record<string, { status: 'pending' | 'resolved' | 'rejected'; reason?: string }>;
export type PrimaryRejection = { index: number; severity: string; claim: string; reason: string; suggestion: string; locator: string; quote: string; rejection: string };
export declare const PRIMARY_REVIEWER: string;
export declare const REVIEW_SEATS: Record<string, { label: string; role: string; note: string }>;
export declare function primaryRejections(reviews: unknown, dispositions?: ReviewDecisions): PrimaryRejection[];
export declare function rejectionsMarkdown(rejections: PrimaryRejection[]): string;
export declare function checkDraft(draft: Draft, context?: { claimReview?: unknown; sourceNumbers?: unknown; review?: { reviews: unknown; dispositions?: ReviewDecisions } }): { errors: QualityIssue[]; warnings: QualityIssue[] };
