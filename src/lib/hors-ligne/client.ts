import { attenteApres } from "@/lib/sauvegarde";
import { viderEnvois, type IssueVidage, type Lot, type VerdictLot } from "@/lib/hors-ligne/file";
import {
  ADRESSE_COQUILLE,
  CACHE_COQUILLE,
  CACHE_FICHIERS,
  cleEpingle,
  estDue,
  fichiersNecessaires,
  nouvelIdentifiant,
  orphelins,
  rebaser,
  type DossierHorsLigne,
  type Envoi,
  type Epingle,
  type GenreEpingle,
  type NoteHorsLigne,
  type PaquetHorsLigne,
} from "@/lib/hors-ligne/modele";
import * as stockage from "@/lib/hors-ligne/stockage";
import type { ReponseSynchro } from "@/lib/hors-ligne/serveur";

/**
 * Le moteur hors ligne, côté appareil.
 *
 * Un seul état, partagé par tous les composants qui l'observent (et par les
 * autres onglets, via `BroadcastChannel`) : ce qui est épinglé, ce qui est
 * descendu, ce qui attend d'être envoyé, et où en est la synchronisation.
 *
 * Aucune synchronisation en arrière-plan : ni Background Sync ni Periodic
 * Background Sync n'existent sur Safari. Tout se passe donc quand l'app est
 * ouverte — au chargement, au retour du réseau, au retour au premier plan.
 */

export type EtatSynchro =
  | "repos"
  | "encours"
  /** Le serveur ne répond pas : pas de réseau, ou le NAS est hors d'atteinte. */
  | "hors-ligne"
  /** Le serveur ne nous reconnaît plus : il faut se reconnecter. */
  | "session"
  | "erreur";

export type ResumePaquet = Omit<PaquetHorsLigne, "cartes" | "version"> & {
  nbCartes: number;
  dues: number;
  sues: number;
};

export type ResumeNote = Omit<NoteHorsLigne, "blocs" | "fichiers" | "version"> & {
  /** Genres de ses blocs, pour montrer ce qu'elle contient. */
  kinds: string[];
};

export type EtatHorsLigne = {
  /** Faux tant que l'appareil n'a pas été lu : ne rien affirmer avant. */
  charge: boolean;
  userId: string | null;
  epingles: ReadonlyMap<string, Epingle>;
  dossiers: readonly DossierHorsLigne[];
  paquets: ReadonlyMap<string, ResumePaquet>;
  notes: ReadonlyMap<string, ResumeNote>;
  enAttente: number;
  synchro: EtatSynchro;
  derniereSynchro: number | null;
  /** Images en cours de téléchargement. */
  fichiers: { faits: number; total: number } | null;
};

const INITIAL: EtatHorsLigne = {
  charge: false,
  userId: null,
  epingles: new Map(),
  dossiers: [],
  paquets: new Map(),
  notes: new Map(),
  enAttente: 0,
  synchro: "repos",
  derniereSynchro: null,
  fichiers: null,
};

let etat = INITIAL;
const auditeurs = new Set<() => void>();
/** Pour retrouver en un coup le paquet d'une carte à laquelle on répond. */
let carteVersPaquet = new Map<string, string>();

function publier(partiel: Partial<EtatHorsLigne>) {
  etat = { ...etat, ...partiel };
  for (const f of auditeurs) f();
}

export const instantane = () => etat;
export const instantaneServeur = () => INITIAL;

export function sAbonner(auditeur: () => void) {
  auditeurs.add(auditeur);
  ecouterLesAutresOnglets();
  if (!etat.charge && !lecture) void recharger();
  return () => {
    auditeurs.delete(auditeur);
  };
}

let lecture: Promise<void> | null = null;

