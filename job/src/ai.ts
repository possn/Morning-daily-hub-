import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config.js";
import { clip, isBlockedSender, redact } from "./redact.js";
import type { CalEvent, EmailItem, TaskItem } from "./types.js";
import type { RawEmail } from "./sources/google.js";

const Priority = z.enum(["alta", "media", "baixa"]);

const BriefSchema = z.object({
  headline: z.string().describe("Uma frase curta que resume o dia (máx. 80 caracteres)"),
  summary: z.string().describe("2 a 3 frases sobre o dia: carga, pontos críticos, janelas livres"),
  focus: z.array(z.string()).describe("Até 3 prioridades concretas para hoje"),
  emails: z.array(
    z.object({
      ref: z.string().describe("O campo ref do email escolhido"),
      why: z.string().describe("Porque é relevante, uma frase"),
      action: z.string().describe("Ação concreta sugerida, curta"),
      priority: Priority,
      task: z.string().nullable().describe("Se o email pede algo a fazer, a tarefa em poucas palavras começando por um verbo (ex.: «Submeter resumo ao congresso»); senão null"),
      due: z.string().nullable().describe("Prazo explícito no email em YYYY-MM-DD, calculado a partir de hoje; null se não houver prazo"),
    }),
  ).describe("Só os emails que exigem atenção ou ação; ignora newsletters e notificações automáticas"),
  tasks: z.array(
    z.object({ ref: z.string(), priority: Priority }),
  ).describe("Até 8 tarefas mais relevantes para hoje e amanhã, por ordem"),
});

const SYSTEM = `És o assistente matinal de um médico de cuidados intensivos pediátricos em Portugal.
Escreve em português europeu, tom direto e calmo, sem floreados.
Recebes a agenda (inclui a escala de urgência), emails recentes e tarefas pendentes.
Escolhe apenas o que exige atenção. Se houver urgência/banco hoje ou amanhã, menciona-o no resumo.
Ele trabalha normalmente no dia seguinte a um banco: não sugiras folga nem descanso pós-urgência.
Os dados foram pseudonimizados ([NOME], [ID], etc.). Nunca tentes reconstruir identidades
e nunca incluas dados clínicos ou de doentes na resposta.`;

export interface AiResult {
  headline: string;
  summary: string;
  focus: string[];
  emails: EmailItem[];
  tasks: TaskItem[];
}

export async function buildWithAI(
  today: string,
  events: CalEvent[],
  emails: RawEmail[],
  tasks: TaskItem[],
): Promise<AiResult> {
  const client = new Anthropic({ apiKey: config.anthropicKey });

  // Minimização: só o necessário sai do job, e tudo passa pelo filtro.
  const emailRefs = new Map<string, RawEmail>();
  const emailLines = emails.map((e, i) => {
    const ref = `e${i}`;
    emailRefs.set(ref, e);
    if (isBlockedSender(e.from)) {
      return { ref, from: domainOnly(e.from), subject: "[conteúdo reservado]", excerpt: "" };
    }
    return {
      ref,
      from: redact(senderName(e.from)),
      subject: redact(clip(e.subject, 140)),
      excerpt: redact(clip(e.snippet, 220)),
      unread: e.labels.includes("UNREAD"),
      important: e.labels.includes("IMPORTANT"),
    };
  });

  const taskRefs = new Map<string, TaskItem>();
  const taskLines = tasks.map((t, i) => {
    const ref = `t${i}`;
    taskRefs.set(ref, t);
    return { ref, source: t.source, title: redact(clip(t.title, 160)), due: t.due, priority: t.priority };
  });

  const horizon = events.filter((e) => e.start.slice(0, 10) <= addOne(today));
  const eventLines = horizon.map((e) => ({
    type: e.source,
    title: redact(clip(e.title, 100)),
    start: e.start,
    end: e.end,
    allDay: e.allDay,
  }));

  const diaSemana = new Date(`${today}T12:00:00Z`).toLocaleDateString("pt-PT", { weekday: "long", timeZone: "UTC" });
  const input = { hoje: today, dia_da_semana: diaSemana, agenda_hoje_e_amanha: eventLines, emails: emailLines, tarefas: taskLines };

  const response = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(BriefSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`Resposta da IA sem conteúdo utilizável (stop_reason=${response.stop_reason})`);
  }
  const out = response.parsed_output;

  return {
    headline: out.headline,
    summary: out.summary,
    focus: out.focus.slice(0, 3),
    emails: out.emails.flatMap((x) => {
      const e = emailRefs.get(x.ref);
      if (!e) return [];
      const blocked = isBlockedSender(e.from);
      return [{
        id: e.id,
        // O texto mostrado na app vem do Gmail original (fica só entre Google, Supabase e o teu iPhone).
        from: senderName(e.from),
        subject: e.subject,
        why: blocked ? "Email de domínio reservado" : x.why,
        action: x.action,
        priority: x.priority,
        link: `https://mail.google.com/mail/u/0/#all/${e.threadId}`,
        ...(x.task && !blocked ? { task: x.task.slice(0, 200) } : {}),
        ...(x.due && /^\d{4}-\d{2}-\d{2}$/.test(x.due) && x.due >= today ? { due: x.due } : {}),
      }];
    }),
    tasks: out.tasks.flatMap((x) => {
      const t = taskRefs.get(x.ref);
      return t ? [{ ...t, priority: x.priority }] : [];
    }),
  };
}

function senderName(from: string): string {
  return from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || from;
}
function domainOnly(from: string): string {
  return from.match(/@([\w.-]+)/)?.[1] ?? "remetente reservado";
}
function addOne(d: string): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
