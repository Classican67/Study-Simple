/**
 * Calculs du bilan de révision — purs, sans base ni horloge cachée.
 *
 * Tout tourne autour d'une question simple, qui n'en est pas une : **quel jour
 * était-ce ?** Le serveur est en UTC, la personne non ; une révision à minuit et
 * demi à Paris tombe la veille en UTC, et la série se casserait sans raison.
 * Les jours sont donc comptés dans un fuseau donné, jamais par tranches de
 * vingt-quatre heures : les changements d'heure feraient le reste.
 */

export type Reponse = { answeredAt: Date; knew: boolean };
export type JourActivite = { jour: string; reponses: number; reussies: number };

/** La clef d'un jour, `AAAA-MM-JJ`, dans un fuseau. */
export function cleJour(date: Date, fuseau: string): string {
  // Le format canadien écrit justement `AAAA-MM-JJ` : c'est la seule façon
  // d'obtenir une date locale sans bibliothèque.
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Décale une clef de jour. Travaille à midi UTC : aucun changement d'heure n'y touche. */
export function decalerJour(jour: string, decalage: number): string {
  const [a, m, j] = jour.split("-").map(Number);
  const date = new Date(Date.UTC(a, m - 1, j, 12));
  date.setUTCDate(date.getUTCDate() + decalage);
  return date.toISOString().slice(0, 10);
}

/** Lundi = 0 … dimanche = 6. */
export function jourDeSemaine(jour: string): number {
  const [a, m, j] = jour.split("-").map(Number);
  return (new Date(Date.UTC(a, m - 1, j, 12)).getUTCDay() + 6) % 7;
}

export function activiteParJour(reponses: Reponse[], fuseau: string): Map<string, JourActivite> {
  const jours = new Map<string, JourActivite>();
  for (const reponse of reponses) {
    const jour = cleJour(reponse.answeredAt, fuseau);
    const entree = jours.get(jour) ?? { jour, reponses: 0, reussies: 0 };
    entree.reponses += 1;
    if (reponse.knew) entree.reussies += 1;
    jours.set(jour, entree);
  }
  return jours;
}

/**
 * Série de jours consécutifs avec au moins une révision.
 *
 * Aujourd'hui ne casse pas une série tant qu'il n'est pas fini : à huit heures du
 * matin, on n'a pas encore révisé, et une série de trente jours ne doit pas
 * afficher zéro pour autant.
 */
export function series(jours: Set<string>, aujourdhui: string): { actuelle: number; meilleure: number } {
  let actuelle = 0;
  let curseur = jours.has(aujourdhui) ? aujourdhui : decalerJour(aujourdhui, -1);
  while (jours.has(curseur)) {
    actuelle += 1;
    curseur = decalerJour(curseur, -1);
  }

  let meilleure = 0;
  for (const jour of jours) {
    // Seul le début d'une série la parcourt : le coût reste linéaire.
    if (jours.has(decalerJour(jour, -1))) continue;
    let longueur = 1;
    let suite = decalerJour(jour, 1);
    while (jours.has(suite)) {
      longueur += 1;
      suite = decalerJour(suite, 1);
    }
    meilleure = Math.max(meilleure, longueur);
  }
  return { actuelle, meilleure };
}

export type CaseGrille = JourActivite & { niveau: 0 | 1 | 2 | 3 | 4; futur: boolean };

/**
 * Les semaines à montrer, en colonnes du lundi au dimanche.
 *
 * Les paliers suivent **la personne** : ses propres quartiles, pas des seuils
 * fixes. Cinquante cartes sont une grosse journée pour l'un, une petite pour
 * l'autre, et une échelle unique ne ferait qu'un aplat clair ou un aplat foncé.
 */
export function grilleActivite(
  jours: Map<string, JourActivite>,
  aujourdhui: string,
  semaines = 26,
): CaseGrille[][] {
  const volumes = [...jours.values()].map((j) => j.reponses).sort((a, b) => a - b);
  const quartile = (q: number) => volumes[Math.min(volumes.length - 1, Math.floor(volumes.length * q))] ?? 0;
  const seuils = [quartile(0.25), quartile(0.5), quartile(0.75)];
  const niveau = (n: number): CaseGrille["niveau"] => {
    if (n === 0) return 0;
    if (n <= seuils[0]) return 1;
    if (n <= seuils[1]) return 2;
    if (n <= seuils[2]) return 3;
    return 4;
  };

  const lundi = decalerJour(aujourdhui, -jourDeSemaine(aujourdhui));
  const colonnes: CaseGrille[][] = [];
  for (let s = semaines - 1; s >= 0; s--) {
    const debut = decalerJour(lundi, -s * 7);
    colonnes.push(
      Array.from({ length: 7 }, (_, i) => {
        const jour = decalerJour(debut, i);
        const entree = jours.get(jour) ?? { jour, reponses: 0, reussies: 0 };
        return { ...entree, niveau: niveau(entree.reponses), futur: jour > aujourdhui };
      }),
    );
  }
  return colonnes;
}

/** Part de réponses justes, en pour cent, ou `null` quand rien ne permet de le dire. */
export function tauxReussite(jours: JourActivite[]): number | null {
  const total = jours.reduce((somme, j) => somme + j.reponses, 0);
  if (total === 0) return null;
  return Math.round((jours.reduce((somme, j) => somme + j.reussies, 0) / total) * 100);
}

export type JourPrevu = { jour: string; cartes: number };

/**
 * Ce qui arrive à échéance, jour par jour.
 *
 * Tout ce qui est en retard compte pour aujourd'hui : c'est ce qui attend
 * réellement, et une barre « hier » ne servirait à rien.
 */
export function previsionEcheances(
  echeances: Date[],
  aujourdhui: string,
  fuseau: string,
  nombre = 14,
): JourPrevu[] {
  const jours = Array.from({ length: nombre }, (_, i) => ({
    jour: decalerJour(aujourdhui, i),
    cartes: 0,
  }));
  const rangs = new Map(jours.map((j, i) => [j.jour, i]));
  for (const echeance of echeances) {
    const cle = cleJour(echeance, fuseau);
    const rang = cle < aujourdhui ? 0 : rangs.get(cle);
    if (rang !== undefined) jours[rang].cartes += 1;
  }
  return jours;
}