/** Relit l'appareil et republie l'état. */
export function recharger(): Promise<void> {
  lecture = (async () => {
    const [epingles, paquets, notes, envois, meta] = await Promise.all([
      stockage.lireEpingles(),
      stockage.lirePaquets(),
      stockage.lireNotes(),
      stockage.lireEnvois(),
      stockage.lireMeta(),
    ]);
    const maintenant = Date.now();
    carteVersPaquet = new Map(paquets.flatMap((p) => p.cartes.map((c) => [c.id, p.id] as const)));
    publier({
      charge: true,
      userId: meta.userId,
      epingles: new Map(epingles.map((e) => [cleEpingle(e.genre, e.id), e])),
      dossiers: meta.dossiers,
      derniereSynchro: meta.derniereSynchro,
      enAttente: envois.length,
      paquets: new Map(
        paquets.map((p) => [
          p.id,
          {
            id: p.id,
            folderId: p.folderId,
            title: p.title,
            description: p.description,
            color: p.color,
            nbCartes: p.cartes.length,
            dues: p.cartes.filter((c) => estDue(c, maintenant)).length,
            sues: p.cartes.filter((c) => c.status === "known").length,
          },
        ]),
      ),
      notes: new Map(
        notes.map((n) => [
          n.id,
          {
            id: n.id,
            folderId: n.folderId,
            title: n.title,
            mastered: n.mastered,
            preview: n.preview,
            updatedAt: n.updatedAt,
            kinds: n.blocs.map((b) => b.kind),
          },
        ]),
      ),
    });
  })().finally(() => {
    lecture = null;
  });
  return lecture;
}

let canal: BroadcastChannel | null = null;

function ecouterLesAutresOnglets() {
  if (canal || typeof BroadcastChannel === "undefined") return;
  canal = new BroadcastChannel("fiches-hors-ligne");
  canal.onmessage = () => void recharger();
}

async function changer() {
  await recharger();
  canal?.postMessage("change");
}

/**
 * Les écritures locales passent l'une après l'autre : deux réponses données
 * coup sur coup liraient sinon le même paquet, et la seconde écraserait
 * l'effet de la première.
 */
let chaine: Promise<unknown> = Promise.resolve();
function enchainer<T>(travail: () => Promise<T>): Promise<T> {
  const suite = chaine.then(travail, travail);
  chaine = suite.catch(() => undefined);
  return suite;
}

// --- Réponses de révision ------------------------------------------------------

/**
 * Enregistre une réponse : d'abord sur l'appareil, avec son effet sur la carte
 * si le paquet est gardé, puis vers le serveur dès que possible.
 *
 * Ne rejette jamais : l'animation de la carte n'a pas à attendre le disque, et
 * encore moins le réseau.
 */
export function repondre(cardId: string, knew: boolean): Promise<void> {
  return enchainer(async () => {
    const envoi: Envoi = {
      genre: "reponse",
      id: nouvelIdentifiant(),
      userId: etat.userId ?? "",
      cardId,
      knew,
      answeredAt: Date.now(),
    };
    const paquetId = carteVersPaquet.get(cardId);
    const paquet = paquetId ? await stockage.lirePaquet(paquetId) : undefined;
    await stockage.noterEnvoi(envoi, paquet ? rebaser(paquet, [envoi]) : undefined);
    await changer();
    programmerVidage();
  }).catch(() => undefined);
}

export function terminerSession(deckId: string, correctCount: number, missCount: number): Promise<void> {
  return enchainer(async () => {
    await stockage.noterEnvoi({
      genre: "session",
      id: nouvelIdentifiant(),
      userId: etat.userId ?? "",
      deckId,
      correctCount,
      missCount,
      finishedAt: Date.now(),
    });
    await changer();
    programmerVidage();
  }).catch(() => undefined);
}

