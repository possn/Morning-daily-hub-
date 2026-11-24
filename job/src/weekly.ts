// Resumo da semana: ao domingo à noite (corrida das 18:15), uma notificação com
// os turnos, a carga do hospital e o tempo dos próximos 7 dias.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { config, TZ } from "./config.js";
import { addDays, localDate } from "./time.js";
import type { Weather } from "./types.js";

const DUTY = /^\s*banco\b|urg[eê]ncia|\bSU\b|preven[cç][aã]o/i;
const PERSONAL = /fam[ií]l|feriad|holiday|anivers|birthday|dorsal|runners/i;

type Row = { title: string; start_at: string; all_day: boolean; calendar: string | null };

const weekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-PT", { weekday: "short", timeZone: "UTC" }).replace(".", "");
const hm = (iso: string) => new Date(iso).toLocaleTimeString("pt-PT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export function isSundayEvening(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  return wd === "Sun" && h >= 17;
}

export function composeWeek(today: string, rows: Row[], weather?: Weather): { title: string; body: string } {
  const from = addDays(today, 1);
  const to = addDays(today, 7);
  const inWeek = rows.filter((r) => {
    const d = localDate(new Date(r.start_at));
    return d >= from && d <= to;
  });
  const duty = inWeek.filter((r) => DUTY.test(r.title));
  const hospital = inWeek.filter((r) => !r.all_day && !DUTY.test(r.title) && !PERSONAL.test(r.calendar ?? ""));

  const parts: string[] = [];
  parts.push(
    duty.length
      ? `Turnos: ${duty.map((r) => `${weekday(localDate(new Date(r.start_at)))} (${r.title.trim()})`).join(", ")}.`
      : "Sem turnos de urgência.",
  );
  if (hospital.length) {
    const first = hospital[0];
    parts.push(
      `Hospital: ${hospital.length} ${hospital.length === 1 ? "compromisso" : "compromissos"}, o primeiro ${weekday(localDate(new Date(first.start_at)))} às ${hm(first.start_at)}.`,
    );
  }
  const rainy = (weather?.days ?? []).filter((d) => d.date >= from && d.date <= to && d.rain >= 60).map((d) => weekday(d.date));
  if (rainy.length) parts.push(`Chuva provável: ${rainy.join(", ")}.`);
  return { title: "A tua semana", body: parts.join(" ") };
}

async function sendPush(sb: SupabaseClient, cfg: Record<string, string>, owner: string, msg: { title: string; body: string }) {
  if (!cfg.vapid_public || !cfg.vapid_private) return 0;
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
  return sent;
}

/** Envia o resumo da semana uma vez por domingo (ou sempre, com FORCE_WEEKLY=1). */
export async function maybeSendWeekly(today: string, weather?: Weather): Promise<string> {
  const force = process.env.FORCE_WEEKLY === "1";
  if (!force && !isSundayEvening()) return "fora de horas";
  const { url, serviceKey, ownerUserId } = config.supabase;
  if (!url || !serviceKey || !ownerUserId) return "sem Supabase";
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: cfgRows } = await sb.from("app_config").select("key,value");
  const cfg = Object.fromEntries((cfgRows ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
  if (!force && cfg.last_week_push === today) return "já enviado";

  const { data: rows, error } = await sb
    .from("outlook_events")
    .select("title,start_at,all_day,calendar")
    .eq("user_id", ownerUserId)
    .gte("start_at", new Date().toISOString())
    .order("start_at")
    .limit(500);
  if (error) throw new Error(`Supabase: ${error.code ?? "erro"}`);

  const sent = await sendPush(sb, cfg, ownerUserId, composeWeek(today, rows ?? [], weather));
  if (sent) await sb.from("app_config").upsert({ key: "last_week_push", value: today, updated_at: new Date().toISOString() });
  return `enviado a ${sent}`;
}
