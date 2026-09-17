import { prochainRang, type Brouillon, type Journal } from "@/lib/brouillons";

/**
 * File de reprise des enregistrements.
 *
 * Écrire une note, c'est produire une modification toutes les secondes pendant
 * une heure. Un seul envoi qui échoue sans être rejoué, et le travail est
 * perdu — c'est ce qui arrivait : un échec affichait un message, et la suite
 * ne dépendait plus que du hasard (avait-on écrit à nouveau juste après ?).
 *
 * Ici, un envoi qui échoue **revient dans la file**. La file, elle, ne perd
 * rien : chaque entrée est d'abord posée dans le journal local, et n'en sort
 * qu'une fois le serveur confirmé.
 *
 * Aucune dépendance au DOM ni à React : le temps, le réseau et le journal sont
 * fournis de l'extérieur, ce qui permet d'éprouver la reprise sans navigateur.
 */

export type EtatSauvegarde =
  /** Tout est parti. */
  | "repos"
  /** Un envoi est en cours. */
  | "envoi"
  /** Un envoi a échoué, le suivant est programmé. */
  | "attente"
  /** Pas de réseau : on garde tout et on attend son retour. */
  | "hors-ligne"
  /** Le serveur ne nous reconnaît plus : il faut se reconnecter. */
  | "session"
  /** Le serveur refuse ce contenu, et le refusera encore. */
  | "refus";

export type Diagnostic = {
  etat: EtatSauvegarde;
  /** Nombre de blocs dont le serveur n'a pas encore accusé réception. */
  enAttente: number;
  erreur: string | null;
  /** Depuis quand ça ne passe plus, pour dire « depuis 4 minutes ». */
  depuis: number | null;
  essais: number;
};

/** Ce que le transport rapporte — et donc s'il faut réessayer. */
export type Verdict =
  | { sort: "ok" }
  /** Réseau injoignable : réessayer, sans compter cela comme une erreur. */
  | { sort: "reseau" }
  /** Le serveur a répondu, mal : réessayer. */
  | { sort: "serveur"; message: string }
  /** 401 : se reconnecter. Réessayer lentement — un autre onglet peut régler ça. */
  | { sort: "session" }
  /** 413, 404 : réessayer mille fois ne changera rien. */
  | { sort: "refus"; message: string };

export type Minuteur = {
  differer(fn: () => void, ms: number): unknown;
  annuler(jeton: unknown): void;
};

const MINUTEUR_REEL: Minuteur = {
  differer: (fn, ms) => setTimeout(fn, ms),
  annuler: (jeton) => clearTimeout(jeton as ReturnType<typeof setTimeout>),
};

/**
 * Attente entre deux tentatives : 1, 2, 4, 8, 15 puis 30 secondes.
 *
 * Plafonnée à trente secondes — au-delà, le retour du réseau ne se verrait plus
 * assez vite pour rassurer, et ce n'est de toute façon pas la file qui décide :
 * `reprendre()` la réveille dès que le réseau revient ou que l'onglet reparaît.
 */
export const ATTENTES = [1000, 2000, 4000, 8000, 15000, 30000];

/** Une session expirée se règle en se reconnectant, pas en insistant. */
const ATTENTE_SESSION = 10000;

export function attenteApres(essais: number): number {
  return ATTENTES[Math.min(essais, ATTENTES.length - 1)];
}

export type Sauvegarde = ReturnType<typeof creerSauvegarde>;

