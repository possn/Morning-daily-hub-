import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import type { Brief, TaskItem } from "./types.js";

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
