import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { nextDueAt } from "@/lib/scheduling";
import { viderEnvois, type Lot, type VerdictLot } from "@/lib/hors-ligne/file";
import { lienADetourner, lireDestination } from "@/lib/hors-ligne/destination";
import {
  ADRESSE_COQUILLE,
  CACHE_COQUILLE,
  CACHE_FICHIERS,
  TAILLE_LOT,
  appliquerLocalement,
  cleEpingle,
  disponibilite,
  fichiersNecessaires,
  nouvelIdentifiant,
  orphelins,
  rebaser,
  type CarteHorsLigne,
  type DossierHorsLigne,
  type Envoi,
  type EnvoiReponse,
  type PaquetHorsLigne,
} from "@/lib/hors-ligne/modele";

const carte = (id: string, extra: Partial<CarteHorsLigne> = {}): CarteHorsLigne => ({
  id,
  term: id,
  definition: "",
  imagePath: null,
  status: "new",
  streak: 0,
  dueAt: null,
  lastSeenAt: null,
  ...extra,
});

const reponse = (cardId: string, knew: boolean, answeredAt: number, userId = "u1"): EnvoiReponse => ({
  genre: "reponse",
  id: `${cardId}-${answeredAt}`,
  userId,
  cardId,
  knew,
  answeredAt,
});

const MARDI = new Date(2026, 8, 15, 18, 4).getTime();

describe("appliquerLocalement — même calcul que le serveur", () => {
  it("une bonne réponse allonge la série et planifie comme nextDueAt", () => {
    const apres = appliquerLocalement(carte("a", { streak: 1 }), reponse("a", true, MARDI));
    assert.equal(apres.streak, 2);
    assert.equal(apres.status, "known");
    assert.equal(apres.dueAt, nextDueAt(2, new Date(MARDI)).getTime());
    assert.equal(apres.lastSeenAt, MARDI);
  });

  it("une mauvaise réponse remet la série à zéro et rend la carte due tout de suite", () => {
    const apres = appliquerLocalement(carte("a", { streak: 4 }), reponse("a", false, MARDI));
    assert.equal(apres.streak, 0);
    assert.equal(apres.status, "learning");
    assert.equal(apres.dueAt, MARDI);
  });

  it("une réponse plus ancienne que la dernière connue ne replanifie rien", () => {
    const vue = carte("a", { streak: 3, lastSeenAt: MARDI + 1000, dueAt: 42 });
    assert.equal(appliquerLocalement(vue, reponse("a", false, MARDI)), vue);
  });
});

describe("rebaser — les réponses en attente survivent à une synchronisation", () => {
  const paquet: PaquetHorsLigne = {
    id: "p",
    folderId: null,
    title: "P",
    description: "",
    color: "violet",
    version: "v",
    cartes: [carte("a"), carte("b")],
  };

  it("rejoue dans l'ordre chronologique, même reçues dans le désordre", () => {
    const envois = [reponse("a", true, MARDI + 2000), reponse("a", false, MARDI)];
    const a = rebaser(paquet, envois).cartes[0];
    // Ratée puis sue : série de 1. Dans l'ordre reçu, on aurait fini à 0.
    assert.equal(a.streak, 1);
    assert.equal(a.status, "known");
  });

  it("rend le même objet quand rien ne le concerne", () => {
    assert.equal(rebaser(paquet, [reponse("z", true, MARDI)]), paquet);
    assert.equal(rebaser(paquet, []), paquet);
  });
});

