// Recebe os eventos dos calendários do iPhone (Outlook do hospital + Família do iCloud) enviados pelo Atalho do iOS,
// e manda a notificação da manhã para a PWA (Web Push).
// Autenticação: "Authorization: Bearer <token>" ou ?t=<token>. O token está em app_config (ingest_token); a app copia a ligação pronta.
// Deploy: supabase functions deploy ingest-outlook --no-verify-jwt
//
// Corpo aceite (JSON): { "events": [ { "title", "start", "end", "allDay"?, "location"?, "calendar"? } ], "from"?: ISO, "to"?: ISO, "notify"?: boolean | "force" }
// O Atalho envia a janela [from, to): os eventos dessa janela são substituídos (assim apagados/movidos desaparecem).

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const TZ = "Europe/Lisbon";
// Turnos de urgência: "Banco M", "Banco P dia", "Urgência", "SU", "Prevenção"...
const DUTY = /^\s*banco\b|urg[eê]ncia|\bSU\b|preven[cç][aã]o/i;

type In = { title?: string; start?: string; end?: string; allDay?: boolean | string; location?: string; calendar?: string };

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Os Atalhos podem enviar datas em formatos locais; aceitamos ISO e "yyyy-MM-dd HH:mm".
function toIso(v?: string): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(" ", "T");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseLoose(text: string): In[] {
  const t = text.trim();
  if (!t) return [];
  try {
    const v = JSON.parse(t.startsWith("[") ? t : `[${t.replace(/}\s*\n\s*{/g, "},{")}]`);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function sha(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const ymdLisbon = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const hmLisbon = (d: Date) => d.toLocaleTimeString("pt-PT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

async function config(): Promise<Record<string, string>> {
  const { data } = await sb.from("app_config").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

type Row = { title: string; start_at: string; end_at: string; all_day: boolean; calendar: string | null };

function compose(today: string, rows: Row[], brief: { headline?: string; emails?: unknown[] } | null) {
  const todays = rows.filter((r) => {
    const s = ymdLisbon(new Date(r.start_at));
    if (!r.all_day) return s === today;
    // Dia inteiro: [início, fim) cobre hoje
    const e = ymdLisbon(new Date(new Date(r.end_at).getTime() - 1));
    return s <= today && today <= e;
  });
  const duty = todays.find((r) => DUTY.test(r.title));
  const hospital = todays.filter((r) => !r.all_day && !DUTY.test(r.title) && !/fam[ií]l|feriad|holiday|anivers|birthday|dorsal|runners/i.test(r.calendar ?? ""));
  const parts: string[] = [];
  if (brief?.headline) parts.push(brief.headline);
  if (hospital.length) {
    parts.push(`Hospital: ${hospital.length} ${hospital.length === 1 ? "evento" : "eventos"}, o primeiro às ${hmLisbon(new Date(hospital[0].start_at))}.`);
  }
  const n = brief?.emails?.length ?? 0;
  if (n) parts.push(`${n} ${n === 1 ? "email pede" : "emails pedem"} atenção.`);
  return {
    title: duty ? `Hoje: ${duty.title}` : "Bom dia ☀️",
    body: parts.join(" ") || "O teu dia está pronto.",
  };
}

async function sendPush(cfg: Record<string, string>, owner: string, msg: { title: string; body: string }) {
  if (!cfg.vapid_public || !cfg.vapid_private) return { sent: 0, reason: "sem chaves" };
  webpush.setVapidDetails(cfg.vapid_subject || "https://possn.github.io", cfg.vapid_public, cfg.vapid_private);
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", owner);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...msg, url: "./" }),
        { TTL: 6 * 3600, urgency: "normal" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }
  return { sent };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const cfg = await config();
  const token = Deno.env.get("INGEST_TOKEN") || cfg.ingest_token || "";
  const OWNER = Deno.env.get("OWNER_USER_ID") || cfg.owner_user_id || "";
  // O token pode vir no cabeçalho Authorization ou na ligação (?t=), que a app copia já pronta.
  const auth = (req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || new URL(req.url).searchParams.get("t") || "").trim();
  if (!token || !OWNER || !safeEqual(auth, token)) return new Response("Unauthorized", { status: 401 });

  let body: { events?: In[] | string; from?: string; to?: string; notify?: boolean | string };
  try {
    body = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }
  // O Atalho pode mandar a lista como array JSON ou como texto (um dicionário por linha).
  let raw: In[] = [];
  if (Array.isArray(body.events)) raw = body.events;
  else if (typeof body.events === "string") raw = parseLoose(body.events);

  // Calendários a ignorar: os de permutas (partilhados) e os nomes em app_config.ignore_calendars (separados por vírgula).
  const ignore = (cfg.ignore_calendars ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const skipCal = (c?: string) => {
    const n = String(c ?? "").trim().toLowerCase();
    return /permut/.test(n) || ignore.includes(n);
  };

  const rows = [];
  const seen = new Set<string>();
  for (const e of raw.slice(0, 800)) {
    if (skipCal(e.calendar)) continue;
    // Nunca guardar eventos de doentes (nº de processo, "NP 1234567"), venham de que calendário vierem.
    if (/\bNP\s*[.:#-]?\s*\d{5,}/i.test(String(e.title ?? ""))) continue;
    const start = toIso(e.start);
    const end = toIso(e.end) ?? start;
    // Ignora marcadores sem texto ("*") e duplicados entre calendários (ex.: feriados em dois calendários).
    if (!start || !end || !e.title || /^[\s*.\-–—·]*$/.test(String(e.title))) continue;
    const key = `${String(e.title).trim().toLowerCase()}|${start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      user_id: OWNER,
      uid: await sha(`${e.calendar ?? ""}|${e.title}|${start}`),
      title: String(e.title).slice(0, 300),
      start_at: start,
      end_at: end,
      all_day: e.allDay === true || ["true", "sim", "yes", "1"].includes(String(e.allDay ?? "").toLowerCase()),
      location: e.location ? String(e.location).slice(0, 300) : null,
      calendar: e.calendar ? String(e.calendar).slice(0, 100) : null,
      synced_at: new Date().toISOString(),
    });
  }

  const from = toIso(body.from) ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const to = toIso(body.to) ?? new Date(Date.now() + 14 * 864e5).toISOString();

  const del = await sb.from("outlook_events").delete().eq("user_id", OWNER).gte("start_at", from).lt("start_at", to);
  if (del.error) return new Response(del.error.message, { status: 500 });
  if (rows.length) {
    const ins = await sb.from("outlook_events").upsert(rows, { onConflict: "user_id,uid" });
    if (ins.error) return new Response(ins.error.message, { status: 500 });
  }

  // Notificação da manhã: uma por dia (a não ser que venha notify: "force").
  const today = ymdLisbon(new Date());
  let push: { sent: number; reason?: string } = { sent: 0, reason: "desligada" };
  const force = body.notify === "force";
  if (body.notify !== false && body.notify !== "false" && (force || cfg.last_push_date !== today)) {
    const { data: b } = await sb
      .from("briefs").select("payload").eq("user_id", OWNER).eq("brief_date", today).maybeSingle();
    const msg = compose(today, rows as Row[], (b?.payload as { headline?: string; emails?: unknown[] }) ?? null);
    push = await sendPush(cfg, OWNER, msg);
    if (push.sent) await sb.from("app_config").upsert({ key: "last_push_date", value: today, updated_at: new Date().toISOString() });
  } else if (cfg.last_push_date === today) push = { sent: 0, reason: "já enviada hoje" };

  return Response.json({ ok: true, received: raw.length, stored: rows.length, push });
});
