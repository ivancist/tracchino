const ROME_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Europe/Rome as `YYYY-MM-DD` (at 00:30 in Italy this is already the new day, unlike UTC). */
export function todayRome(now: Date = new Date()): string {
  return ROME_DATE.format(now);
}

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const LONG = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-10-02" → "ven 2 ott 2026" */
export function formatIsoDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  return LONG.format(new Date(Date.UTC(y!, m! - 1, d!)));
}