async function envoyerLot(lot: Lot): Promise<VerdictLot> {
  let reponse: Response;
  try {
    reponse = await fetch("/api/revision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lot),
      cache: "no-store",
      // Une redirection vers /login n'est pas un enregistrement : suivie, elle
      // rendrait un 200. Cf. `envoyerBrouillon`.
      redirect: "manual",
    });
  } catch {
    return { sort: "reseau" };
  }
  if (reponse.type === "opaqueredirect" || reponse.status === 0 || reponse.redirected) return { sort: "session" };
  if (reponse.status === 401 || reponse.status === 403) return { sort: "session" };
  if (reponse.status === 400 || reponse.status === 413) return { sort: "refus", message: `HTTP ${reponse.status}` };
  if (!reponse.ok) return { sort: "serveur", message: `HTTP ${reponse.status}` };
  try {
    const { regles } = (await reponse.json()) as { regles: string[] };
    return { sort: "ok", regles };
  } catch {
    return { sort: "serveur", message: "Réponse illisible" };
  }
}

let vidageEnVol: Promise<IssueVidage> | null = null;
let minuteurVidage: ReturnType<typeof setTimeout> | null = null;
let essaisVidage = 0;

/** Laisse passer une rafale de réponses avant d'envoyer, pour faire un lot. */
function programmerVidage(delai = 400) {
  if (minuteurVidage) clearTimeout(minuteurVidage);
  minuteurVidage = setTimeout(() => {
    minuteurVidage = null;
    void vider();
  }, delai);
}

export function vider(): Promise<IssueVidage> {
  if (vidageEnVol) return vidageEnVol;
  vidageEnVol = viderEnvois({
    lire: stockage.lireEnvois,
    oublier: stockage.oublierEnvois,
    envoyer: envoyerLot,
    userId: etat.userId,
  })
    .then(async (issue) => {
      await changer();
      if (issue.etat === "repos") {
        essaisVidage = 0;
      } else if (issue.restants > 0 && issue.etat !== "session" && navigator.onLine) {
        // `navigator.onLine` vrai et serveur injoignable : le NAS est hors
        // d'atteinte, pas l'appareil. Rien ne préviendra de son retour, il
        // faut donc réessayer de soi-même. Hors ligne franc, c'est l'événement
        // `online` qui réveillera la file.
        programmerVidage(attenteApres(essaisVidage++));
      }
      return issue;
    })
    .finally(() => {
      vidageEnVol = null;
    });
  return vidageEnVol;
}

// --- Épingles ------------------------------------------------------------------

export async function epingler(genre: GenreEpingle, id: string) {
  await stockage.poserEpingle({ genre, id, depuis: Date.now(), resolueLe: null });
  stockage.ancrerLeStockage();
  await changer();
  void synchroniser();
}

export async function retirer(genre: GenreEpingle, id: string) {
  await stockage.retirerEpingles([cleEpingle(genre, id)]);
  const [epingles, paquets, notes, meta] = await Promise.all([
    stockage.lireEpingles(),
    stockage.lirePaquets(),
    stockage.lireNotes(),
    stockage.lireMeta(),
  ]);
  const cles = new Set(epingles.map((e) => cleEpingle(e.genre, e.id)));
  await stockage.ecrirePaquets([], orphelins("paquet", paquets, cles, meta.dossiers));
  await stockage.ecrireNotes([], orphelins("note", notes, cles, meta.dossiers));
  await changer();
  await rangerFichiers(false);
  void synchroniser();
}

/** À la déconnexion : le contenu part, les réponses non envoyées restent. */
export async function oublierLeContenu() {
  await stockage.oublierContenu();
  try {
    await caches.delete(CACHE_FICHIERS);
  } catch {
    // Pas de Cache Storage (http://) : il n'y avait rien à effacer.
  }
  await changer();
}

// --- Synchronisation -----------------------------------------------------------

let synchroEnVol: Promise<void> | null = null;
let aRefaire = false;
/** Une passe incomplète : on retente plus tard, pas en boucle serrée. */
let aRefaireApres = false;
let essaisSynchro = 0;

/**
 * Une passe complète. Appelée pendant qu'une autre tourne, elle en demande
 * une de plus à la fin : une épingle posée en plein aller-retour ne doit pas
 * attendre la prochaine ouverture de l'app.
 */
