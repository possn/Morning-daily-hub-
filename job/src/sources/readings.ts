// Leituras da semana: artigos novos de cuidados intensivos pediátricos no PubMed (E-utilities, gratuito, sem chave).
// Só sai daqui a pesquisa bibliográfica; nenhum dado pessoal é enviado ao PubMed nem à IA.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config.js";
import type { Reading } from "../types.js";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "daily-hub";

const PEDIATRIC = "(child*[tiab] OR pediatric*[tiab] OR paediatric*[tiab] OR infant*[tiab] OR neonat*[tiab] OR adolescen*[tiab])";
const CRITICAL =
  '("intensive care"[tiab] OR "critical care"[tiab] OR "critically ill"[tiab] OR PICU[tiab] OR sepsis[tiab] OR "septic shock"[tiab] OR "mechanical ventilation"[tiab] OR resuscitation[tiab] OR ECMO[tiab] OR ARDS[tiab])';

export const QUERY = [
  "(",
  '"Pediatr Crit Care Med"[ta]',
  ` OR (("Intensive Care Med"[ta] OR "Crit Care Med"[ta] OR "Crit Care"[ta] OR "Am J Respir Crit Care Med"[ta] OR "N Engl J Med"[ta] OR "JAMA"[ta] OR "Lancet"[ta] OR "Resuscitation"[ta]) AND ${PEDIATRIC})`,
  ` OR (("Lancet Child Adolesc Health"[ta] OR "JAMA Pediatr"[ta] OR "Pediatrics"[ta] OR "Arch Dis Child"[ta]) AND ${CRITICAL})`,
  ")",
  " AND hasabstract",
  " NOT (Editorial[pt] OR Comment[pt] OR Letter[pt] OR Erratum[pt] OR News[pt])",
].join("");

type Article = { pmid: string; title: string; journal: string; types: string[]; abstract: string };

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

export function parseArticles(xml: string): Article[] {
  return xml.split("<PubmedArticle>").slice(1).map((block) => {
    const one = (re: RegExp) => decode(block.match(re)?.[1] ?? "");
    const abstract = [...block.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => {
        const label = m[1].match(/Label="([^"]+)"/)?.[1];
        return `${label ? `${label}: ` : ""}${decode(m[2])}`;
      })
      .join(" ");
    return {
      pmid: one(/<PMID[^>]*>(\d+)<\/PMID>/),
      title: one(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/),
      journal: one(/<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/) || one(/<Title>([\s\S]*?)<\/Title>/),
      types: [...block.matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g)].map((m) => decode(m[1])),
      abstract,
    };
  }).filter((a) => a.pmid && a.title);
}

/** Tipo de estudo a partir dos tipos de publicação do PubMed (sem IA). */
export function designOf(types: string[]): string {
  const t = types.join("|").toLowerCase();
  if (t.includes("meta-analysis")) return "Meta-análise";
  if (t.includes("systematic review")) return "Revisão sistemática";
  if (t.includes("randomized controlled trial")) return "Ensaio aleatorizado";
  if (t.includes("practice guideline") || t.includes("guideline") || t.includes("consensus")) return "Recomendações";
  if (t.includes("clinical trial")) return "Ensaio clínico";
  if (t.includes("multicenter study")) return "Estudo multicêntrico";
  if (t.includes("observational study")) return "Estudo observacional";
  if (t.includes("review")) return "Revisão";
  return "Artigo original";
}

async function eutils(path: string, params: Record<string, string>): Promise<Response> {
  const q = new URLSearchParams({ db: "pubmed", tool: TOOL, ...params });
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${EUTILS}/${path}?${q}`);
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) throw new Error(`PubMed ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error("PubMed indisponível");
}