export function creerSauvegarde(options: {
  envoyer: (brouillon: Brouillon) => Promise<Verdict>;
  journal: Journal;
  minuteur?: Minuteur;
  maintenant?: () => number;
  enLigne?: () => boolean;
  /** Bruit ajouté à l'attente, pour que dix onglets ne repartent pas ensemble. */
  gigue?: () => number;
}) {
  const {
    envoyer,
    journal,
    minuteur = MINUTEUR_REEL,
    maintenant = Date.now,
    enLigne = () => true,
    gigue = () => 0.8 + Math.random() * 0.4,
  } = options;

  /** Un bloc, une entrée : seul le dernier contenu compte. */
  const file = new Map<string, Brouillon>();
  /** Ce que le serveur a refusé : gardé, mais plus rejoué tout seul. */
  const refuses = new Map<string, Brouillon>();

  let etat: EtatSauvegarde = "repos";
  let erreur: string | null = null;
  let depuis: number | null = null;
  let essais = 0;
  let enVol = false;
  let jeton: unknown = null;
  let arrete = false;

  const auditeurs = new Set<(d: Diagnostic) => void>();

  function diagnostic(): Diagnostic {
    return { etat, enAttente: file.size + refuses.size, erreur, depuis, essais };
  }

  function publier() {
    const d = diagnostic();
    for (const f of auditeurs) f(d);
  }

  function poser(nouvel: EtatSauvegarde, message: string | null) {
    // `depuis` date le début de la panne en cours, pas chaque tentative : c'est
    // « ça ne passe plus depuis quatre minutes » qui renseigne, pas « le
    // dernier essai a échoué il y a deux secondes ».
    if (nouvel === "repos" || nouvel === "envoi") {
      if (etat !== "envoi" && etat !== "repos") depuis = null;
    } else if (depuis === null) {
      depuis = maintenant();
    }
    etat = nouvel;
    erreur = message;
    publier();
  }

  function programmer(attente: number) {
    if (arrete) return;
    if (jeton !== null) minuteur.annuler(jeton);
    jeton = minuteur.differer(() => {
      jeton = null;
      void vider();
    }, Math.round(attente * gigue()));
  }

  async function vider(): Promise<void> {
    if (arrete || enVol) return;
    const suivant = file.values().next();
    if (suivant.done) {
      poser(refuses.size > 0 ? "refus" : "repos", refuses.size > 0 ? erreur : null);
      return;
    }
    const brouillon = suivant.value;

    if (!enLigne()) {
      poser("hors-ligne", null);
      // On programme quand même : `navigator.onLine` ment régulièrement sur
      // iPadOS — il annonce « en ligne » sur un réseau qui ne route rien, et
      // l'inverse arrive aussi. Ne compter que sur l'événement `online`
      // laisserait la file endormie pour de bon.
      programmer(attenteApres(essais));
      return;
    }

    enVol = true;
    poser("envoi", null);
    let verdict: Verdict;
    try {
      verdict = await envoyer(brouillon);
    } catch {
      // Un transport qui lève au lieu de rendre un verdict reste une panne
      // réseau : jamais une raison de perdre le brouillon.
      verdict = { sort: "reseau" };
    }
    enVol = false;
    if (arrete) return;

    if (verdict.sort === "ok") {
      // Le brouillon n'est retiré de la file que si rien n'a été écrit
      // pendant l'aller-retour : sinon l'entrée porte déjà du travail neuf.
      if (file.get(brouillon.blockId)?.seq === brouillon.seq) file.delete(brouillon.blockId);
      await journal.oublier(brouillon.blockId, brouillon.seq);
      essais = 0;
      poser(file.size > 0 ? "envoi" : refuses.size > 0 ? "refus" : "repos", null);
      void vider();
      return;
    }

    if (verdict.sort === "refus") {
      // Hors de la file, mais **pas** hors du journal : le contenu reste sur
      // l'appareil, et l'interface propose de le télécharger.
      file.delete(brouillon.blockId);
      refuses.set(brouillon.blockId, brouillon);
      poser("refus", verdict.message);
      void vider();
      return;
    }

    essais += 1;
    if (verdict.sort === "session") {
      poser("session", "Session expirée — reconnecte-toi pour enregistrer.");
      programmer(ATTENTE_SESSION);
      return;
    }
    if (verdict.sort === "serveur") {
      poser("attente", verdict.message);
      programmer(attenteApres(essais));
      return;
    }
    poser(enLigne() ? "attente" : "hors-ligne", null);
    programmer(attenteApres(essais));
  }

  return {
    /** Journalise puis met en file. Rend le rang attribué. */
    async enregistrer(entree: Omit<Brouillon, "seq">): Promise<number> {
      const brouillon: Brouillon = { ...entree, seq: prochainRang(maintenant()) };
      // Le journal d'abord, toujours : si l'onglet meurt à la ligne suivante,
      // le travail est déjà sur le disque.
      await journal.noter(brouillon);
      file.set(brouillon.blockId, brouillon);
      // Une modification neuve vaut une nouvelle chance, même sur un bloc
      // précédemment refusé : le contenu n'est plus le même.
      refuses.delete(brouillon.blockId);
      essais = 0;
      if (jeton !== null) {
        minuteur.annuler(jeton);
        jeton = null;
      }
      void vider();
      return brouillon.seq;
    },

    /** Remet un brouillon relu sur le disque dans la file, sans le réécrire. */
    reprendreBrouillon(brouillon: Brouillon) {
      const connu = file.get(brouillon.blockId);
      if (connu && connu.seq >= brouillon.seq) return;
      file.set(brouillon.blockId, brouillon);
      publier();
    },

    /** Le réseau est revenu, ou l'onglet reparaît : on réessaie tout de suite. */
    reprendre() {
      if (arrete || (file.size === 0 && refuses.size === 0)) return;
      essais = 0;
      if (jeton !== null) {
        minuteur.annuler(jeton);
        jeton = null;
      }
      void vider();
    },

    /** Bouton « Réessayer » : même les refusés y repassent, c'est demandé. */
    reessayer() {
      for (const [id, brouillon] of refuses) file.set(id, brouillon);
      refuses.clear();
      erreur = null;
      this.reprendre();
    },

    /** La personne renonce à un brouillon refusé : il quitte aussi le journal. */
    async abandonner(blockId: string) {
      file.delete(blockId);
      refuses.delete(blockId);
      await journal.effacer(blockId);
      poser(file.size > 0 ? "attente" : refuses.size > 0 ? "refus" : "repos", refuses.size > 0 ? erreur : null);
    },

    /** Ce qui n'est pas encore enregistré — de quoi en faire un fichier. */
    enSouffrance(): Brouillon[] {
      return [...file.values(), ...refuses.values()];
    },

    diagnostic,

    ecouter(f: (d: Diagnostic) => void) {
      auditeurs.add(f);
      return () => auditeurs.delete(f);
    },

    arreter() {
      arrete = true;
      if (jeton !== null) minuteur.annuler(jeton);
      auditeurs.clear();
    },
  };
}