describe("disponibilite — épinglé, hérité, absent", () => {
  const dossiers: DossierHorsLigne[] = [
    { id: "bio", name: "Biologie", color: "emerald", parentId: null, kind: "deck" },
    { id: "cell", name: "Cellule", color: "blue", parentId: "bio", kind: "deck" },
    { id: "geo", name: "Géo", color: "amber", parentId: null, kind: "deck" },
    { id: "cours", name: "Cours", color: "slate", parentId: null, kind: "note" },
  ];

  it("un paquet dans un sous-dossier hérite du dossier épinglé le plus proche", () => {
    const epingles = new Set([cleEpingle("dossier", "bio")]);
    const d = disponibilite("paquet", "p1", { epingles, dossiers, folderId: "cell" });
    assert.equal(d.etat, "herite");
    assert.equal(d.etat === "herite" && d.via.id, "bio");
  });

  it("l'épingle directe l'emporte sur l'héritage : c'est elle qu'on retire", () => {
    const epingles = new Set([cleEpingle("dossier", "bio"), cleEpingle("paquet", "p1")]);
    assert.equal(disponibilite("paquet", "p1", { epingles, dossiers, folderId: "cell" }).etat, "epingle");
  });

  it("un dossier n'hérite pas de lui-même, seulement de ses parents", () => {
    const epingles = new Set([cleEpingle("dossier", "cell")]);
    assert.equal(disponibilite("dossier", "bio", { epingles, dossiers }).etat, "absent");
    assert.equal(disponibilite("dossier", "cell", { epingles, dossiers }).etat, "epingle");
  });

  it("un cycle écrit en base ne bloque pas le calcul", () => {
    const boucle: DossierHorsLigne[] = [
      { id: "x", name: "X", color: "slate", parentId: "y", kind: "deck" },
      { id: "y", name: "Y", color: "slate", parentId: "x", kind: "deck" },
    ];
    assert.equal(disponibilite("paquet", "p", { epingles: new Set(), dossiers: boucle, folderId: "x" }).etat, "absent");
  });

  it("retirer l'épingle d'un dossier libère ses paquets, pas ceux épinglés à part", () => {
    const paquets = [
      { id: "p1", folderId: "cell" },
      { id: "p2", folderId: "cell" },
      { id: "p3", folderId: "geo" },
    ];
    const epingles = new Set([cleEpingle("paquet", "p2"), cleEpingle("dossier", "geo")]);
    assert.deepEqual(orphelins("paquet", paquets, epingles, dossiers), ["p1"]);
  });

  it("une note suit les mêmes règles, dans son propre classement", () => {
    const epingles = new Set([cleEpingle("dossier", "cours"), cleEpingle("note", "n3")]);
    const notes = [
      { id: "n1", folderId: "cours" },
      { id: "n2", folderId: null },
      { id: "n3", folderId: null },
    ];
    assert.equal(disponibilite("note", "n1", { epingles, dossiers, folderId: "cours" }).etat, "herite");
    assert.deepEqual(orphelins("note", notes, epingles, dossiers), ["n2"]);
  });
});

describe("fichiersNecessaires", () => {
  it("une image partagée par deux copies de carte ne descend qu'une fois", () => {
    const p = (cartes: CarteHorsLigne[]): PaquetHorsLigne => ({
      id: "p",
      folderId: null,
      title: "",
      description: "",
      color: "",
      version: "",
      cartes,
    });
    const noms = fichiersNecessaires([
      p([carte("a", { imagePath: "x.webp" }), carte("b")]),
      p([carte("c", { imagePath: "x.webp" }), carte("d", { imagePath: "y.webp" })]),
    ]);
    assert.deepEqual(noms.sort(), ["x.webp", "y.webp"]);
  });

  it("compte aussi les documents et photos des notes", () => {
    const noms = fichiersNecessaires([], [{ fichiers: ["poly.pdf", "x.webp"] }, { fichiers: ["poly.pdf"] }]);
    assert.deepEqual(noms.sort(), ["poly.pdf", "x.webp"]);
  });
});

