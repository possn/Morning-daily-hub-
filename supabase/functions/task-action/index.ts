// Ações nas tarefas do Notion a partir da app: marcar como feita ou passar para amanhã.
// Secret necessário (Supabase > Edge Functions > Secrets): NOTION_TOKEN.
// Corpo: { "id": "n:<page id>", "action": "done" | "tomorrow" }
import { cors, json, requireOwner, sb } from "../_shared/owner.ts";

const NOTION = "https://api.notion.com/v1";
const DONE = ["done", "concluído", "concluido", "concluida", "concluída", "feito", "completed", "complete"];
const TZ = "Europe/Lisbon";

function headers(token: string) {
  return { authorization: `Bearer ${token}`, "notion-version": "2022-06-28", "content-type": "application/json" };
}

type Prop = { id: string; type: string; [k: string]: any };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  const token = Deno.env.get("NOTION_TOKEN");
  if (!token) return json({ error: "Falta o NOTION_TOKEN nos secrets do Supabase" }, 500);

  const { id, action } = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!id?.startsWith("n:") || !["done", "tomorrow"].includes(action ?? "")) return json({ error: "pedido inválido" }, 400);
  const pageId = id.slice(2);

  const pageRes = await fetch(`${NOTION}/pages/${pageId}`, { headers: headers(token) });
  if (!pageRes.ok) return json({ error: `Notion ${pageRes.status}` }, 502);
  const page = (await pageRes.json()) as { parent?: { database_id?: string }; properties: Record<string, Prop> };
  const props = page.properties;

  let update: Record<string, unknown> | null = null;
  if (action === "tomorrow") {
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
    const date = Object.entries(props).find(([k, p]) => p.type === "date" && /data|date|prazo|due|quando/i.test(k))
      ?? Object.entries(props).find(([, p]) => p.type === "date");
    if (!date) return json({ error: "Esta tarefa não tem campo de data no Notion" }, 422);
    update = { [date[0]]: { date: { start: tomorrow } } };
  } else {
    const check = Object.entries(props).find(([k, p]) => p.type === "checkbox" && /done|feito|conclu|check/i.test(k))
      ?? Object.entries(props).find(([, p]) => p.type === "checkbox");
    const status = Object.entries(props).find(([, p]) => p.type === "status")
      ?? Object.entries(props).find(([k, p]) => p.type === "select" && /estado|status/i.test(k));
    if (status && page.parent?.database_id) {
      // Escolhe a opção "feita" que existe mesmo na base de dados.
      const dbRes = await fetch(`${NOTION}/databases/${page.parent.database_id}`, { headers: headers(token) });
      const db = dbRes.ok ? ((await dbRes.json()) as { properties: Record<string, Prop> }) : null;
      const def = db?.properties[status[0]];
      const options: { name: string }[] = def?.[def.type]?.options ?? [];
      const doneOpt = options.find((o) => DONE.includes(o.name.toLowerCase()));
      if (doneOpt) update = { [status[0]]: { [status[1].type]: { name: doneOpt.name } } };
    }
    if (!update && check) update = { [check[0]]: { checkbox: true } };
    if (!update) return json({ error: "Não encontrei um estado «feito» nesta tarefa" }, 422);
  }

  const res = await fetch(`${NOTION}/pages/${pageId}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ properties: update }),
  });
  if (!res.ok) return json({ error: `Notion ${res.status}` }, 502);

  // Atualiza o brief guardado para a app não voltar a mostrar a tarefa como pendente.
  const { data: b } = await sb.from("briefs").select("brief_date,payload").eq("user_id", owner).order("brief_date", { ascending: false }).limit(1).maybeSingle();
  if (b?.payload) {
    const payload = b.payload as { tasks?: { id: string; due?: string }[] };
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
    payload.tasks = (payload.tasks ?? [])
      .filter((t) => !(action === "done" && t.id === id))
      .map((t) => (action === "tomorrow" && t.id === id ? { ...t, due: tomorrow } : t));
    await sb.from("briefs").update({ payload }).eq("user_id", owner).eq("brief_date", b.brief_date);
  }
  return json({ ok: true });
});
