import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "./redact.js";

test("remove identificadores típicos", () => {
  const s = redact("Doente João Silva, processo 1234567, utente 123456789, nasc. 03/04/2021, tel 912 345 678, cama 12");
  assert.ok(!/João|Silva|1234567|123456789|03\/04\/2021|912/.test(s), s);
});

test("mantém texto não clínico", () => {
  assert.equal(redact("Reunião de serviço às 14h"), "Reunião de serviço às 14h");
});

test("remove idades e emails", () => {
  const s = redact("Lactente de 3 meses, contactar ana@hospital.pt");
  assert.ok(!/3 meses|ana@/.test(s), s);
});
