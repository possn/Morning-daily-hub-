// Prepara um rascunho de resposta a um email parado e guarda-o nos Rascunhos do Gmail.
// Nada é enviado: o Pedro revê e envia no Gmail.
// Secrets necessários (Supabase > Edge Functions > Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (com o âmbito gmail.compose), ANTHROPIC_API_KEY
// Corpo: { "threadId": "<id da conversa no Gmail>" }
import { cors, json, requireOwner } from "../_shared/owner.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MODEL = Deno.env.get("CLAUDE_DRAFT_MODEL") ?? "claude-sonnet-5-5";

// Minimização antes de enviar o texto para a IA (mesmas regras base do job).
const RULES: [RegExp, string][] = [
  [/\bNP\s*[.:#-]?\s*\d{5,}/gi, "[PROCESSO]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]"],
  [/(?:\+351[\s-]?)?\b[29]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, "[TELEFONE]"],
  [/\b(?:n\.?º?\s*)?(?:utente|sns|nif|processo|proc\.?|episódio|episodio|cama)\s*[:nº#.\s-]*\s*[A-Z]?\d{1,12}\b/gi, "[ID]"],
  [/\b\d{7,}\b/g, "[NUM]"],
  [/\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/g, "[DATA]"],
];
const redact = (t: string) => RULES.reduce((s, [re, rep]) => s.replace(re, rep), t);

async function googleToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
type Msg = { id: string; labelIds?: string[]; payload: Part & { headers: { name: string; value: string }[] } };

const b64urlDecode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
const b64url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function plainText(p: Part): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64urlDecode(p.body.data);
  for (const c of p.parts ?? []) {
    const t = plainText(c);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data) return b64urlDecode(p.body.data).replace(/<[^>]+>/g, " ");
  return "";
}

// Tira o texto citado ("Em ... escreveu:", linhas com ">") para mandar só a última mensagem.
const stripQuoted = (t: string) =>
  t.split(/\n(?:Em .+escreveu:|On .+wrote:|-----Original Message-----|De: .+\nEnviado)/)[0]
    .split("\n").filter((l) => !l.startsWith(">")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey || !Deno.env.get("GOOGLE_REFRESH_TOKEN")) return json({ error: "Faltam secrets no Supabase" }, 500);

  const { threadId } = (await req.json().catch(() => ({}))) as { threadId?: string };
  if (!threadId || !/^[\w-]{6,40}$/.test(threadId)) return json({ error: "pedido inválido" }, 400);

  try {
    const token = await googleToken();
    const g = (path: string, init?: RequestInit) =>
      fetch(`${GMAIL}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });

    const tRes = await g(`/threads/${threadId}?format=full`);
    if (!tRes.ok) return json({ error: `Gmail ${tRes.status}` }, 502);
    const thread = (await tRes.json()) as { messages: Msg[] };
    const incoming = thread.messages.filter((m) => !m.labelIds?.includes("SENT"));
    const last = incoming[incoming.length - 1] ?? thread.messages[thread.messages.length - 1];
    const h = (n: string) => last.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const subject = h("subject");
    const from = h("from");
    const body = redact(stripQuoted(plainText(last.payload))).slice(0, 4000);

    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system:
          "Escreves rascunhos de resposta a emails para o Pedro Nunes, médico de cuidados intensivos pediátricos em Portugal. " +
          "Responde na língua do email (por omissão português europeu), tom cordial, direto e curto. " +
          "Não inventes factos, datas, compromissos nem dados clínicos: quando faltar informação, deixa um marcador entre parênteses retos, por exemplo [confirmar data]. " +
          "O texto foi pseudonimizado ([EMAIL], [ID], etc.); não tentes reconstruir. " +
          "Devolve só o corpo do email, sem assunto, terminando com «Cumprimentos,\nPedro Nunes».",
        messages: [{ role: "user", content: `Assunto: ${redact(subject)}\nDe: ${redact(from.replace(/<[^>]+>/, ""))}\n\n${body}` }],
      }),
    });
    if (!ai.ok) return json({ error: `IA ${ai.status}` }, 502);
    const text = ((await ai.json()) as { content: { type: string; text?: string }[] }).content
      .filter((c) => c.type === "text").map((c) => c.text).join("").trim();

    const msgId = h("message-id");
    const refs = [h("references"), msgId].filter(Boolean).join(" ");
    const reSubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
    const head = [
      `To: ${h("reply-to") || from}`,
      `Subject: ${encodeHeader(reSubject)}`,
      msgId && `In-Reply-To: ${msgId}`,
      refs && `References: ${refs}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
    ].filter(Boolean);
    const raw = `${head.join("\r\n")}\r\n\r\n${text}`;

    const d = await g("/drafts", { method: "POST", body: JSON.stringify({ message: { raw: b64url(raw), threadId } }) });
    if (!d.ok) return json({ error: d.status === 403 ? "Falta autorização para criar rascunhos (gmail.compose)" : `Gmail ${d.status}` }, 502);
    return json({ ok: true, link: `https://mail.google.com/mail/u/0/#drafts` });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
