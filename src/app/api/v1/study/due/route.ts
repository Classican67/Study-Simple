import { getDueCards } from "@/lib/decks";
import { withUser } from "@/lib/api-auth";

/**
 * Cartes arrivées à échéance, tous paquets confondus — la file de révision
 * du jour.
 *
 * Les cartes sont renvoyées dans l'ordre du paquet ; c'est au client de les
 * mélanger s'il le souhaite, comme le fait déjà le web.
 */
export const GET = withUser(async (user) => {
  const cards = await getDueCards(user.id);

  return Response.json({
    count: cards.length,
    cards: cards.map((card) => ({
      id: card.id,
      term: card.term,
      definition: card.definition,
      // Chemin relatif : le client le préfixe de l'adresse de son serveur.
      imageUrl: card.imagePath ? `/api/uploads/${card.imagePath}` : null,
      status: card.status,
      dueAt: card.dueAt?.toISOString() ?? null,
    })),
  });
});
