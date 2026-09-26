import { useEffect, useState } from "react";
import type { Job } from "../shared/contracts";
import { fetchArtifact } from "./privateApi";
import { isPrivateSessionActive } from "./draftRecovery";

export const thumbArtifact = (job: Job) => job.artifacts.find(file => file.name === "cover-1200x630.png") ?? job.artifacts.find(file => file.name === "series-page-01.png") ?? null;

/** Cover thumbnail for the job list, fetched with the private session and revoked on unmount. */
export default function JobThumb({ job }: { job: Job }) {
  const artifact = thumbArtifact(job);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!artifact || !isPrivateSessionActive()) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetchArtifact(job.id, artifact, controller.signal).then(blob => {
      if (controller.signal.aborted || !isPrivateSessionActive()) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); setUrl(null); };
  }, [job.id, artifact?.id, artifact?.sha256]);
  return url ? <img className="wb-job-thumb" src={url} alt="" /> : <span className="wb-job-thumb" aria-hidden="true" />;
}
