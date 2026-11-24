import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { config } from "../config.js";
import { isBlockedPath } from "../redact.js";
import type { TaskItem } from "../types.js";

// Lê tarefas por fazer ("- [ ] ...") do vault sincronizado via plugin Obsidian Git.
// Entende o formato do plugin Tasks: 📅 data limite, ⏳ agendada, ⏫/🔼/🔽 prioridade.

const TASK_RE = /^\s*[-*]\s+\[ \]\s+(.+)$/;

export async function fetchObsidianTasks(): Promise<TaskItem[]> {
  const root = config.obsidian.vaultPath;
  if (!root) return [];
  const files = await walk(root, root);
  const tasks: TaskItem[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    if (isBlockedPath(rel)) continue; // pastas clínicas nunca são lidas
    const text = await readFile(file, "utf8");
    text.split("\n").forEach((line, i) => {
      const m = line.match(TASK_RE);
      if (!m) return;
      const raw = m[1];
      const due = raw.match(/(?:📅|⏳|🗓️?)\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
      const priority: TaskItem["priority"] = /[⏫🔺]/u.test(raw) ? "alta" : /[🔽⏬]/u.test(raw) ? "baixa" : "media";
      const title = raw
        .replace(/(?:📅|⏳|🛫|➕|✅|🗓️?)\s*\d{4}-\d{2}-\d{2}/gu, "")
        .replace(/[⏫🔼🔽🔺⏬🔁]/gu, "")
        .trim();
      if (!title) return;
      tasks.push({
        id: `o:${rel}:${i + 1}`,
        source: "obsidian",
        title,
        due,
        priority,
        context: rel.replace(/\.md$/, ""),
        link: `obsidian://open?file=${encodeURIComponent(rel.replace(/\.md$/, ""))}`,
      });
    });
  }

  // Com data primeiro, depois prioridade; limita o volume enviado à IA.
  const rank = { alta: 0, media: 1, baixa: 2 } as const;
  return tasks
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || rank[a.priority] - rank[b.priority])
    .slice(0, config.obsidian.maxTasks);
}

async function walk(dir: string, root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (entry.name.startsWith(".") || config.obsidian.excludeFolders.some((f) => rel === f || rel.startsWith(`${f}/`))) continue;
    if (entry.isDirectory()) out.push(...(await walk(full, root)));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}
