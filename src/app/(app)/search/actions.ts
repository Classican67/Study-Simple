"use server";

import { requireUser } from "@/lib/auth";
import { searchCards, type SearchResult } from "@/lib/decks";
import { searchNotes, type NoteSearchResult } from "@/lib/note-queries";
import { isSearchScope, type SearchScope } from "@/lib/search";

export type SearchAnswer =
  | { scope: "cards"; cards: SearchResult[] }
  | { scope: "notes"; notes: NoteSearchResult[] };

/**
 * Recherche appelée depuis le champ, à la frappe.
 *
 * `scope` dit où l'on cherche : dans les cartes ou dans les notes. Mêler les
 * deux listes obligerait à trier du regard ce qu'on sait déjà en tapant.
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
  const ou: SearchScope = isSearchScope(scope) ? scope : "cards";
  if (query.trim().length < 2) {
    return ou === "notes" ? { scope: "notes", notes: [] } : { scope: "cards", cards: [] };
  }

  if (ou === "notes") return { scope: "notes", notes: await searchNotes(user.id, query) };
  return { scope: "cards", cards: await searchCards(user.id, query, deckId ?? undefined) };
}
