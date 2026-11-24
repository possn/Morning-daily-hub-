// Recebe os eventos do calendário do hospital enviados pelo Atalho do iOS.
// Autenticação: cabeçalho "Authorization: Bearer <INGEST_TOKEN>" (secret só teu).
// Deploy: supabase functions deploy ingest-outlook --no-verify-jwt
//
// Corpo aceite (JSON): { "events": [ { "title", "start", "end", "allDay"?, "location"?, "calendar"? } ], "from"?: ISO, "to"?: ISO }
// O Atalho envia a janela [from, to): os eventos dessa janela são substituídos (assim apagados/movidos no Outlook desaparecem).

import { createClient } from "jsr:@supabase/supabase-js@2";

const INGEST_TOKEN = Deno.env.get("INGEST_TOKEN") ?? "";
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

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
  const s = v.trim().replace(" ", "T");
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!INGEST_TOKEN || !OWNER || !safeEqual(auth, INGEST_TOKEN)) return new Response("Unauthorized", { status: 401 });

  let body: { events?: In[] | string; from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }
  // O Atalho pode mandar a lista como array JSON ou como texto (um dicionário por linha).
  let raw: In[] = [];
  if (Array.isArray(body.events)) raw = body.events;
  else if (typeof body.events === "string") raw = parseLoose(body.events);

  const rows = [];
  for (const e of raw.slice(0, 500)) {
    const start = toIso(e.start);
    const end = toIso(e.end) ?? start;
    if (!start || !end || !e.title) continue;
    rows.push({
      user_id: OWNER,
      uid: await sha(`${e.calendar ?? ""}|${e.title}|${start}`),
      title: String(e.title).slice(0, 300),
      start_at: start,
      end_at: end,
      all_day: e.allDay === true || e.allDay === "true" || e.allDay === "Sim" || e.allDay === "Yes",
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
  return Response.json({ ok: true, received: raw.length, stored: rows.length });
});
