import "server-only";

import { cookies } from "next/headers";

import { DEFAULT_STUDY_ORDER, STUDY_ORDER_COOKIE, isStudyOrder, type StudyOrder } from "@/lib/study-order";

/**
 * Ordre choisi par l'utilisateur, lu côté serveur pour que la première carte
 * rendue soit déjà la bonne.
 */
export async function readStudyOrder(): Promise<StudyOrder> {
  const stored = (await cookies()).get(STUDY_ORDER_COOKIE)?.value;
  return isStudyOrder(stored) ? stored : DEFAULT_STUDY_ORDER;
}
