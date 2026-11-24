// Envio de notificações Web Push para as subscrições do dono.
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

export async function loadConfig(sb: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await sb.from("app_config").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, string>;
}

export async function setConfig(sb: SupabaseClient, key: string, value: string): Promise<void> {
  await sb.from("app_config").upsert({ key, value, updated_at: new Date().toISOString() });
}

export async function sendPush(
  sb: SupabaseClient,
  cfg: Record<string, string>,
  owner: string,
  msg: { title: string; body: string },
): Promise<number> {
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
