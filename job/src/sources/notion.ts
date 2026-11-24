import { config } from "../config.js";
import type { TaskItem } from "../types.js";

// API oficial do Notion. A integração tem de ser partilhada com cada base de dados
// (menu "..." da base de dados > Connections > adicionar a integração).

type Prop = { type: string; [k: string]: any };

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  "notion-version": "2022-06-28",
  "content-type": "application/json",
});

// Sem NOTION_TASK_DATABASE_IDS: usa as bases de dados partilhadas com a integração
// que pareçam de tarefas (nome com tarefa/task/to-do) ou, se não houver, todas.
async function discoverDatabases(token: string): Promise<string[]> {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ filter: { property: "object", value: "database" }, page_size: 50 }),
  });
  if (!res.ok) throw new Error(`Notion HTTP ${res.status}`);
  const data = (await res.json()) as { results: any[] };
  const all = data.results.map((d) => ({ id: d.id as string, name: (d.title ?? []).map((t: any) => t.plain_text).join("") }));
  const tasks = all.filter((d) => /tarefa|task|to-?do|afazer/i.test(d.name));
  return (tasks.length ? tasks : all).map((d) => d.id);
}

export async function fetchNotionTasks(): Promise<TaskItem[]> {
  const { token, doneValues } = config.notion;
  if (!token) return [];
  const databaseIds = config.notion.databaseIds.length ? config.notion.databaseIds : await discoverDatabases(token);
  const out: TaskItem[] = [];

  for (const db of databaseIds) {
    let cursor: string | undefined;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      });
      if (!res.ok) throw new Error(`Notion HTTP ${res.status}`);
      const data = (await res.json()) as { results: any[]; has_more: boolean; next_cursor: string | null };

      for (const page of data.results) {
        const props: Record<string, Prop> = page.properties ?? {};
        const title = Object.values(props).find((p) => p.type === "title");
        const name = title?.title?.map((t: any) => t.plain_text).join("") ?? "";
        if (!name.trim()) continue;
        if (isDone(props, doneValues)) continue;
        const due = Object.values(props).find((p) => p.type === "date" && p.date?.start)?.date?.start as string | undefined;
        out.push({
          id: `n:${page.id}`,
          source: "notion",
          title: name.trim(),
          due: due?.slice(0, 10),
          priority: priorityOf(props),
          link: page.url,
        });
      }
      cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
    } while (cursor);
  }
  return out;
}

function isDone(props: Record<string, Prop>, doneValues: string[]): boolean {
  for (const p of Object.values(props)) {
    if (p.type === "checkbox" && /done|feito|conclu/i.test(String(p.name ?? "")) && p.checkbox) return true;
    const v = p.type === "status" ? p.status?.name : p.type === "select" ? p.select?.name : undefined;
    if (v && doneValues.includes(String(v).toLowerCase())) return true;
  }
  // checkbox genérico (ex.: "Done") sem nome no objeto: procura por chave
  for (const [k, p] of Object.entries(props)) {
    if (p.type === "checkbox" && /done|feito|conclu/i.test(k) && p.checkbox) return true;
  }
  return false;
}

function priorityOf(props: Record<string, Prop>): TaskItem["priority"] {
  for (const [k, p] of Object.entries(props)) {
    if (!/prior/i.test(k)) continue;
    const v = (p.select?.name ?? p.status?.name ?? "").toLowerCase();
    if (/alta|high|urgente|p1/.test(v)) return "alta";
    if (/baixa|low|p3/.test(v)) return "baixa";
  }
  return "media";
}
