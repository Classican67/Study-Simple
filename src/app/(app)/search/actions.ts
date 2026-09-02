"use server";

import { requireUser } from "@/lib/auth";
import { searchCards, type SearchResult } from "@/lib/decks";

/**
 * Recherche appelée depuis le champ, à la frappe.
 *
 * `deckId` restreint au paquet courant ; sans lui, la recherche porte sur tout
 * le compte. Le cloisonnement est assuré par `searchCards`, qui filtre toujours
 * sur le propriétaire.
 */
export async function search(deckId: string | null, query: string): Promise<SearchResult[]> {
  const user = await requireUser();
  if (query.trim().length < 2) return [];
  return searchCards(user.id, query, deckId ?? undefined);
}
