// Minimização de dados antes de qualquer envio para a IA.
//
// Limite honesto: isto é redução de risco por padrões, NÃO é anonimização no
// sentido do RGPD (considerando 26). Nomes de doentes em texto livre não são
// detetáveis com fiabilidade por regex. Por isso a primeira linha de defesa é
// NÃO enviar: domínios e pastas bloqueados, e só assunto + excerto curto do email.

import { config } from "./config.js";

const RULES: Array<[RegExp, string]> = [
  // Emails e telefones
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]"],
  [/(?:\+351[\s-]?)?\b[29]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, "[TELEFONE]"],
  // Identificadores com contexto (nº utente SNS, NIF, processo, episódio, cama)
  [/\b(?:n\.?º?\s*)?(?:utente|sns|nif|nus|processo|proc\.?|episódio|episodio|epis\.?|nº\s*cl[ií]nico|cama|quarto|box)\s*[:nº#.\s-]*\s*[A-Z]?\d{1,12}\b/gi, "[ID]"],
  // Qualquer sequência longa de dígitos (nº utente/NIF/processo sem contexto)
  [/\b\d{7,}\b/g, "[NUM]"],
  // Datas completas (possíveis datas de nascimento)
  [/\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/g, "[DATA]"],
  [/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g, "[DATA]"],
  // Idades pediátricas ("3 meses", "2A", "5 anos")
  [/\b\d{1,2}\s?(?:anos|ano|meses|mês|mes|dias|semanas|sem|A|M|D)\b(?=\W)/g, "[IDADE]"],
  // Nome após termos clínicos ("doente João Silva", "a criança Maria")
  [/\b(doente|utente|criança|crianca|bebé|bebe|lactente|rn|recém-nascido|menino|menina|mãe|pai|sr\.?|sra\.?|d\.)\s+(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'-]+(?:\s+(?:da|de|do|dos|das|e)?\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'-]+){0,4})/giu, "$1 [NOME]"],
  // Iniciais tipo "J.S." ou "JMS"
  [/\b[A-Z]\.\s?[A-Z]\.(?:\s?[A-Z]\.)?/g, "[INICIAIS]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  for (const term of config.privacy.extraTerms) {
    if (!term) continue;
    out = out.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[RESERVADO]");
  }
  return out;
}

export function isBlockedSender(from: string): boolean {
  const f = from.toLowerCase();
  return config.privacy.blockedDomains.some((d) => f.includes(`@${d.toLowerCase()}`) || f.endsWith(d.toLowerCase()));
}

export function isBlockedPath(relPath: string): boolean {
  const p = relPath.toLowerCase();
  return config.privacy.blockedFolders.some((f) => p.startsWith(f.toLowerCase().replace(/\/?$/, "/")));
}

/** Corta e limpa: nunca mais do que `max` caracteres saem por campo. */
export function clip(text: string, max = 280): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