export function synchroniser(): Promise<void> {
  if (synchroEnVol) {
    aRefaire = true;
    return synchroEnVol;
  }
  synchroEnVol = (async () => {
    do {
      aRefaire = false;
      await unePasse().catch((erreur) => {
        console.warn("Synchronisation hors ligne interrompue :", erreur);
        publier({ synchro: "erreur" });
      });
    } while (aRefaire);
  })().finally(() => {
    synchroEnVol = null;
    if (aRefaireApres) {
      aRefaireApres = false;
      if (navigator.onLine) setTimeout(() => void synchroniser(), attenteApres(essaisSynchro++));
    } else {
      essaisSynchro = 0;
    }
  });
  return synchroEnVol;
}

/** Au plus une passe par minute sans raison particulière. */
export function synchroniserSiUtile() {
  const recente = etat.derniereSynchro !== null && Date.now() - etat.derniereSynchro < 60_000;
  if (recente && etat.enAttente === 0 && etat.synchro === "repos") return;
  void synchroniser();
}

async function unePasse() {
  publier({ synchro: "encours" });

  const vidage = await vider();
  if (vidage.etat === "hors-ligne" || vidage.etat === "session") {
    publier({ synchro: vidage.etat });
    return;
  }

  const [epingles, locaux, notesLocales, meta] = await Promise.all([
    stockage.lireEpingles(),
    stockage.lirePaquets(),
    stockage.lireNotes(),
    stockage.lireMeta(),
  ]);

  if (epingles.length === 0) {
    if (locaux.length > 0) await stockage.ecrirePaquets([], locaux.map((p) => p.id));
    if (notesLocales.length > 0) await stockage.ecrireNotes([], notesLocales.map((n) => n.id));
    await rangerFichiers(false);
    await changer();
    publier({ synchro: "repos" });
    return;
  }

  let reponse: Response;
  try {
    reponse = await fetch("/api/hors-ligne", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      redirect: "manual",
      body: JSON.stringify({
        paquets: epingles.filter((e) => e.genre === "paquet").map((e) => e.id),
        dossiers: epingles.filter((e) => e.genre === "dossier").map((e) => e.id),
        notes: epingles.filter((e) => e.genre === "note").map((e) => e.id),
        versions: Object.fromEntries(locaux.map((p) => [p.id, p.version])),
      }),
    });
  } catch {
    publier({ synchro: "hors-ligne" });
    return;
  }
  if (reponse.type === "opaqueredirect" || reponse.status === 0 || reponse.status === 401) {
    publier({ synchro: "session" });
    return;
  }
  if (!reponse.ok) {
    publier({ synchro: "erreur" });
    return;
  }
  const donnees = (await reponse.json()) as ReponseSynchro;

  // Un autre compte s'est connecté sur cet appareil : ce qui y était gardé
  // n'est pas à lui.
  if (meta.userId && meta.userId !== donnees.userId) {
    await oublierLeContenu();
    await stockage.ecrireMeta({ userId: donnees.userId });
    await changer();
    publier({ synchro: "repos" });
    return;
  }

  const envois = await stockage.lireEnvois();
  const parId = new Map(locaux.map((p) => [p.id, p]));
  const aEcrire: PaquetHorsLigne[] = [];
  for (const p of donnees.paquets) {
    if (p.cartes) aEcrire.push(rebaser({ ...p, cartes: p.cartes }, envois));
    else if (!parId.has(p.id)) aRefaire = true; // Version annoncée mais absente : on redemandera.
  }
  const gardes = new Set(donnees.paquets.map((p) => p.id));
  await stockage.ecrirePaquets(
    aEcrire,
    locaux.filter((p) => !gardes.has(p.id)).map((p) => p.id),
  );

  // Les notes, une à une et seulement celles qui ont changé : cf. la route
  // `/api/hors-ligne/notes/<id>`. Une note qui ne descend pas (réseau coupé en
  // route) garde sa version précédente, et la passe suivante la reprendra.
  const notesParId = new Map(notesLocales.map((n) => [n.id, n]));
  const aTelecharger = donnees.notes.filter((n) => notesParId.get(n.id)?.version !== n.version);
  const gardees = new Set(donnees.notes.map((n) => n.id));
  await stockage.ecrireNotes(
    [],
    notesLocales.filter((n) => !gardees.has(n.id)).map((n) => n.id),
  );
  const notesRecues = new Set<string>();
  await parLots(aTelecharger, 2, async ({ id }) => {
    try {
      const r = await fetch(`/api/hors-ligne/notes/${encodeURIComponent(id)}`, { cache: "no-store", redirect: "manual" });
      if (r.status === 200) {
        await stockage.ecrireNotes([(await r.json()) as NoteHorsLigne]);
        notesRecues.add(id);
      }
    } catch {
      // Coupé en route : la prochaine passe reprendra celle-ci.
    }
  });

  const disparus = [
    ...donnees.disparus.paquets.map((id) => cleEpingle("paquet", id)),
    ...donnees.disparus.dossiers.map((id) => cleEpingle("dossier", id)),
    ...donnees.disparus.notes.map((id) => cleEpingle("note", id)),
  ];
  await stockage.retirerEpingles(disparus);
  const maintenant = Date.now();
  await stockage.ecrireMeta({ userId: donnees.userId, dossiers: donnees.dossiers, derniereSynchro: maintenant });
  await changer();

  /*
   * « Disponible hors ligne » n'est vrai qu'une fois **tout** descendu : les
   * cartes et les notes, mais aussi leurs images, leurs polycopiés et la page
   * qui les affiche. Marquer l'épingle plus tôt laissait partir quelqu'un sur
   * la foi de la puce, avec un polycopié encore en route — qui s'ouvrait
   * ensuite sur « Document illisible ».
   */
  const fichiersComplets = await rangerFichiers(true);
  const coquilleComplete = await rafraichirCoquille();
  if (fichiersComplets && coquilleComplete && aTelecharger.every((n) => notesRecues.has(n.id))) {
    await stockage.resoudreEpingles(
      epingles.map((e) => cleEpingle(e.genre, e.id)).filter((cle) => !disparus.includes(cle)),
      Date.now(),
    );
    await changer();
  } else {
    // Ce qui manque sera repris à la prochaine passe.
    aRefaireApres = true;
  }
  publier({ synchro: "repos" });
}

