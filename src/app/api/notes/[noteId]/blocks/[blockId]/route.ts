import { apiError, getApiUser } from "@/lib/api-auth";
import { enregistrerBloc } from "@/lib/note-save";
import { MAX_BLOCK_BYTES } from "@/lib/notes";

/**
 * Enregistrement d'un bloc de note.
 *
 *   PUT /api/notes/<note>/blocks/<bloc>     { content, seq }
 *
 * Pourquoi une route, alors que l'éditeur passait par une action serveur :
 *
 * 1. **Un échec doit se nommer.** Une action rejetée ne dit pas pourquoi. Or
 *    « le réseau a coupé », « la session a expiré » et « ce bloc dépasse la
 *    taille permise » demandent trois conduites opposées : réessayer en
 *    silence, demander de se reconnecter, arrêter de réessayer. Une route rend
 *    401, 413, 404, 5xx — et la file de reprise sait quoi en faire.
 * 2. **Une action ne se rejoue pas.** La reprise après coupure renvoie un
 *    brouillon relu sur le disque, parfois plusieurs minutes plus tard et
 *    depuis une autre page ; un `fetch` se rejoue, un appel d'action non.
 * 3. **La taille.** Le corps d'une action est plafonné par Next, qui refuse la
 *    requête avant d'appeler le code. Une page manuscrite dense frôle ce
 *    plafond — c'est déjà ce qui avait fait perdre des enregistrements.
 *
 * `seq` est l'horodatage du brouillon côté client. Le serveur ne s'en sert pas
 * pour décider quoi que ce soit : il le renvoie tel quel, et c'est le client
 * qui n'efface son brouillon que si rien n'a été écrit entre-temps.
 */
export async function PUT(
  request: Request,
  context: RouteContext<"/api/notes/[noteId]/blocks/[blockId]">,
) {
  // Jamais de redirection vers /login : un client qui suit la redirection
  // recevrait 200 et la page de connexion, et croirait avoir enregistré.
  const user = await getApiUser(request);
  if (!user) return apiError("Session expirée.", 401);

  const { noteId, blockId } = await context.params;

  // La taille annoncée est refusée avant de lire le corps : inutile d'avaler
  // dix mégaoctets pour les jeter ensuite.
  const annonce = Number(request.headers.get("content-length") ?? 0);
  if (annonce > MAX_BLOCK_BYTES + 64 * 1024) {
    return apiError("Ce bloc est trop volumineux pour être enregistré.", 413);
  }

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    // Corps tronqué : c'est une coupure en cours d'envoi, pas un contenu
    // fautif. 400 serait définitif ; on demande une nouvelle tentative.
    return apiError("Envoi interrompu.", 503);
  }

  const { content, seq } =
    (corps ?? {}) as { content?: unknown; seq?: unknown };
  if (typeof content !== "string") return apiError("Contenu manquant.", 400);

  const resultat = await enregistrerBloc(user.id, blockId, content, noteId);
  if (!resultat.ok) {
    return apiError(resultat.error, resultat.code === "trop-gros" ? 413 : 404);
  }

  return Response.json(
    { ok: true, seq: typeof seq === "number" ? seq : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
