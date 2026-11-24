import { config, DAYS_AHEAD } from "../config.js";
import { addDays, startOfLocalDay } from "../time.js";
import type { CalEvent } from "../types.js";

export interface RawEmail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  labels: string[];
}

let cachedToken: string | undefined;

async function accessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const { clientId, clientSecret, refreshToken } = config.google;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth não configurado");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token HTTP ${res.status}`);
  cachedToken = ((await res.json()) as { access_token: string }).access_token;
  return cachedToken;
}

async function gget<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`Google HTTP ${res.status} em ${new URL(url).pathname.split("/").slice(0, 4).join("/")}`);
  return (await res.json()) as T;
}

// ---------- Gmail ----------

export async function fetchEmails(): Promise<RawEmail[]> {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const list = await gget<{ messages?: { id: string; threadId: string }[] }>(
    `${base}?${new URLSearchParams({ q: config.google.gmailQuery, maxResults: String(config.google.gmailMax) })}`,
  );
  const ids = list.messages ?? [];
  // Só metadados + snippet: o corpo do email nunca é descarregado.
  const out = await Promise.all(
    ids.map(async ({ id }) => {
      const m = await gget<{
        id: string;
        threadId: string;
        snippet: string;
        labelIds?: string[];
        payload: { headers: { name: string; value: string }[] };
      }>(`${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const h = (n: string) => m.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      return {
        id: m.id,
        threadId: m.threadId,
        from: h("from"),
        subject: h("subject"),
        date: h("date"),
        snippet: decodeEntities(m.snippet ?? ""),
        labels: m.labelIds ?? [],
      };
    }),
  );
  // Avisos da própria app (falhas do workflow, alerta Google de acesso do Daily Hub) não são tarefas tuas.
  return out.filter((e) => !isSelfNoise(e));
}

export function isSelfNoise(e: { subject: string; snippet: string; from: string }): boolean {
  if (/\[possn\/Morning-daily-hub-?\]/i.test(e.subject)) return true;
  if (/google/i.test(e.from) && /daily hub/i.test(`${e.subject} ${e.snippet}`)) return true;
  return false;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ---------- Google Calendar ----------

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

export async function fetchCalendarEvents(today: string): Promise<CalEvent[]> {
  const timeMin = startOfLocalDay(today);
  const timeMax = startOfLocalDay(addDays(today, DAYS_AHEAD));
  const ids = new Set(config.google.calendarIds);
  if (config.google.dutyCalendarId) ids.add(config.google.dutyCalendarId);

  const all: CalEvent[] = [];
  for (const calId of ids) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        timeZone: "Europe/Lisbon",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await gget<{ items: GEvent[]; nextPageToken?: string; summary?: string }>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
      );
      for (const e of res.items ?? []) {
        if (e.status === "cancelled") continue;
        const allDay = Boolean(e.start.date);
        all.push({
          id: `g:${calId}:${e.id}`,
          source: calId === config.google.dutyCalendarId || isDuty(e.summary) ? "escala" : "google",
          title: e.summary ?? "(sem título)",
          start: e.start.dateTime ?? `${e.start.date}T00:00:00`,
          end: e.end.dateTime ?? `${e.end.date}T00:00:00`,
          allDay,
          location: e.location,
          calendar: res.summary,
        });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);
  }
  return all.sort((a, b) => a.start.localeCompare(b.start));
}

function isDuty(title?: string): boolean {
  if (!title) return false;
  const t = ` ${title.toLowerCase()} `;
  return config.google.dutyKeywords.some((k) => {
    const kw = k.toLowerCase();
    // palavras curtas (ex.: "SU") só contam como palavra inteira
    return kw.length <= 3 ? new RegExp(`[^\\p{L}]${kw}[^\\p{L}]`, "u").test(t) : t.includes(kw);
  });
}