// --- Fichiers --------------------------------------------------------------------

const adresseFichier = (nom: string) => `/api/uploads/${encodeURIComponent(nom)}`;

/**
 * Met en accord le cache des images avec les paquets gardés : retire ce qui ne
 * sert plus, et — si `telecharger` — descend ce qui manque.
 */
async function rangerFichiers(telecharger: boolean): Promise<boolean> {
  if (typeof caches === "undefined") return true;
  const cache = await caches.open(CACHE_FICHIERS);
  const voulus = new Set(
    fichiersNecessaires(await stockage.lirePaquets(), await stockage.lireNotes()).map(adresseFichier),
  );
  const presents = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));

  for (const adresse of presents) if (!voulus.has(adresse)) await cache.delete(adresse);
  if (!telecharger) return true;

  const manquants = [...voulus].filter((a) => !presents.has(a));
  if (manquants.length === 0) return true;

  let faits = 0;
  let complet = true;
  publier({ fichiers: { faits, total: manquants.length } });
  await parLots(manquants, 4, async (adresse) => {
    try {
      const r = await fetch(adresse, { redirect: "manual" });
      if (r.status === 200) await cache.put(adresse, r);
      // Un fichier que le serveur n'a plus (404) ne reviendra pas : l'attendre
      // laisserait l'épingle « en téléchargement » pour toujours.
      else if (r.status !== 404) complet = false;
    } catch {
      // Le réseau a coupé en route : la prochaine passe reprendra ce qui manque.
      complet = false;
    }
    publier({ fichiers: { faits: ++faits, total: manquants.length } });
  });
  publier({ fichiers: null });
  return complet;
}

async function parLots<T>(elements: T[], simultanes: number, travail: (e: T) => Promise<void>) {
  let suivant = 0;
  await Promise.all(
    Array.from({ length: Math.min(simultanes, elements.length) }, async () => {
      while (suivant < elements.length) await travail(elements[suivant++]);
    }),
  );
}

