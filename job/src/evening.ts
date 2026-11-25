// Fecho do dia: na corrida das 18:15 (segunda a sábado), uma notificação curta com
// o que ficou por fazer e como começa amanhã. Ao domingo vai o resumo da semana em vez disto.
import { createClient } from "@supabase/supabase-js";
import { config, TZ } from "./config.js";
import { loadConfig, sendPush, setConfig } from "./push.js";
import { addDays, localDate } from "./time.js";
import { DUTY, highlightRows, hm, PERSONAL, SPOUSE, type Row } from "./weekly.js";
import type { CalEvent, ReplyItem, TaskItem } from "./types.js";
import { ICON } from "./highlights.js";

export function isWeekdayEvening(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  return wd !== "Sun" && h >= 17 && h < 23;
}

export function composeEvening(
  today: string,
  rows: Row[],
  google: CalEvent[],
  tasks: TaskItem[],
  toReply: ReplyItem[],
): { title: string; body: string } {
  const tomorrow = addDays(today, 1);
  const every: Row[] = [
    ...rows,
    ...google.map((e) => ({ title: e.title, start_at: e.start, all_day: e.allDay, calendar: e.source === "escala" ? "escala" : "google" })),
  ];
  const all = every.filter((r) => localDate(new Date(r.start_at)) === tomorrow);

  const parts: string[] = [];
  const duty = all.find((r) => DUTY.test(r.title));
  const mi = all.find((r) => SPOUSE.test(r.title));
  const timed = all
    .filter((r) => !r.all_day && !PERSONAL.test(r.calendar ?? "") && r !== duty && r !== mi)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  if (duty) parts.push(`Amanhã: ${duty.title.trim()}${duty.all_day ? "" : ` às ${hm(duty.start_at)}`}.`);
  if (timed.length) {
    parts.push(`${duty ? "Primeiro compromisso" : "Amanhã, primeiro compromisso"} às ${hm(timed[0].start_at)} (${timed[0].title.trim().slice(0, 60)}).`);
  } else if (!duty) {
    parts.push("Amanhã sem compromissos marcados.");
  }

  if (mi) parts.push(`Michele de banco amanhã${/noite/i.test(mi.title) ? " (noite)" : ""}.`);
  const hl = highlightRows(every)
    .filter((h) => h.date === tomorrow && h.title !== timed[0]?.title)
    .slice(0, 3);
  if (hl.length) parts.push(`Também: ${hl.map((h) => `${ICON[h.kind]} ${h.title.trim().slice(0, 50)}${h.allDay ? "" : ` às ${hm(h.start)}`}`).join("; ")}.`);
  const late = tasks.filter((t) => t.due && t.due <= today).length;
  const next = tasks.filter((t) => t.due === tomorrow).length;
  if (late) parts.push(`Por fechar hoje: ${late} ${late === 1 ? "tarefa" : "tarefas"}.`);
  if (next) parts.push(`Para amanhã: ${next} ${next === 1 ? "tarefa" : "tarefas"}.`);
  if (toReply.length) parts.push(`À espera de resposta: ${toReply.length} ${toReply.length === 1 ? "email" : "emails"}.`);
  return { title: "Fecho do dia", body: parts.join(" ") };
}

export async function maybeSendEvening(today: string, google: CalEvent[], tasks: TaskItem[], toReply: ReplyItem[]): Promise<string> {
  const force = process.env.FORCE_EVENING === "1";
  if (!force && !isWeekdayEvening()) return "fora de horas";
  const { url, serviceKey, ownerUserId } = config.supabase;
  if (!url || !serviceKey || !ownerUserId) return "sem Supabase";
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const cfg = await loadConfig(sb);
  if (!force && cfg.last_evening_push === today) return "já enviado";

  const from = new Date(`${today}T00:00:00Z`).toISOString();
  const { data: rows, error } = await sb
    .from("outlook_events")
    .select("title,start_at,all_day,calendar")
    .eq("user_id", ownerUserId)
    .gte("start_at", from)
    .order("start_at")
    .limit(300);
  if (error) throw new Error(`Supabase: ${error.code ?? "erro"}`);

  const sent = await sendPush(sb, cfg, ownerUserId, composeEvening(today, rows ?? [], google, tasks, toReply));
  if (sent) await setConfig(sb, "last_evening_push", today);
  return `enviado a ${sent}`;
}