describe("nouvelIdentifiant", () => {
  it("rend un UUID v4 même sans crypto.randomUUID (http:// sur le réseau local)", () => {
    const original = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
      const id = nouvelIdentifiant();
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.notEqual(id, nouvelIdentifiant());
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("viderEnvois — la file des réponses", () => {
  function file(envois: Envoi[]) {
    const contenu = new Map(envois.map((e) => [e.id, e]));
    const lots: Lot[] = [];
    return {
      contenu,
      lots,
      lire: async () => [...contenu.values()],
      oublier: async (ids: string[]) => {
        for (const id of ids) contenu.delete(id);
      },
      envoyeur: (verdict: (lot: Lot) => VerdictLot) => async (lot: Lot) => {
        lots.push(lot);
        return verdict(lot);
      },
    };
  }

  it("n'efface que ce que le serveur déclare réglé", async () => {
    const f = file([reponse("a", true, 1), reponse("b", true, 2)]);
    const issue = await viderEnvois({
      lire: f.lire,
      oublier: f.oublier,
      userId: "u1",
      envoyer: f.envoyeur(() => ({ sort: "ok", regles: ["a-1"] })),
    });
    assert.deepEqual([...f.contenu.keys()], ["b-2"]);
    assert.equal(issue.etat, "repos");
    assert.equal(issue.restants, 1);
  });

  it("sans réseau, garde tout et s'arrête au premier lot", async () => {
    const envois = Array.from({ length: TAILLE_LOT + 5 }, (_, i) => reponse(`c${i}`, true, i + 1));
    const f = file(envois);
    const issue = await viderEnvois({
      lire: f.lire,
      oublier: f.oublier,
      userId: "u1",
      envoyer: f.envoyeur(() => ({ sort: "reseau" })),
    });
    assert.equal(issue.etat, "hors-ligne");
    assert.equal(f.lots.length, 1);
    assert.equal(f.contenu.size, TAILLE_LOT + 5);
  });

  it("découpe en lots, dans l'ordre où les réponses ont été données", async () => {
    const envois = Array.from({ length: TAILLE_LOT + 5 }, (_, i) => reponse(`c${i}`, true, 1000 - i));
    const f = file(envois);
    await viderEnvois({
      lire: f.lire,
      oublier: f.oublier,
      userId: "u1",
      envoyer: f.envoyeur((lot) => ({ sort: "ok", regles: lot.reponses.map((r) => r.id) })),
    });
    assert.equal(f.lots.length, 2);
    assert.equal(f.lots[0].reponses.length, TAILLE_LOT);
    const instants = f.lots.flatMap((l) => l.reponses.map((r) => r.answeredAt));
    assert.deepEqual(instants, [...instants].sort((a, b) => a - b));
    assert.equal(f.contenu.size, 0);
  });

  it("un lot refusé est jeté, pour ne pas bloquer la file pour toujours", async () => {
    const f = file([reponse("a", true, 1)]);
    const issue = await viderEnvois({
      lire: f.lire,
      oublier: f.oublier,
      userId: "u1",
      envoyer: f.envoyeur(() => ({ sort: "refus", message: "HTTP 400" })),
    });
    assert.equal(f.contenu.size, 0);
    assert.equal(issue.etat, "repos");
  });

  it("une session expirée garde tout, sans rien jeter", async () => {
    const f = file([reponse("a", true, 1)]);
    const issue = await viderEnvois({
      lire: f.lire,
      oublier: f.oublier,
      userId: "u1",
      envoyer: f.envoyeur(() => ({ sort: "session" })),
    });
    assert.equal(issue.etat, "session");
    assert.equal(f.contenu.size, 1);
  });

  it("les réponses d'un autre compte ne partent pas sous le nom de celui-ci", async () => {
    const f = file([reponse("a", true, 1, "u1"), reponse("b", true, 2, "u2"), reponse("c", true, 3, "")]);
    await viderEnvois({
      lire: f.lire,
      oublier: f.oublier,
      userId: "u2",
      envoyer: f.envoyeur((lot) => ({ sort: "ok", regles: lot.reponses.map((r) => r.id) })),
    });
    assert.deepEqual(
      f.lots[0].reponses.map((r) => r.cardId),
      ["b", "c"],
    );
    assert.deepEqual([...f.contenu.keys()], ["a-1"]);
  });
});

describe("lireDestination — la page hors ligne retrouve l'intention", () => {
  it("reconnaît les pages servies hors ligne", () => {
    assert.deepEqual(lireDestination("/decks/abc/study?all=1&mode=write"), {
      vue: "revision",
      portee: { genre: "paquet", id: "abc" },
      tout: true,
      ecrire: true,
    });
    assert.deepEqual(lireDestination("/folders/f1/study"), {
      vue: "revision",
      portee: { genre: "dossier", id: "f1" },
      tout: false,
      ecrire: false,
    });
    assert.equal(lireDestination("/study").vue, "revision");
    assert.deepEqual(lireDestination("/decks/abc"), { vue: "paquet", id: "abc" });
    assert.deepEqual(lireDestination("/folders/f1/"), { vue: "dossier", id: "f1" });
    assert.deepEqual(lireDestination("/"), { vue: "accueil", indisponible: null });
  });

  it("dit ce qui a besoin du serveur, et ne suit aucune adresse externe", () => {
    assert.deepEqual(lireDestination("/admin"), { vue: "accueil", indisponible: "/admin" });
    assert.deepEqual(lireDestination("/notes/n1"), { vue: "note", id: "n1" });
    assert.deepEqual(lireDestination("/notes?folder=f2&vue=list"), { vue: "notes", dossier: "f2" });
    assert.deepEqual(lireDestination("/notes"), { vue: "notes", dossier: null });
    assert.deepEqual(lireDestination("//evil.example/decks/x"), { vue: "accueil", indisponible: null });
    assert.deepEqual(lireDestination("https://evil.example/"), { vue: "accueil", indisponible: null });
    assert.deepEqual(lireDestination(null), { vue: "accueil", indisponible: null });
  });
});

describe("lienADetourner", () => {
  const clic = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  const lien = (href: string, extra: { target?: string; download?: boolean } = {}) => ({
    href,
    target: extra.target ?? "",
    hasAttribute: (nom: string) => nom === "download" && !!extra.download,
  });
  const ORIGINE = "https://fiches.example";

  it("détourne un clic simple sur un lien interne", () => {
    assert.equal(lienADetourner(clic, lien(`${ORIGINE}/decks/a?all=1`), ORIGINE), "/decks/a?all=1");
  });

  it("laisse passer les clics avec modificateur, les autres onglets, les téléchargements et l'externe", () => {
    assert.equal(lienADetourner({ ...clic, metaKey: true }, lien(`${ORIGINE}/`), ORIGINE), null);
    assert.equal(lienADetourner({ ...clic, button: 1 }, lien(`${ORIGINE}/`), ORIGINE), null);
    assert.equal(lienADetourner(clic, lien(`${ORIGINE}/`, { target: "_blank" }), ORIGINE), null);
    assert.equal(lienADetourner(clic, lien(`${ORIGINE}/api/export`, { download: true }), ORIGINE), null);
    assert.equal(lienADetourner(clic, lien("https://ailleurs.example/"), ORIGINE), null);
    assert.equal(lienADetourner({ ...clic, defaultPrevented: true }, lien(`${ORIGINE}/`), ORIGINE), null);
  });
});

describe("service worker", () => {
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

  it("déclare les mêmes caches et la même adresse de coquille que l'app", () => {
    assert.match(source, new RegExp(`CACHE_COQUILLE = "${CACHE_COQUILLE}"`));
    assert.match(source, new RegExp(`CACHE_FICHIERS = "${CACHE_FICHIERS}"`));
    assert.match(source, new RegExp(`ADRESSE_COQUILLE = "${ADRESSE_COQUILLE}"`));
  });

  /** Exécute le worker dans un faux environnement et rend ses écouteurs. */
  function charger(cles: string[]) {
    const ecouteurs: Record<string, (e: unknown) => void> = {};
    const effaces: string[] = [];
    const self = {
      addEventListener: (type: string, f: (e: unknown) => void) => (ecouteurs[type] = f),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
      location: { origin: "https://fiches.example" },
      navigator: { onLine: true },
    };
    const caches = {
      keys: async () => cles,
      delete: async (cle: string) => {
        effaces.push(cle);
        return true;
      },
    };
    const contexte = { self, caches, setTimeout, clearTimeout, URL, Response, fetch };
    vm.runInNewContext(source, contexte);
    return { ecouteurs, effaces, contexte: contexte as typeof contexte & Record<string, unknown> };
  }

  it("une mise à jour du worker n'efface ni les images gardées ni la coquille", async () => {
    const { ecouteurs, effaces } = charger(["fiches-v0", "fiches-v1", CACHE_COQUILLE, CACHE_FICHIERS, "autre"]);
    let attente: Promise<unknown> = Promise.resolve();
    ecouteurs.activate({ waitUntil: (p: Promise<unknown>) => (attente = p) });
    await attente;
    assert.deepEqual(effaces, ["fiches-v0"]);
  });

  it("répond à une requête par plage depuis un fichier en cache, comme le serveur", async () => {
    const { contexte } = charger([]);
    const servirPlage = contexte.servirPlage as (req: Request, cached: Response) => Promise<Response>;
    const fichier = () =>
      new Response(new TextEncoder().encode("0123456789"), { headers: { "Content-Type": "application/pdf" } });
    const demande = (plage?: string) =>
      new Request("https://fiches.example/api/uploads/x.pdf", plage ? { headers: { range: plage } } : {});

    const milieu = await servirPlage(demande("bytes=2-5"), fichier());
    assert.equal(milieu.status, 206);
    assert.equal(await milieu.text(), "2345");
    assert.equal(milieu.headers.get("Content-Range"), "bytes 2-5/10");
    assert.equal(milieu.headers.get("Content-Type"), "application/pdf");

    const ouverte = await servirPlage(demande("bytes=7-"), fichier());
    assert.equal(await ouverte.text(), "789");
    const suffixe = await servirPlage(demande("bytes=-3"), fichier());
    assert.equal(await suffixe.text(), "789");
    const deborde = await servirPlage(demande("bytes=8-99"), fichier());
    assert.equal(deborde.headers.get("Content-Range"), "bytes 8-9/10");

    assert.equal((await servirPlage(demande("bytes=20-"), fichier())).status, 416);
    const entier = await servirPlage(demande(), fichier());
    assert.equal(entier.status, 200);
    assert.equal(await entier.text(), "0123456789");
  });
});