/**
 * Met en cache la page servie hors ligne **et tout ce qu'elle charge**.
 *
 * Le worker précache la page à son installation, mais pas ses scripts : leurs
 * noms changent à chaque build, il ne peut pas les connaître d'avance. Sans
 * eux, la page hors ligne s'afficherait sans JavaScript — donc sans rien de ce
 * qui vit dans IndexedDB. On relit donc la page, on y relève chaque ressource
 * de `/_next/static/`, polices citées par les feuilles de style comprises, et
 * on ne remplace la page en cache qu'une fois **toutes** ses ressources
 * obtenues : une page neuve sur des scripts manquants vaut moins que
 * l'ancienne, complète.
 */
export async function rafraichirCoquille(): Promise<boolean> {
  // Sans service worker, il n'y a pas de page hors ligne à préparer.
  if (typeof caches === "undefined" || !navigator.serviceWorker?.controller) return true;
  try {
    const page = await fetch(ADRESSE_COQUILLE, { cache: "no-store", redirect: "manual" });
    if (page.status !== 200) return false;
    const html = await page.text();

    const ressources = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? []);
    // Et tout le reste du build : les scripts chargés à la demande (pdf.js)
    // n'apparaissent pas dans le HTML. Cf. `ressourcesDuBuild`.
    try {
      const liste = await fetch("/api/hors-ligne/coquille", { cache: "no-store", redirect: "manual" });
      if (liste.status === 200) for (const r of ((await liste.json()) as { ressources: string[] }).ressources) ressources.add(r);
    } catch {
      // La page seule vaut mieux que rien : la révision des cartes marchera.
    }
    for (const feuille of [...ressources].filter((r) => r.endsWith(".css"))) {
      const css = await (await fetch(feuille)).text();
      for (const r of css.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? []) ressources.add(r);
    }

    // Rien à faire si la page est la même **et** que tout ce qu'elle charge est
    // là. La page seule ne suffit pas à conclure : une coquille préparée par
    // une version précédente de l'app peut manquer de pdf.js.
    const cache = await caches.open(CACHE_COQUILLE);
    const enPlace = await cache.match(ADRESSE_COQUILLE);
    if (enPlace && (await enPlace.text()) === html) {
      const presents = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
      if ([...ressources].every((r) => presents.has(r))) return true;
    }

    let complet = true;
    await parLots([...ressources], 6, async (adresse) => {
      try {
        const r = await fetch(adresse);
        if (r.ok) await cache.put(adresse, r);
        else complet = false;
      } catch {
        complet = false;
      }
    });
    if (!complet) return false;

    await cache.put(
      ADRESSE_COQUILLE,
      new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    );
    for (const requete of await cache.keys()) {
      const chemin = new URL(requete.url).pathname;
      if (chemin !== ADRESSE_COQUILLE && !ressources.has(chemin)) await cache.delete(requete);
    }
    return true;
  } catch {
    // Coupé en route : l'ancienne coquille reste en place, intacte.
    return false;
  }
}

// --- Lecture pour la page hors ligne ------------------------------------------------

export const lirePaquet = stockage.lirePaquet;
export const lirePaquets = stockage.lirePaquets;
export const lireNote = stockage.lireNote;

/** Le serveur a confirmé un bloc : la copie gardée, s'il y en a une, le suit. */
export function blocConfirme(noteId: string, blockId: string, content: string) {
  if (!etat.notes.has(noteId)) return;
  void enchainer(() => stockage.blocConfirme(blockId, content)).catch(() => undefined);
}

/**
 * La structure d'une note gardée vient de changer au serveur (bloc ajouté,
 * supprimé, déplacé, titre) : sa copie est à reprendre tout de suite, pas à la
 * prochaine synchronisation — on peut partir sans réseau dans la minute.
 */
export function noteRestructuree(noteId: string) {
  if (etat.notes.has(noteId)) void synchroniser();
}
