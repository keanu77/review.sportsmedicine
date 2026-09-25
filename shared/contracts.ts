export type JobStatus = 'queued' | 'running' | 'needs_review' | 'completed' | 'failed' | 'cancelled';
export type Design = {
  palette: 'blue' | 'cyan' | 'emerald' | 'orange-light' | 'gold' | 'orange' | 'sky' | 'sage' | 'coral' | 'lavender' | 'mono' | 'clash';
  style: 'clinical' | 'editorial' | 'bold' | 'contrast' | 'notebook' | 'journal' | 'roadmap' | 'seamless';
  imageStyle: 'photo' | 'illustration' | 'flat' | 'watercolor' | 'film' | 'none'; format: 'square' | 'portrait' | 'story';
};
export type Draft = {
  post: string; igCaption: string; notes: string;
  pages: { id: string; layout: 'cover' | 'content' | 'outro'; title: string; subtitle?: string; cards?: { title: string; body: string }[] }[];
  claims: { text: string; locator: string; quote: string }[];
};
export type Artifact = { id: string; name: string; contentType: string; size: number; sha256: string };
export type Job = {
  id: string; input: string; title: string; status: JobStatus; phase: 'research' | 'render' | 'review'; stage: string; revision: number;
  draftRevision?: number | null; draftSavedAt?: string | null;
  draft: Draft | null; design: Design; metadata: Record<string, unknown>; artifacts: Artifact[];
  error: { code: string; message: string; recoverable?: boolean } | null; createdAt: string; updatedAt: string;
};
export type DraftVersion = { revision: number; createdAt: string; restoredFrom: number | null; draft?: Draft };
export type ReviewDisposition = { provider: string; findingIndex: number; status: 'pending' | 'resolved' | 'rejected'; reason: string; draftRevision: number; updatedAt: string };
export type ReviewRun = { id: string; draftRevision: number | null; createdAt: string; reviews: Record<string, unknown>[]; dispositions: ReviewDisposition[] };
