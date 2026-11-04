import "server-only";

import { prisma } from "@/lib/prisma";
import { configuration } from "@/lib/google-drive/google";
import { synchroniser } from "@/lib/google-drive/sync";

/**
 * La passe automatique : chaque compte relié est synchronisé environ une fois
 * par heure, sans que personne n'ait à y penser.
 *
 * Un minuteur dans le serveur, et non une tâche système : l'app tourne dans
 * un seul conteneur, et un `cron` de plus serait une pièce de plus à
 * installer, à surveiller, et à oublier lors d'une réinstallation. Le
 * minuteur vérifie toutes les dix minutes qui est dû ; une passe où rien n'a
 * bougé s'arrête à l'empreinte du compte (`signature`), elle ne coûte que
 * quelques requêtes.
 *
 * Les comptes passent **l'un après l'autre** : Google compte les requêtes par
 * projet, et dix comptes à la fois buteraient ensemble sur le quota.
 */

const VERIFICATION = 10 * 60_000;

function intervalle(): number {
  const minutes = Number(process.env.GOOGLE_DRIVE_INTERVALLE_MINUTES ?? 60);
  return Math.max(5, Number.isFinite(minutes) ? minutes : 60) * 60_000;
}

async function tour() {
  const limite = new Date(Date.now() - intervalle());
  const dus = await prisma.driveLink.findMany({
    where: {
      lastStatus: { not: "reconnect" },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: limite } }],
    },
    select: { userId: true },
  });
  for (const { userId } of dus) {
    await synchroniser(userId).catch((error) => console.error("[google-drive] passe :", error));
  }
}

// Un seul minuteur par processus, même si `register` est rappelé (rechargement
// à chaud en développement).
const globale = globalThis as unknown as { __fichesDrive?: ReturnType<typeof setInterval> };

export function demarrerPlanificateur() {
  if (!configuration() || globale.__fichesDrive) return;
  const lancer = () => void tour().catch((error) => console.error("[google-drive] tour :", error));
  // Premier tour peu après le démarrage : une mise à jour du serveur ne doit
  // pas repousser la sauvegarde d'une heure.
  setTimeout(lancer, 60_000).unref?.();
  globale.__fichesDrive = setInterval(lancer, VERIFICATION);
  globale.__fichesDrive.unref?.();
  console.log("[google-drive] passe automatique active.");
}
