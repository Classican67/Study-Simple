import type { Verdict } from "@/lib/sauvegarde";
import { TAILLE_LOT, type Envoi, type EnvoiReponse, type EnvoiSession } from "@/lib/hors-ligne/modele";

/**
 * Vidage de la file des réponses de révision.
 *
 * Le transport et le journal sont fournis de l'extérieur, comme pour la file
 * des notes (`lib/sauvegarde.ts`) : on éprouve ainsi chaque issue — réseau
 * absent, session expirée, lot refusé — sans navigateur.
 */

export type Lot = {
  reponses: Omit<EnvoiReponse, "genre" | "userId">[];
  sessions: Omit<EnvoiSession, "genre" | "userId">[];
};

export type VerdictLot = { sort: "ok"; regles: string[] } | Exclude<Verdict, { sort: "ok" }>;

export type IssueVidage = {
  /** `repos` : tout ce qui pouvait partir est parti. */
  etat: "repos" | "hors-ligne" | "session" | "erreur";
  restants: number;
};

export function enLot(envois: readonly Envoi[]): Lot {
  const lot: Lot = { reponses: [], sessions: [] };
  for (const envoi of envois) {
    if (envoi.genre === "reponse") {
      const { id, cardId, knew, answeredAt } = envoi;
      lot.reponses.push({ id, cardId, knew, answeredAt });
    } else {
      const { id, deckId, correctCount, missCount, finishedAt } = envoi;
      lot.sessions.push({ id, deckId, correctCount, missCount, finishedAt });
    }
  }
  return lot;
}

export async function viderEnvois(options: {
  lire: () => Promise<Envoi[]>;
  oublier: (ids: string[]) => Promise<void>;
  envoyer: (lot: Lot) => Promise<VerdictLot>;
  /** Compte actuellement connecté, s'il est connu. */
  userId: string | null;
}): Promise<IssueVidage> {
  const { lire, oublier, envoyer, userId } = options;

  const tous = await lire();
  /*
   * Les réponses d'un autre compte attendent son retour. Un iPad ne sert qu'à
   * une personne, mais une déconnexion suivie d'une connexion à un compte
   * d'essai ne doit pas envoyer ces réponses sous le mauvais nom — elles y
   * seraient refusées (carte inconnue) et donc perdues.
   */
  const miens = tous
    .filter((e) => !userId || !e.userId || e.userId === userId)
    .sort((a, b) => instant(a) - instant(b));
  const autres = tous.length - miens.length;

  for (let debut = 0; debut < miens.length; debut += TAILLE_LOT) {
    const tranche = miens.slice(debut, debut + TAILLE_LOT);
    const verdict = await envoyer(enLot(tranche));
    const restants = miens.length - debut + autres;

    switch (verdict.sort) {
      case "ok":
        await oublier(verdict.regles);
        break;
      case "refus":
        // Un lot que le serveur déclare invalide le restera : le rejouer
        // bloquerait toute la file derrière lui, pour toujours.
        console.warn("Réponses de révision refusées :", verdict.message);
        await oublier(tranche.map((e) => e.id));
        break;
      case "reseau":
        return { etat: "hors-ligne", restants };
      case "session":
        return { etat: "session", restants };
      case "serveur":
        return { etat: "erreur", restants };
    }
  }
  return { etat: "repos", restants: (await lire()).length };
}

const instant = (e: Envoi) => (e.genre === "reponse" ? e.answeredAt : e.finishedAt);
