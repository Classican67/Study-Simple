import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { INTERVALS, describeDue, isDue, nextDueAt } from "@/lib/scheduling";

const at = (iso: string) => new Date(iso);
// Écart en JOURS CALENDAIRES : une échéance fixée à demain minuit est à moins
// de 24 h si l'on révise le soir, un écart en millisecondes la classerait donc
// à tort comme « aujourd'hui ».
const dayGap = (from: Date, to: Date) =>
  Math.round((to.getTime() - new Date(from).setHours(0, 0, 0, 0)) / 86_400_000);

const soir = at("2026-08-29T23:30:00");
const matin = at("2026-08-29T08:00:00");

describe("nextDueAt", () => {
  it("ramène immédiatement une carte ratée", () => {
    assert.equal(nextDueAt(0, soir).getTime(), soir.getTime());
    assert.equal(nextDueAt(-3, soir).getTime(), soir.getTime());
  });

  it("suit les paliers de Leitner", () => {
    INTERVALS.forEach((days, index) => {
      assert.equal(dayGap(soir, nextDueAt(index + 1, soir)), days, `palier ${index + 1}`);
    });
  });

  it("plafonne au dernier palier", () => {
    const dernier = INTERVALS[INTERVALS.length - 1];
    assert.equal(dayGap(soir, nextDueAt(50, soir)), dernier);
  });

  it("donne le même jour de retour qu'on révise le matin ou le soir", () => {
    // Sans le calage sur le début de journée, la carte du soir serait annoncée
    // « pas encore due » pendant quinze heures le lendemain.
    assert.equal(nextDueAt(1, soir).getTime(), nextDueAt(1, matin).getTime());
  });

  it("place l'échéance au début de la journée visée", () => {
    const due = nextDueAt(2, soir);
    assert.equal(due.getHours(), 0);
    assert.equal(due.getMinutes(), 0);
    assert.equal(due.getSeconds(), 0);
  });
});

describe("isDue", () => {
  it("considère comme due une carte jamais répondue", () => {
    assert.equal(isDue(null), true);
    assert.equal(isDue(undefined), true);
  });

  it("considère comme due une échéance passée ou du jour", () => {
    assert.equal(isDue(at("2026-08-28T00:00:00"), soir), true);
    // Une échéance du jour est due dès le matin, pas seulement à minuit.
    assert.equal(isDue(at("2026-08-29T00:00:00"), matin), true);
  });

  it("ne considère pas comme due une échéance future", () => {
    assert.equal(isDue(at("2026-09-05T00:00:00"), soir), false);
  });
});

describe("describeDue", () => {
  it("annonce « à réviser » pour une carte due", () => {
    assert.equal(describeDue(null), "à réviser");
    assert.equal(describeDue(at("2026-08-01T00:00:00"), soir), "à réviser");
  });

  it("annonce les échéances proches en jours", () => {
    assert.equal(describeDue(at("2026-08-30T00:00:00"), soir), "demain");
    assert.equal(describeDue(at("2026-09-01T00:00:00"), soir), "dans 3 jours");
  });

  it("annonce le palier maximal en semaines et non en mois", () => {
    // 35 jours : « dans 1 mois » serait plus vague pour la même durée.
    assert.equal(describeDue(at("2026-10-03T00:00:00"), soir), "dans 5 semaines");
  });
});
