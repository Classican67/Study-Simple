import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activiteParJour,
  cleJour,
  decalerJour,
  grilleActivite,
  jourDeSemaine,
  previsionEcheances,
  series,
  tauxReussite,
} from "@/lib/statistiques";

const PARIS = "Europe/Paris";

describe("les jours", () => {
  it("une révision à minuit et demi à Paris tombe le bon jour", () => {
    // 22 h 30 UTC : encore le 14 à Greenwich, déjà le 15 à Paris en été.
    assert.equal(cleJour(new Date("2026-07-14T22:30:00Z"), PARIS), "2026-07-15");
    assert.equal(cleJour(new Date("2026-07-14T22:30:00Z"), "UTC"), "2026-07-14");
  });

  it("décaler traverse un changement d'heure sans sauter de jour", () => {
    assert.equal(decalerJour("2026-03-28", 2), "2026-03-30");
    assert.equal(decalerJour("2026-10-24", 2), "2026-10-26");
  });

  it("change de mois et d'année", () => {
    assert.equal(decalerJour("2026-01-01", -1), "2025-12-31");
  });

  it("la semaine commence le lundi", () => {
    assert.equal(jourDeSemaine("2026-11-02"), 0);
    assert.equal(jourDeSemaine("2026-11-08"), 6);
  });
});

describe("activité", () => {
  it("compte les réponses et les justes par jour", () => {
    const jours = activiteParJour(
      [
        { answeredAt: new Date("2026-05-01T10:00:00Z"), knew: true },
        { answeredAt: new Date("2026-05-01T11:00:00Z"), knew: false },
      ],
      PARIS,
    );
    assert.deepEqual(jours.get("2026-05-01"), { jour: "2026-05-01", reponses: 2, reussies: 1 });
  });

  it("le taux ne s'invente pas quand rien ne permet de le dire", () => {
    assert.equal(tauxReussite([]), null);
    assert.equal(tauxReussite([{ jour: "x", reponses: 3, reussies: 2 }]), 67);
  });
});

describe("série", () => {
  const jours = (...liste: string[]) => new Set(liste);

  it("compte les jours consécutifs jusqu'à aujourd'hui", () => {
    assert.equal(series(jours("2026-05-08", "2026-05-09", "2026-05-10"), "2026-05-10").actuelle, 3);
  });

  it("aujourd'hui, pas encore révisé, ne casse pas la série", () => {
    assert.equal(series(jours("2026-05-08", "2026-05-09"), "2026-05-10").actuelle, 2);
  });

  it("deux jours sans révision la remettent à zéro", () => {
    assert.equal(series(jours("2026-05-07", "2026-05-08"), "2026-05-10").actuelle, 0);
  });

  it("la meilleure série survit à la série en cours", () => {
    const { actuelle, meilleure } = series(
      jours("2026-04-01", "2026-04-02", "2026-04-03", "2026-05-10"),
      "2026-05-10",
    );
    assert.equal(actuelle, 1);
    assert.equal(meilleure, 3);
  });

  it("rien, c'est zéro", () => {
    assert.deepEqual(series(jours(), "2026-05-10"), { actuelle: 0, meilleure: 0 });
  });
});

describe("grille", () => {
  const vide = new Map();

  it("fait des colonnes de sept jours, du lundi au dimanche", () => {
    const grille = grilleActivite(vide, "2026-11-05", 26);
    assert.equal(grille.length, 26);
    assert.ok(grille.every((c) => c.length === 7));
    assert.equal(jourDeSemaine(grille[0][0].jour), 0);
  });

  it("finit sur la semaine en cours, et ne montre pas l'avenir comme un jour vide", () => {
    const grille = grilleActivite(vide, "2026-11-05", 26);
    const derniere = grille.at(-1)!;
    assert.equal(derniere[3].jour, "2026-11-05");
    assert.equal(derniere[3].futur, false);
    assert.equal(derniere[4].futur, true);
  });

  it("les paliers suivent les volumes de la personne", () => {
    const jours = new Map(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n, i) => {
        const jour = decalerJour("2026-11-05", -i);
        return [jour, { jour, reponses: n * 10, reussies: 0 }];
      }),
    );
    const cases = grilleActivite(jours, "2026-11-05", 4).flat();
    const niveau = (n: number) => cases.find((c) => c.reponses === n)!.niveau;
    assert.ok(niveau(10) < niveau(80));
    assert.equal(cases.find((c) => c.reponses === 0)!.niveau, 0);
    assert.equal(niveau(80), 4);
  });
});

describe("prévision", () => {
  const dates = (...liste: string[]) => liste.map((d) => new Date(d));

  it("le retard compte pour aujourd'hui", () => {
    const jours = previsionEcheances(dates("2026-01-01T10:00:00Z"), "2026-05-10", PARIS);
    assert.equal(jours[0].cartes, 1);
  });

  it("répartit jour par jour, et laisse ce qui est trop loin", () => {
    const jours = previsionEcheances(
      dates("2026-05-11T10:00:00Z", "2026-05-11T12:00:00Z", "2026-09-01T10:00:00Z"),
      "2026-05-10",
      PARIS,
    );
    assert.equal(jours.length, 14);
    assert.equal(jours[1].cartes, 2);
    assert.equal(jours.reduce((s, j) => s + j.cartes, 0), 2);
  });
});
