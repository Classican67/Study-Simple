"use server";

import { requireUser } from "@/lib/auth";
import { searchCards, type SearchResult } from "@/lib/decks";
import { searchNotes, type NoteSearchResult } from "@/lib/note-queries";
import { isSearchScope, type SearchScope } from "@/lib/search";

export type SearchAnswer = {
  scope: SearchScope;
  cards: SearchResult[];
  notes: NoteSearchResult[];
};

/**
 * Recherche appelée depuis le champ, à la frappe.
 *
 * `scope` dit où l'on cherche : partout, dans les cartes, ou dans les notes et
 * leurs documents.
 *
 * `deckId` restreint au paquet courant, et ne concerne que les cartes. Le
 * cloisonnement par compte est assuré par les deux requêtes, qui filtrent
 * toujours sur le propriétaire.
 */
export async function search(
  scope: SearchScope,
  deckId: string | null,
  query: string,
): Promise<SearchAnswer> {
  const user = await requireUser();
  const ou: SearchScope = isSearchScope(scope) ? scope : "all";
  if (query.trim().length < 2) return { scope: ou, cards: [], notes: [] };

  const [cards, notes] = await Promise.all([
    ou === "notes" ? [] : searchCards(user.id, query, deckId ?? undefined),
    ou === "cards" ? [] : searchNotes(user.id, query),
  ]);
  return { scope: ou, cards, notes };
}
