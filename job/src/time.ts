import { TZ } from "./config.js";

/** Data local (YYYY-MM-DD) no fuso de Lisboa. */
export function localDate(d = new Date(), tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Offset do fuso (ex.: "+00:00" ou "+01:00") num dado instante. */
export function tzOffset(d: Date, tz = TZ): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = part.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

/** Início do dia local em ISO com offset. */
export function startOfLocalDay(date: string, tz = TZ): string {
  const probe = new Date(`${date}T12:00:00Z`);
  return `${date}T00:00:00${tzOffset(probe, tz)}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
