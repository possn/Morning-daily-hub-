import { writeFile } from "node:fs/promises";
import { config } from "./config.js";
import { localDate } from "./time.js";
import { fetchCalendarEvents, fetchEmails, fetchToReply, type RawEmail } from "./sources/google.js";
import { fetchNotionTasks } from "./sources/notion.js";
import { fetchObsidianTasks } from "./sources/obsidian.js";
import { buildWithAI } from "./ai.js";
import { cachedReadings, fetchAppTasks, saveBrief } from "./store.js";
import { fetchWeather } from "./sources/weather.js";
import { isSundayEvening, maybeSendWeekly } from "./weekly.js";
import { maybeSendEvening } from "./evening.js";
import { fetchReadings } from "./sources/readings.js";
import type { Brief, CalEvent, Reading, ReplyItem, TaskItem, Weather } from "./types.js";

async function attempt<T>(name: string, fallback: T, fn: () => Promise<T>, status: Brief["sources"]): Promise<T> {
  try {
    const v = await fn();
    status[name] = "ok";
    return v;
  } catch (err) {
    // Só a mensagem de erro, nunca o conteúdo, vai para os logs.
    console.error(`[${name}] falhou:`, (err as Error).message);
    status[name] = "erro";
    return fallback;
  }
}

async function main() {
  const today = localDate();
  const sources: Brief["sources"] = {};

  const [events, emails, toReply, notion, obsidian, weather, appTasks] = await Promise.all([
    attempt<CalEvent[]>("calendario", [], () => fetchCalendarEvents(today), sources),
    attempt<RawEmail[]>("gmail", [], fetchEmails, sources),
    attempt<ReplyItem[]>("responder", [], () => fetchToReply(), sources),
    config.notion.token ? attempt<TaskItem[]>("notion", [], fetchNotionTasks, sources) : ((sources.notion = "desligado"), []),
    config.obsidian.vaultPath ? attempt<TaskItem[]>("obsidian", [], fetchObsidianTasks, sources) : ((sources.obsidian = "desligado"), []),
    attempt<Weather | undefined>("tempo", undefined, fetchWeather, sources),
    attempt<TaskItem[]>("tarefas", [], fetchAppTasks, sources),
  ]);
  const tasks = [...appTasks, ...notion, ...obsidian];
  const refreshReadings = process.env.FORCE_WEEKLY === "1" || process.env.FORCE_READINGS === "1" || isSundayEvening();
  const readings = await attempt<{ items: Reading[]; fresh: boolean }>(
    "leituras",
    { items: [], fresh: false },
    () => cachedReadings(today, refreshReadings, fetchReadings),
    sources,
  );

  const todays = events.filter((e) => e.start.slice(0, 10) === today);
  const dutyEvent = todays.find((e) => e.source === "escala");

  let brief: Brief = {
    date: today,
    generatedAt: new Date().toISOString(),
    headline: dutyEvent ? `Hoje: ${dutyEvent.title}` : `${todays.length} eventos hoje`,
    summary: "",
    focus: [],
    duty: dutyEvent ? { label: dutyEvent.title, start: dutyEvent.start, end: dutyEvent.end } : null,
    events,
    // Sem IA: mostra os não lidos marcados como importantes pelo Gmail.
    emails: emails
      .filter((e) => e.labels.includes("UNREAD") && e.labels.includes("IMPORTANT"))
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        from: e.from.replace(/<[^>]+>/, "").replace(/"/g, "").trim(),
        subject: e.subject,
        why: "Não lido e marcado como importante",
        action: "Ler",
        priority: "media" as const,
        link: `https://mail.google.com/mail/u/0/#all/${e.threadId}`,
      })),
    toReply,
    weather,
    readings: readings.items,
    tasks: tasks.slice(0, 8),
    sources,
    aiUsed: false,
  };

  if (config.anthropicKey) {
    try {
      const ai = await buildWithAI(today, events, emails, tasks);
      brief = { ...brief, ...ai, aiUsed: true };
      sources.ia = "ok";
    } catch (err) {
      console.error("[ia] falhou:", (err as Error).message);
      sources.ia = "erro";
    }
  } else {
    sources.ia = "desligado";
  }

  if (config.dryRun) {
    await writeFile("brief.json", JSON.stringify(brief, null, 2));
    console.log("DRY_RUN: brief escrito em job/brief.json (não guardado no Supabase)");
  } else {
    await saveBrief(brief);
    console.log(`Brief de ${today} guardado. Fontes:`, sources);
    try {
      console.log("Resumo da semana:", await maybeSendWeekly(today, weather, readings.fresh ? readings.items.length : 0));
    } catch (err) {
      console.error("[semana] falhou:", (err as Error).message);
    }
    try {
      console.log("Fecho do dia:", await maybeSendEvening(today, events, appTasks, toReply));
    } catch (err) {
      console.error("[fecho] falhou:", (err as Error).message);
    }
  }
}

main().catch((err) => {
  // Repositório público: os logs do Actions são públicos. Só a mensagem, nunca dados.
  console.error("Falhou:", (err as Error).message);
  process.exit(1);
});
