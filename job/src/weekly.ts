// Resumo da semana: ao domingo à noite (corrida das 18:15), uma notificação com
// os turnos, a carga do hospital e o tempo dos próximos 7 dias.
import { createClient } from "@supabase/supabase-js";
import { loadConfig, sendPush, setConfig } from "./push.js";
import { config, TZ } from "./config.js";
import { addDays, localDate } from "./time.js";
import type { Weather } from "./types.js";

// Bancos do Pedro ("Banco P ..."); os da Michele ("Banco M ...") vão à parte.
export const DUTY = /^\s*banco\b(?!\s+M\b)|urg[eê]ncia|\bSU\b|preven[cç][aã]o/i;
export const SPOUSE = /^\s*banco\s+M\b/i;
export const PERSONAL = /fam[ií]l|feriad|holiday|anivers|birthday|dorsal|runners/i;

export type Row = { title: string; start_at: string; all_day: boolean; calendar: string | null };

const weekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-PT", { weekday: "short", timeZone: "UTC" }).replace(".", "");
export const hm = (iso: string) => new Date(iso).toLocaleTimeString("pt-PT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

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
  const hospital = inWeek.filter((r) => !r.all_day && !DUTY.test(r.title) && !SPOUSE.test(r.title) && !PERSONAL.test(r.calendar ?? ""));

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
  const mi = inWeek.filter((r) => SPOUSE.test(r.title));
  if (mi.length) parts.push(`Michele: ${mi.map((r) => `${weekday(localDate(new Date(r.start_at)))} (${r.title.replace(/^\s*banco\s+M\s*[-–]?\s*/i, "").trim() || "banco"})`).join(", ")}.`);
  const rainy = (weather?.days ?? []).filter((d) => d.date >= from && d.date <= to && d.rain >= 60).map((d) => weekday(d.date));
  if (rainy.length) parts.push(`Chuva provável: ${rainy.join(", ")}.`);
  return { title: "A tua semana", body: parts.join(" ") };
}

/** Envia o resumo da semana uma vez por domingo (ou sempre, com FORCE_WEEKLY=1). */
export async function maybeSendWeekly(today: string, weather?: Weather, readings = 0): Promise<string> {
  const force = process.env.FORCE_WEEKLY === "1";
  if (!force && !isSundayEvening()) return "fora de horas";
  const { url, serviceKey, ownerUserId } = config.supabase;
  if (!url || !serviceKey || !ownerUserId) return "sem Supabase";
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const cfg = await loadConfig(sb);
  if (!force && cfg.last_week_push === today) return "já enviado";

  const { data: rows, error } = await sb
    .from("outlook_events")
    .select("title,start_at,all_day,calendar")
    .eq("user_id", ownerUserId)
    .gte("start_at", new Date().toISOString())
    .order("start_at")
    .limit(500);
  if (error) throw new Error(`Supabase: ${error.code ?? "erro"}`);

  const msg = composeWeek(today, rows ?? [], weather);
  if (readings) msg.body += ` Leituras: ${readings} ${readings === 1 ? "artigo novo" : "artigos novos"} na app.`;
  const sent = await sendPush(sb, cfg, ownerUserId, msg);
  if (sent) await setConfig(sb, "last_week_push", today);
  return `enviado a ${sent}`;
}
