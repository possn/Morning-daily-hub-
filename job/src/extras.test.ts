import { test } from "node:test";
import assert from "node:assert/strict";
import { designOf, parseArticles } from "./sources/readings.js";
import { composeEvening } from "./evening.js";

test("lê artigos do XML do PubMed", () => {
  const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">40000001</PMID><Article>
    <Journal><Title>Pediatric critical care medicine</Title><ISOAbbreviation>Pediatr Crit Care Med</ISOAbbreviation></Journal>
    <ArticleTitle>Conservative oxygen &amp; <i>children</i></ArticleTitle>
    <Abstract><AbstractText Label="OBJECTIVE">To test.</AbstractText><AbstractText Label="RESULTS">Lower mortality.</AbstractText></Abstract>
    <PublicationTypeList><PublicationType UI="D016449">Randomized Controlled Trial</PublicationType></PublicationTypeList>
  </Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;
  const [a] = parseArticles(xml);
  assert.equal(a.pmid, "40000001");
  assert.equal(a.title, "Conservative oxygen & children");
  assert.equal(a.journal, "Pediatr Crit Care Med");
  assert.equal(a.abstract, "OBJECTIVE: To test. RESULTS: Lower mortality.");
  assert.equal(designOf(a.types), "Ensaio aleatorizado");
});

test("fecho do dia junta escala, primeiro compromisso e tarefas", () => {
  const msg = composeEvening(
    "2026-11-24",
    [
      { title: "Banco P", start_at: "2026-11-25T09:00:00Z", all_day: false, calendar: "Family" },
      { title: "Banco M noite", start_at: "2026-11-25T00:00:00Z", all_day: true, calendar: "Family" },
      { title: "Reunião de serviço", start_at: "2026-11-25T14:00:00Z", all_day: false, calendar: "Calendário" },
      { title: "Jantar", start_at: "2026-11-25T20:00:00Z", all_day: false, calendar: "Family" },
    ],
    [],
    [
      { id: "a:1", source: "app", title: "x", due: "2026-11-24", priority: "media" },
      { id: "a:2", source: "app", title: "y", due: "2026-11-25", priority: "media" },
    ],
    [],
  );
  assert.equal(
    msg.body,
    "Amanhã: Banco P às 09:00. Primeiro compromisso às 14:00 (Reunião de serviço). Michele de banco amanhã (noite). Por fechar hoje: 1 tarefa. Para amanhã: 1 tarefa.",
  );
});
