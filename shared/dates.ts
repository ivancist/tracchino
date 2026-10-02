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

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Every date from `from` to `to` inclusive (empty if from > to). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the ISO week containing `iso`. */
export function weekStart(iso: string): string {
  const dow = (new Date(toUtc(iso)).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(iso, -dow);
}

/** ISO-8601 week number and week-year: 2026-12-31 → { year: 2026, week: 53 }, 2027-01-01 → { year: 2026, week: 53 }. */
export function isoWeek(iso: string): { year: number; week: number } {
  const thursday = addDays(weekStart(iso), 3); // the week belongs to the year of its Thursday
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return { year, week };
}

const SHORT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2 ott" */
export function formatShortDate(iso: string): string {
  return SHORT.format(new Date(toUtc(iso)));
}
