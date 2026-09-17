/**
 * Journal d'écriture des blocs de note, sur l'appareil.
 *
 * Le principe est celui d'un journal d'écriture anticipée : **rien ne part au
 * réseau avant d'être posé ici**. Tant que le serveur n'a pas confirmé, le
 * brouillon reste ; une fois confirmé, il s'efface. Une coupure de réseau, une
 * session expirée, un onglet évincé par iPadOS, une batterie à plat : dans tous
 * les cas le travail est sur le disque, et l'ouverture suivante le retrouve.
 *
 * IndexedDB, et non `localStorage` :
 *
 * - `localStorage` est **synchrone** — y déposer trois cents kilooctets de
 *   page manuscrite bloque le fil principal au milieu d'un tracé ;
 * - il est plafonné à cinq mégaoctets par origine, soit deux pages denses ;
 * - il ne stocke que du texte, là où IndexedDB accepte l'objet tel quel.
 *
 * Et non la synchronisation en arrière-plan du service worker (`Background
 * Sync`) : elle n'existe ni sur Safari ni sur iPadOS, qui est justement
 * l'appareil sur lequel on écrit.
 */

export type Brouillon = {
  blockId: string;
  noteId: string;
  kind: string;
  content: string;
  /** Rang d'écriture, strictement croissant. Cf. `oublier`. */
  seq: number;
};

/** Ce que la file de reprise attend d'un journal : de quoi la tester à blanc. */
export type Journal = {
  noter(brouillon: Brouillon): Promise<void>;
  /** N'efface que si rien de plus récent n'a été écrit depuis. */
  oublier(blockId: string, seq: number): Promise<void>;
  lire(noteId?: string): Promise<Brouillon[]>;
  effacer(blockId: string): Promise<void>;
};

const BASE = "fiches-brouillons";
const STORE = "brouillons";

let ouverture: Promise<IDBDatabase | null> | null = null;

function ouvrir(): Promise<IDBDatabase | null> {
  if (ouverture) return ouverture;
  ouverture = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let demande: IDBOpenDBRequest;
    try {
      demande = indexedDB.open(BASE, 1);
    } catch {
      // Stockage refusé (navigation privée, réglage d'entreprise) : on
      // continue en mémoire. Moins solide, mais l'app reste utilisable.
      return resolve(null);
    }
    demande.onupgradeneeded = () => {
      const db = demande.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "blockId" });
        store.createIndex("noteId", "noteId", { unique: false });
      }
    };
    demande.onsuccess = () => resolve(demande.result);
    demande.onerror = () => resolve(null);
    // Une autre version de l'app tient la base ouverte : ne pas rester
    // suspendu pour toujours à attendre qu'elle la rende.
    demande.onblocked = () => resolve(null);
  });
  return ouverture;
}

/**
 * Demande au navigateur de ne pas évincer ce stockage.
 *
 * Safari efface les données d'un site resté sept jours sans visite ; sans cette
 * demande, un brouillon non parti pourrait disparaître pendant les vacances.
 * Accordé d'office à une application installée depuis l'écran d'accueil.
 */
export function ancrerLeStockage() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // Rien à faire : le journal marche sans, il est simplement évinçable.
  }
}

/** Repli quand IndexedDB est indisponible : au moins la session est couverte. */
const memoire = new Map<string, Brouillon>();

function transaction<T>(
  mode: IDBTransactionMode,
  travail: (store: IDBObjectStore, resoudre: (valeur: T) => void) => void,
  repli: () => T,
): Promise<T> {
  return ouvrir().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(repli());
        let valeur: T | undefined;
        let tenu = false;
        try {
          const tx = db.transaction(STORE, mode);
          // On résout sur `oncomplete`, pas sur le succès de la requête : en
          // écriture, c'est la fin de la transaction qui rend la donnée
          // durable. Confirmer plus tôt reviendrait à promettre un
          // enregistrement que le disque n'a pas encore.
          tx.oncomplete = () => resolve(tenu ? (valeur as T) : repli());
          tx.onerror = () => resolve(repli());
          tx.onabort = () => resolve(repli());
          travail(tx.objectStore(STORE), (v) => {
            valeur = v;
            tenu = true;
          });
        } catch {
          resolve(repli());
        }
      }),
  );
}

export const journalLocal: Journal = {
  async noter(brouillon) {
    memoire.set(brouillon.blockId, brouillon);
    await transaction<true>(
      "readwrite",
      (store, resoudre) => {
        store.put(brouillon);
        resoudre(true);
      },
      () => true,
    );
  },

  /**
   * Efface un brouillon confirmé — **sauf** si l'on a écrit depuis.
   *
   * L'aller-retour avec le serveur dure quelques centaines de millisecondes, et
   * la main n'attend pas : entre l'envoi et sa confirmation, deux mots de plus
   * sont posés sur la page. Effacer aveuglément sur confirmation jetterait
   * précisément ces deux mots — le brouillon disparaîtrait alors qu'il porte du
   * travail que le serveur n'a jamais vu. D'où la comparaison de rang.
   */
  async oublier(blockId, seq) {
    const enMemoire = memoire.get(blockId);
    if (enMemoire && enMemoire.seq <= seq) memoire.delete(blockId);
    await transaction<true>(
      "readwrite",
      (store, resoudre) => {
        const lecture = store.get(blockId);
        lecture.onsuccess = () => {
          const garde = lecture.result as Brouillon | undefined;
          if (garde && garde.seq <= seq) store.delete(blockId);
        };
        resoudre(true);
      },
      () => true,
    );
  },

  async effacer(blockId) {
    memoire.delete(blockId);
    await transaction<true>(
      "readwrite",
      (store, resoudre) => {
        store.delete(blockId);
        resoudre(true);
      },
      () => true,
    );
  },

  lire(noteId) {
    const deMemoire = () =>
      [...memoire.values()].filter((b) => !noteId || b.noteId === noteId);
    return transaction<Brouillon[]>(
      "readonly",
      (store, resoudre) => {
        const source = noteId ? store.index("noteId").getAll(noteId) : store.getAll();
        source.onsuccess = () => resoudre((source.result as Brouillon[]) ?? []);
      },
      deMemoire,
    );
  },
};

/**
 * Rang d'écriture, strictement croissant même au sein d'une milliseconde.
 *
 * C'est aussi une date : la reprise à l'ouverture compare ce rang à la date de
 * dernière modification de la note côté serveur pour savoir qui, du brouillon
 * ou du serveur, porte le travail le plus récent.
 */
let dernier = 0;
export function prochainRang(maintenant = Date.now()): number {
  dernier = Math.max(maintenant, dernier + 1);
  return dernier;
}
