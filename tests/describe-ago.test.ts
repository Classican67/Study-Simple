import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeAgo } from "@/lib/scheduling";

const now = new Date("2026-09-03T14:00:00");
const ago = (ms: number) => describeAgo(new Date(now.getTime() - ms), now);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("describeAgo", () => {
  it("arrondit les minutes récentes", () => {
    assert.equal(ago(0), "à l'instant");
    assert.equal(ago(30_000), "à l'instant");
    assert.equal(ago(MIN), "il y a 1 min");
    assert.equal(ago(59 * MIN), "il y a 59 min");
  });

  it("passe aux heures dans la journée", () => {
    assert.equal(ago(HOUR), "il y a 1 h");
    // 14 h moins 13 h = 1 h du matin, toujours aujourd'hui.
    assert.equal(ago(13 * HOUR), "il y a 13 h");
  });

  it("compare des jours calendaires, pas des tranches de 24 h", () => {
    // Révisé hier à 23 h, consulté ce matin : « hier » est plus juste que
    // « il y a 15 h ».
    const hier = new Date("2026-09-02T23:00:00");
    assert.equal(describeAgo(hier, new Date("2026-09-03T08:00:00")), "hier");
  });

  it("compte les jours puis les semaines", () => {
    assert.equal(describeAgo(new Date("2026-08-31T10:00:00"), now), "il y a 3 jours");
    assert.equal(describeAgo(new Date("2026-08-28T10:00:00"), now), "il y a 6 jours");
    assert.equal(describeAgo(new Date("2026-08-27T10:00:00"), now), "il y a une semaine");
    // 10 août → 3 septembre = 24 jours, soit 3 semaines arrondies.
    assert.equal(describeAgo(new Date("2026-08-10T10:00:00"), now), "il y a 3 semaines");
    assert.equal(describeAgo(new Date("2026-06-03T10:00:00"), now), "il y a 3 mois");
  });

  it("ne produit jamais de durée négative", () => {
    // Horloge du serveur en avance, ou reprise dans la même seconde.
    assert.equal(describeAgo(new Date(now.getTime() + 5 * MIN), now), "à l'instant");
  });
});
