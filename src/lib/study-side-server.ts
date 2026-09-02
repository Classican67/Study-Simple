import "server-only";

import { cookies } from "next/headers";

import { DEFAULT_STUDY_SIDE, STUDY_SIDE_COOKIE, isStudySide, type StudySide } from "@/lib/study-side";

/**
 * Sens choisi par l'utilisateur, lu côté serveur pour que la première carte
 * rendue montre déjà la bonne face.
 */
export async function readStudySide(): Promise<StudySide> {
  const stored = (await cookies()).get(STUDY_SIDE_COOKIE)?.value;
  return isStudySide(stored) ? stored : DEFAULT_STUDY_SIDE;
}
