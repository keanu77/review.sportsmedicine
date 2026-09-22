export type PublicationPeriod = "" | "1m" | "6m" | "1y";

export const PUBLICATION_PERIODS: { value: PublicationPeriod; label: string }[] = [
  { value: "", label: "不限時間" },
  { value: "1m", label: "近一個月" },
  { value: "6m", label: "近半年" },
  { value: "1y", label: "近一年" },
];

export function parsePublicationPeriod(value: string | null): PublicationPeriod {
  return value === "1m" || value === "6m" || value === "1y" ? value : "";
}

/** Validate complete source dates without converting partial years/months to invented days. */
export function publicationDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Rolling calendar months, inclusive through today's local calendar date; clamp month ends. */
export function publicationWindow(period: PublicationPeriod, now = new Date()): { from: string; to: string } | null {
  if (!period) return null;
  const months = period === "1m" ? 1 : period === "6m" ? 6 : 12;
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - months, 1));
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(now.getDate(), lastDay));
  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

export function matchesPublicationWindow(date: unknown, window: ReturnType<typeof publicationWindow>): boolean {
  if (!window) return true;
  const value = publicationDate(date);
  return value !== null && value >= window.from && value <= window.to;
}
