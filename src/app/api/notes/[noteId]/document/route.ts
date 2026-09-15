import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { importDocument } from "@/lib/documents";
import { addDocumentBlocks } from "@/app/(app)/notes/actions";
import { MAX_DOCUMENT_BYTES } from "@/lib/upload-path";
import { MAX_DOCUMENT_PAGES, parseDrawing } from "@/lib/notes";
import { prisma } from "@/lib/prisma";
import { deleteUpload } from "@/lib/uploads";

/**
 * Import d'un document à annoter.
 *
 *   POST /api/notes/<id>/document      (multipart, champ « document »)
 *
 * Pourquoi une route et non une action serveur, alors que tout le reste de
 * l'app en passe par une action :
 *
 * 1. **La taille.** Le corps d'une action serveur est plafonné à un mégaoctet
 *    par défaut ; au-delà, Next refuse la requête *avant* que le code ne soit
 *    appelé. La promesse rendue au client était rejetée, et comme l'appel
 *    n'était pas protégé, le bouton restait bloqué sur « Conversion… » pour
 *    toujours. C'est exactement le symptôme constaté sur iPad, où les PDF
 *    viennent de scans et dépassent le mégaoctet dès deux pages.
 * 2. **La progression.** Un envoi de trente mégaoctets depuis un iPad prend une
 *    minute sur un réseau ordinaire. Sans pourcentage, on croit à un blocage et
 *    l'on relance — ce qui double la charge. Une route se pilote en XHR, seule
 *    API du navigateur qui rapporte l'avancement d'un envoi.
 *
 * Tout se fait en **une** requête : import du fichier, relevé du format des
 * pages, création de la page manuscrite. Le client n'a donc plus rien à faire
 * du document — il ne le retéléchargeait que pour le mesurer.
 */
export async function POST(request: Request, context: RouteContext<"/api/notes/[noteId]/document">) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const { noteId } = await context.params;

  // La taille annoncée est refusée avant de lire le corps : inutile d'avaler
  // quarante mégaoctets pour les jeter ensuite.
  const annonce = Number(request.headers.get("content-length") ?? 0);
  if (annonce > MAX_DOCUMENT_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: `Document trop lourd (${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo maximum).` },
      { status: 413 },
    );
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("document");
  } catch {
    return NextResponse.json({ error: "Envoi interrompu." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  /*
   * `?bloc=<id>` : le document s'ajoute **dans** une page manuscrite existante.
   *
   * Le serveur n'enregistre alors que le fichier et rend le format des pages ;
   * c'est le client qui les insère après la page courante, puis enregistre par
   * le chemin ordinaire. Même raison que pour une photo (`uploadPageImage`) :
   * insérées ici, elles seraient écrasées par l'enregistrement différé du
   * client, parti d'une version sans elles — et leur fichier supprimé avec.
   */
  const blocId = new URL(request.url).searchParams.get("bloc");
  let pagesDuBloc: number | null = null;
  if (blocId) {
    const bloc = await prisma.noteBlock.findFirst({
      where: { id: blocId, noteId, kind: "drawing", note: { ownerId: user.id } },
      select: { content: true },
    });
    if (!bloc) return NextResponse.json({ error: "Page introuvable." }, { status: 404 });
    pagesDuBloc = parseDrawing(bloc.content).pages.length;
  }

  const importe = await importDocument(file);
  if ("error" in importe) return NextResponse.json({ error: importe.error }, { status: 415 });

  if (pagesDuBloc !== null) {
    // Une page simple devient la première page de la pile.
    if (Math.max(1, pagesDuBloc) + importe.ratios.length > MAX_DOCUMENT_PAGES) {
      // Aucun bloc ne le désignera jamais : il ne doit pas rester sur le disque.
      await deleteUpload(importe.file);
      return NextResponse.json(
        { error: `Ce document ferait dépasser ${MAX_DOCUMENT_PAGES} pages sur cette page manuscrite.` },
        { status: 400 },
      );
    }
    return NextResponse.json({ file: importe.file, ratios: importe.ratios });
  }

  const result = await addDocumentBlocks(noteId, importe.file, importe.ratios);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ blocks: result.blocks });
}
