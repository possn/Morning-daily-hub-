import { config, DAYS_AHEAD } from "../config.js";
import { addDays, startOfLocalDay } from "../time.js";
import type { CalEvent, ReplyItem } from "../types.js";
import { clip, isBlockedSender, redact } from "../redact.js";

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

// ---------- Emails a responder ----------
// Com estrela, ou conversas na caixa de entrada em que a última mensagem não é tua há mais de 2 dias.
// Sem IA: só metadados (remetente, assunto, datas). O corpo nunca é descarregado.

const AUTOMATIC = /no-?reply|notifica|newsletter|mailer-daemon|donotreply|naoresponder|nao-responder/i;
const cleanFrom = (f: string) => f.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || f;

type ThreadMeta = {
  id: string;
  messages: { id: string; internalDate: string; labelIds?: string[]; payload: { headers: { name: string; value: string }[] } }[];
};

export async function fetchToReply(now = new Date()): Promise<ReplyItem[]> {
  const T = "https://gmail.googleapis.com/gmail/v1/users/me/threads";
  const q = (query: string, max: number) => `${T}?${new URLSearchParams({ q: query, maxResults: String(max) })}`;
  const [starred, waiting] = await Promise.all([
    gget<{ threads?: { id: string }[] }>(q("is:starred -in:trash -in:spam", 15)),
    gget<{ threads?: { id: string }[] }>(
      q("in:inbox older_than:2d newer_than:21d -category:promotions -category:social -category:forums -category:updates", 25),
    ),
  ]);
  const starredIds = new Set((starred.threads ?? []).map((t) => t.id));
  const ids = [...new Set([...(starred.threads ?? []), ...(waiting.threads ?? [])].map((t) => t.id))];

  const items = await Promise.all(
    ids.map(async (id): Promise<ReplyItem | null> => {
      const t = await gget<ThreadMeta>(`${T}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const msgs = t.messages ?? [];
      const last = msgs[msgs.length - 1];
      if (!last) return null;
      const h = (n: string) => last.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      const first = msgs[0];
      const subject = first.payload.headers.find((x) => x.name.toLowerCase() === "subject")?.value ?? h("subject");
      const isStar = starredIds.has(id) || msgs.some((m) => m.labelIds?.includes("STARRED"));
      const repliedByMe = last.labelIds?.includes("SENT") ?? false;
      const from = h("from");
      if (!isStar && (repliedByMe || AUTOMATIC.test(from))) return null;
      if (isBlockedSender(from)) return null;
      if (isSelfNoise({ subject, snippet: "", from })) return null;
      const days = Math.max(0, Math.floor((now.getTime() - Number(last.internalDate)) / 864e5));
      return {
        id,
        from: clip(cleanFrom(from), 60),
        subject: clip(redact(subject || "(sem assunto)"), 120),
        days,
        starred: isStar,
        link: `https://mail.google.com/mail/u/0/#all/${id}`,
      };
    }),
  );
  const ok = items.filter((x): x is ReplyItem => x !== null);
  // Estrela: as 4 mais recentes (as antigas já não pedem ação). Sem resposta: até 6, as mais antigas primeiro.
  const star = ok.filter((x) => x.starred).sort((a, b) => a.days - b.days).slice(0, 4);
  const wait = ok.filter((x) => !x.starred).sort((a, b) => b.days - a.days).slice(0, 6);
  return [...star, ...wait];
}
