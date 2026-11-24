// Só o dono, com sessão de segundo fator (aal2), pode usar as funções que escrevem no Notion/Gmail.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

export async function requireOwner(req: Request): Promise<string | Response> {
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "sessão inválida" }, 401);
  let aal = "";
  try {
    aal = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal ?? "";
  } catch { /* token mal formado */ }
  if (aal !== "aal2") return json({ error: "falta o segundo fator" }, 403);
  const { data: cfg } = await sb.from("app_config").select("value").eq("key", "owner_user_id").maybeSingle();
  if (!cfg?.value || cfg.value !== data.user.id) return json({ error: "sem permissão" }, 403);
  return data.user.id;
}
