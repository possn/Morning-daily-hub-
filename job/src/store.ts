import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import type { Brief } from "./types.js";

export async function saveBrief(brief: Brief): Promise<void> {
  const { url, serviceKey, ownerUserId } = config.supabase;
  if (!url || !serviceKey || !ownerUserId) throw new Error("Supabase não configurado");
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await sb
    .from("briefs")
    .upsert({ user_id: ownerUserId, brief_date: brief.date, payload: brief }, { onConflict: "user_id,brief_date" });
  if (error) throw new Error(`Supabase: ${error.code ?? "erro"}`);
}
