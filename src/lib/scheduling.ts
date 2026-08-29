/**
 * Planification des révisions — système de Leitner.
 *
 * Une carte réussie revient de plus en plus tard ; une carte ratée revient
 * tout de suite. Sans cela, une carte marquée « sue » disparaissait pour
 * toujours : on l'oubliait, et l'app ne le signalait jamais.
 *
 * Module volontairement pur : il tourne aussi bien côté serveur que dans un
 * test, et n'a aucune dépendance.
 */

// Intervalles en jours, par palier de série. Au-delà du dernier, la carte
// revient tous les 35 jours — assez rare pour ne pas encombrer, assez
// fréquent pour rattraper un oubli avant qu'il soit total.
export const INTERVALS = [1, 3, 7, 16, 35] as const;

/**
 * Date de retour d'une carte selon sa série de bonnes réponses.
 *
 * @param streak 0 après un échec, puis 1, 2, 3… à chaque réussite d'affilée.
 */
export function nextDueAt(streak: number, now: Date = new Date()): Date {
  // Ratée : elle doit revenir dans la session courante, pas demain.
  if (streak <= 0) return now;

  const days = INTERVALS[Math.min(streak, INTERVALS.length) - 1];

  // On repart du début de journée : une carte répondue à 23 h et une autre à
  // 8 h le même jour reviennent le même jour. Sinon la seconde serait
  // annoncée « pas encore due » pendant quinze heures, ce qui n'a aucun sens
  // pour qui révise le soir.
  const due = new Date(now);
  due.setHours(0, 0, 0, 0);
  due.setDate(due.getDate() + days);
  return due;
}

/** Une carte est à réviser si elle n'a jamais été vue, ou si son échéance est passée. */
export function isDue(dueAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !dueAt || dueAt.getTime() <= now.getTime();
}

/** Libellé court de la prochaine échéance, pour l'afficher sans bibliothèque de dates. */
export function describeDue(dueAt: Date | null, now: Date = new Date()): string {
  if (isDue(dueAt, now)) return "à réviser";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((dueAt!.getTime() - startOfToday.getTime()) / 86_400_000);

  if (days <= 1) return "demain";
  if (days < 7) return `dans ${days} jours`;
  // Seuil au-delà du plus grand intervalle (35 jours) : sans cela, le palier
  // maximal s'annonçait « dans 1 mois », plus vague que « dans 5 semaines ».
  if (days < 45) return `dans ${Math.round(days / 7)} semaines`;
  return `dans ${Math.round(days / 30)} mois`;
}
