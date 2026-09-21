export type JobStatus = 'queued' | 'running' | 'needs_review' | 'completed' | 'failed' | 'cancelled';
export type Design = {
  palette: 'blue' | 'cyan' | 'emerald' | 'orange-light' | 'gold' | 'orange' | 'sky';
  style: 'clinical' | 'editorial'; imageStyle: 'photo' | 'illustration' | 'none'; format: 'square' | 'portrait';
};
export type Draft = {
  post: string; igCaption: string; notes: string;
  pages: { id: string; layout: 'cover' | 'content' | 'outro'; title: string; subtitle?: string; cards?: { title: string; body: string }[] }[];
  claims: { text: string; locator: string; quote: string }[];
};
export type Artifact = { id: string; name: string; contentType: string; size: number; sha256: string };
export type Job = {
  id: string; input: string; title: string; status: JobStatus; phase: 'research' | 'render'; stage: string; revision: number;
  draft: Draft | null; design: Design; metadata: Record<string, unknown>; artifacts: Artifact[];
  error: { code: string; message: string; recoverable?: boolean } | null; createdAt: string; updatedAt: string;
};
