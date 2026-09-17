import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Brouillon, Journal } from "@/lib/brouillons";
import { attenteApres, creerSauvegarde, type Verdict } from "@/lib/sauvegarde";

/** Journal en mémoire, avec la même règle de rang que celui d'IndexedDB. */
function journalDEssai() {
  const contenu = new Map<string, Brouillon>();
  const journal: Journal = {
    async noter(brouillon) {
      contenu.set(brouillon.blockId, brouillon);
    },
    async oublier(blockId, seq) {
      const garde = contenu.get(blockId);
      if (garde && garde.seq <= seq) contenu.delete(blockId);
    },
    async effacer(blockId) {
      contenu.delete(blockId);
    },
    async lire(noteId) {
      return [...contenu.values()].filter((b) => !noteId || b.noteId === noteId);
    },
  };
  return { journal, contenu };
}

/** Minuteur manuel : le temps n'avance que lorsqu'on le demande. */
function minuteurDEssai() {
  let differes: { fn: () => void; ms: number; jeton: number }[] = [];
  let prochain = 1;
  return {
    minuteur: {
      differer(fn: () => void, ms: number) {
        const jeton = prochain++;
        differes.push({ fn, ms, jeton });
        return jeton;
      },
      annuler(jeton: unknown) {
        differes = differes.filter((d) => d.jeton !== jeton);
      },
    },
    get enAttente() {
      return differes.length;
    },
    get dernierDelai() {
      return differes.at(-1)?.ms ?? null;
    },
    /** Déclenche tout ce qui est programmé, une fois. */
    async declencher() {
      const aJouer = differes;
      differes = [];
      for (const d of aJouer) d.fn();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const BLOC = { blockId: "b1", noteId: "n1", kind: "drawing" };

/** Laisse la file dérouler ses `await` internes. */
const souffler = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("file de reprise des enregistrements", () => {
  it("écrit le journal avant de tenter le réseau", async () => {
    const { journal, contenu } = journalDEssai();
    let appels = 0;
    const sauvegarde = creerSauvegarde({
      journal,
      gigue: () => 1,
      // Le transport ne répond jamais : on regarde ce qu'il y a sur le disque
      // pendant qu'il tarde.
      envoyer: async () => {
        appels++;
        return new Promise<Verdict>(() => {});
      },
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "trait" });
    assert.equal(contenu.get("b1")?.content, "trait", "le brouillon est journalisé");
    assert.equal(appels, 1);
  });

  it("garde le brouillon tant que le serveur n'a pas confirmé", async () => {
    const { journal, contenu } = journalDEssai();
    const temps = minuteurDEssai();
    let reponse: Verdict = { sort: "reseau" };
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      envoyer: async () => reponse,
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "trait" });
    await souffler();
    assert.equal(contenu.has("b1"), true, "échec réseau : le brouillon reste");
    assert.equal(sauvegarde.diagnostic().enAttente, 1);

    reponse = { sort: "ok" };
    await temps.declencher();
    await souffler();
    assert.equal(contenu.has("b1"), false, "confirmé : le brouillon s'efface");
    assert.equal(sauvegarde.diagnostic().enAttente, 0);
    assert.equal(sauvegarde.diagnostic().etat, "repos");
  });

  it("rejoue jusqu'à ce que ça passe, en espaçant les tentatives", async () => {
    const { journal } = journalDEssai();
    const temps = minuteurDEssai();
    let essais = 0;
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      envoyer: async () => {
        essais++;
        return essais < 4 ? { sort: "reseau" } : { sort: "ok" };
      },
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "trait" });
    await souffler();
    const delais: number[] = [];
    for (let i = 0; i < 3; i++) {
      delais.push(temps.dernierDelai ?? -1);
      await temps.declencher();
      await souffler();
    }
    assert.equal(essais, 4, "quatre tentatives, la dernière réussit");
    assert.deepEqual(delais, [attenteApres(1), attenteApres(2), attenteApres(3)]);
    assert.equal(sauvegarde.diagnostic().etat, "repos");
  });

  it("n'efface pas un brouillon que l'on vient de réécrire", async () => {
    /*
     * Le cas qui fait perdre du travail sans rien signaler : l'aller-retour
     * dure une demi-seconde, la main n'attend pas, et deux mots de plus sont
     * posés entre l'envoi et sa confirmation. Effacer sur confirmation jetterait
     * ces deux mots — le serveur ne les a jamais vus.
     */
    const { journal, contenu } = journalDEssai();
    const temps = minuteurDEssai();
    let debloquer: (v: Verdict) => void = () => {};
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      envoyer: () => new Promise<Verdict>((resolve) => (debloquer = resolve)),
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "premier jet" });
    await souffler();
    // La main continue d'écrire pendant que le premier envoi est en vol.
    await sauvegarde.enregistrer({ ...BLOC, content: "premier jet + deux mots" });
    debloquer({ sort: "ok" });
    await souffler();

    assert.equal(
      contenu.get("b1")?.content,
      "premier jet + deux mots",
      "le travail écrit pendant l'envoi reste au journal",
    );
    assert.equal(sauvegarde.diagnostic().enAttente, 1, "et reste à envoyer");
  });

  it("ne s'acharne pas sur un refus définitif, mais garde le contenu", async () => {
    const { journal, contenu } = journalDEssai();
    const temps = minuteurDEssai();
    let essais = 0;
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      envoyer: async () => {
        essais++;
        return { sort: "refus", message: "Ce bloc est trop volumineux pour être enregistré." };
      },
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "x".repeat(50) });
    await souffler();
    assert.equal(essais, 1, "un seul essai");
    assert.equal(temps.enAttente, 0, "aucune reprise programmée");
    assert.equal(sauvegarde.diagnostic().etat, "refus");
    assert.match(sauvegarde.diagnostic().erreur ?? "", /trop volumineux/);
    assert.equal(contenu.has("b1"), true, "le contenu reste sur l'appareil");
    assert.equal(sauvegarde.enSouffrance().length, 1, "et reste téléchargeable");
  });

  it("ne tente rien hors ligne, et repart au retour du réseau", async () => {
    const { journal } = journalDEssai();
    const temps = minuteurDEssai();
    let enLigne = false;
    let essais = 0;
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      enLigne: () => enLigne,
      envoyer: async () => {
        essais++;
        return { sort: "ok" };
      },
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "trait" });
    await souffler();
    assert.equal(essais, 0, "rien n'est tenté sans réseau");
    assert.equal(sauvegarde.diagnostic().etat, "hors-ligne");

    enLigne = true;
    sauvegarde.reprendre();
    await souffler();
    assert.equal(essais, 1, "le retour du réseau relance tout de suite");
    assert.equal(sauvegarde.diagnostic().etat, "repos");
  });

  it("ne confond pas une session expirée avec une coupure", async () => {
    const { journal } = journalDEssai();
    const temps = minuteurDEssai();
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      envoyer: async () => ({ sort: "session" }),
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "trait" });
    await souffler();
    assert.equal(sauvegarde.diagnostic().etat, "session");
    assert.match(sauvegarde.diagnostic().erreur ?? "", /reconnecte/i);
    assert.equal(temps.enAttente, 1, "on réessaie quand même : un autre onglet peut régler ça");
  });

  it("ne mélange pas les blocs, et n'envoie que le dernier état de chacun", async () => {
    const { journal } = journalDEssai();
    const temps = minuteurDEssai();
    const envoyes: string[] = [];
    let bloquer = true;
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      enLigne: () => !bloquer,
      envoyer: async (brouillon) => {
        envoyes.push(`${brouillon.blockId}:${brouillon.content}`);
        return { sort: "ok" };
      },
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "a1" });
    await sauvegarde.enregistrer({ ...BLOC, content: "a2" });
    await sauvegarde.enregistrer({ ...BLOC, blockId: "b2", content: "b1" });
    await souffler();
    assert.equal(envoyes.length, 0);
    assert.equal(sauvegarde.diagnostic().enAttente, 2, "deux blocs, pas trois écritures");

    bloquer = false;
    sauvegarde.reprendre();
    await souffler();
    assert.deepEqual(envoyes, ["b1:a2", "b2:b1"], "seul le dernier état de b1 part");
  });

  it("le bouton « Réessayer » redonne sa chance à un refus", async () => {
    const { journal } = journalDEssai();
    const temps = minuteurDEssai();
    let refuser = true;
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      envoyer: async () => (refuser ? { sort: "refus", message: "non" } : { sort: "ok" }),
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "trait" });
    await souffler();
    assert.equal(sauvegarde.diagnostic().etat, "refus");

    refuser = false;
    sauvegarde.reessayer();
    await souffler();
    assert.equal(sauvegarde.diagnostic().etat, "repos");
    assert.equal(sauvegarde.diagnostic().enAttente, 0);
  });

  it("un transport qui lève ne perd pas le brouillon", async () => {
    const { journal, contenu } = journalDEssai();
    const temps = minuteurDEssai();
    const sauvegarde = creerSauvegarde({
      journal,
      minuteur: temps.minuteur,
      gigue: () => 1,
      envoyer: async () => {
        throw new Error("boum");
      },
    });

    await sauvegarde.enregistrer({ ...BLOC, content: "trait" });
    await souffler();
    assert.equal(contenu.has("b1"), true);
    assert.equal(temps.enAttente, 1, "et une reprise est programmée");
  });
});
