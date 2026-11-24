import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import type { Brief, Reading, TaskItem } from "./types.js";

export async function saveBrief(brief: Brief): Promise<void> {
  const { url, serviceKey, ownerUserId } = config.supabase;
  const missing = [!url && "SUPABASE_URL", !serviceKey && "SUPABASE_SERVICE_ROLE_KEY", !ownerUserId && "OWNER_USER_ID"].filter(Boolean);
  if (!url || !serviceKey || !ownerUserId) throw new Error(`Supabase não configurado: falta ${missing.join(", ")}`);
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await sb
    .from("briefs")
    .upsert({ user_id: ownerUserId, brief_date: brief.date, payload: brief }, { onConflict: "user_id,brief_date" });
  if (error) throw new Error(`Supabase: ${error.code ?? "erro"}`);
}

/** Tarefas por fazer guardadas na própria app (tabela tasks). */
export async function fetchAppTasks(): Promise<TaskItem[]> {
  const { url, serviceKey, ownerUserId } = config.supabase;
  if (!url || !serviceKey || !ownerUserId) return [];
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("tasks")
    .select("id,title,due,priority")
    .eq("user_id", ownerUserId)
    .is("done_at", null)
    .order("due", { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) throw new Error(`Supabase: ${error.code ?? "erro"}`);
  return (data ?? []).map((r) => ({
    id: `a:${r.id}`,
    source: "app" as const,
    title: r.title as string,
    due: (r.due as string | null) ?? undefined,
    priority: r.priority as TaskItem["priority"],
  }));
}

/**
 * Leituras da semana guardadas em app_config («readings»), para não pesquisar o PubMed a cada corrida.
 * Renova ao domingo à noite, quando não há nada guardado ou quando o que há tem mais de 7 dias.
 */
export async function cachedReadings(
  today: string,
  refreshNow: boolean,
  fetcher: () => Promise<Reading[]>,
): Promise<{ items: Reading[]; fresh: boolean }> {
  const { url, serviceKey } = config.supabase;
  if (!url || !serviceKey) return { items: await fetcher(), fresh: true };
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await sb.from("app_config").select("value").eq("key", "readings").maybeSingle();
  let saved: { date?: string; items?: Reading[] } = {};
  try {
    saved = data?.value ? JSON.parse(data.value as string) : {};
  } catch { /* valor antigo inválido */ }
  const old = !saved.date || saved.date <= new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
  if (!old && !(refreshNow && saved.date !== today)) return { items: saved.items ?? [], fresh: false };
  const items = await fetcher();
  if (items.length) {
    await sb.from("app_config").upsert({ key: "readings", value: JSON.stringify({ date: today, items }), updated_at: new Date().toISOString() });
  }
  return { items: items.length ? items : (saved.items ?? []), fresh: items.length > 0 };
}