const Pick = z.object({
  items: z.array(
    z.object({
      pmid: z.string(),
      design: z.string().describe("Tipo de estudo em português, no máximo 5 palavras (ex.: «Ensaio aleatorizado multicêntrico», «Coorte retrospetiva»)"),
      summary: z.string().describe("2 frases em português europeu: pergunta/população e resultado principal com números se existirem"),
      details: z.object({
        pergunta: z.string().describe("Pergunta do estudo, 1 frase"),
        desenho: z.string().describe("Desenho, contexto (centros, países) e período, 1–2 frases"),
        populacao: z.string().describe("População: n, idades, critérios principais"),
        resultados: z.string().describe("Outcome primário e secundários relevantes com os números do resumo (efeito, IC 95%, p); 2–4 frases"),
        limitacoes: z.string().describe("Limitações evidentes pelo desenho ou referidas no resumo; não inventes"),
        pratica: z.string().describe("Implicação prática para cuidados intensivos pediátricos e grau de confiança (ex.: muda a prática / gera hipótese), 1–2 frases"),
      }),
    }),
  ).describe("Os 5 artigos mais relevantes para a prática em cuidados intensivos pediátricos, por ordem"),
});

/** Procura os artigos dos últimos 7 dias e escolhe até 5. */
export async function fetchReadings(days = 7): Promise<Reading[]> {
  const search = (await (await eutils("esearch.fcgi", {
    term: QUERY,
    retmode: "json",
    retmax: "60",
    reldate: String(days),
    datetype: "edat",
    sort: "relevance",
  })).json()) as { esearchresult?: { idlist?: string[] } };
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const xml = await (await eutils("efetch.fcgi", { id: ids.join(","), retmode: "xml" })).text();
  const articles = parseArticles(xml);
  const byId = new Map(articles.map((a) => [a.pmid, a]));
  const toReading = (a: Article, design: string, summary: string, details?: Reading["details"]): Reading => ({
    pmid: a.pmid,
    title: a.title.slice(0, 300),
    journal: a.journal,
    design: design.length > 70 ? `${design.slice(0, 69)}…` : design,
    summary: summary.slice(0, 500),
    ...(details ? { details } : {}),
    link: `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`,
  });

  if (config.anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: config.anthropicKey });
      const input = articles.slice(0, 30).map((a) => ({
        pmid: a.pmid,
        journal: a.journal,
        types: a.types,
        title: a.title,
        abstract: a.abstract.slice(0, 4000), // resumo completo (os resultados vêm no fim)
      }));
      const res = await client.beta.messages.parse({
        model: config.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(Pick) },
        system:
          "Escolhes leituras semanais para um médico de cuidados intensivos pediátricos em Portugal. " +
          "Prioriza: ensaios aleatorizados, meta-análises, recomendações e grandes coortes com impacto na prática; " +
          "população pediátrica crítica. Evita relatos de caso e estudos pequenos sem impacto prático. " +
          "Resume só o que está no resumo do artigo, sem extrapolar nem inventar números. " +
          "Se um dado não estiver no resumo, escreve «não referido no resumo». Português europeu, linguagem técnica médica.",
        messages: [{ role: "user", content: JSON.stringify(input) }],
      });
      const picked = (res.parsed_output?.items ?? []).flatMap((x) => {
        const a = byId.get(x.pmid);
        return a ? [toReading(a, x.design, x.summary, x.details)] : [];
      });
      if (picked.length) return picked.slice(0, 5);
    } catch (err) {
      console.error("[leituras] IA falhou:", (err as Error).message);
    }
  }
  // Sem IA: primeiro os desenhos mais fortes, com a primeira frase do resumo.
  const rank = ["Meta-análise", "Revisão sistemática", "Ensaio aleatorizado", "Recomendações", "Ensaio clínico", "Estudo multicêntrico"];
  return articles
    .map((a) => ({ a, d: designOf(a.types) }))
    .sort((x, y) => (rank.indexOf(x.d) + 1 || 99) - (rank.indexOf(y.d) + 1 || 99))
    .slice(0, 5)
    .map(({ a, d }) => toReading(a, d, a.abstract.split(/(?<=\.)\s/).slice(0, 2).join(" ")));
}
