"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ouvrir } from "@/lib/google-drive/coffre";
import { oublierJeton, revoquer } from "@/lib/google-drive/google";
import { estEnCours, synchroniser } from "@/lib/google-drive/sync";

/**
 * « Sauvegarder maintenant ».
 *
 * La passe part en arrière-plan : un premier envoi peut durer plusieurs
 * minutes — tous les polycopiés d'un compte —, et une action serveur qui
 * attendrait la fin laisserait le bouton en chargement tout ce temps. La page
 * se rafraîchit tant que la passe est en cours.
 */
export async function sauvegarderMaintenant(): Promise<void> {
  const user = await requireUser();
  if (!estEnCours(user.id)) {
    void synchroniser(user.id, { force: true }).catch((error) => console.error("[google-drive]", error));
  }
  revalidatePath("/sauvegarde");
}

/**
 * Délier : le jeton est révoqué chez Google, puis oublié ici.
 *
 * Les fichiers déjà déposés **restent** dans le Drive : ils appartiennent à la
 * personne, et délier n'est pas supprimer. Relier plus tard les retrouvera.
 */
export async function delierDrive(): Promise<void> {
  const user = await requireUser();
  const lien = await prisma.driveLink.findUnique({ where: { userId: user.id } });
  if (lien) {
    const jeton = ouvrir(lien.refreshToken, process.env.SESSION_SECRET ?? "");
    if (jeton) await revoquer(jeton);
  }
  oublierJeton(user.id);
  await prisma.driveLink.deleteMany({ where: { userId: user.id } });
  // Une passe en cours noterait encore ce qu'elle dépose : on la laisse
  // finir avant d'oublier la correspondance, sinon elle survivrait au lien.
  for (let i = 0; i < 240 && estEnCours(user.id); i++) await new Promise((ok) => setTimeout(ok, 250));
  await prisma.driveItem.deleteMany({ where: { userId: user.id } });
  revalidatePath("/sauvegarde");
}
