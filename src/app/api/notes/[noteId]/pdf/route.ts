import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contenusImprimables, UNTITLED } from "@/lib/notes";
import { notePdf } from "@/lib/note-pdf";

/**
 * Export d'une note annotée en PDF.
 *
 *   GET /api/notes/<id>/pdf?mode=flat|annot
 *
 * Deux formes, celles qu'offrent les applications de référence :
 *
 * - **`flat`** — les traits sont fusionnés dans le contenu de la page. Le
 *   document s'affiche à l'identique partout, et personne ne peut déplacer ni
 *   retirer les annotations. C'est la forme à partager, et le défaut.
 * - **`annot`** — les traits deviennent des annotations `/Ink` conformes à
 *   ISO 32000, avec leur flux d'apparence. Elles restent manipulables dans un
 *   lecteur qui le permet. Le flux d'apparence n'est pas optionnel : sans lui,
 *   chaque lecteur décide s'il affiche quelque chose — c'est ainsi que des
 *   fichiers annotés finissent illisibles ailleurs.
 *
 * Le document d'origine n'est jamais modifié : on en copie les pages dans un
 * nouveau document.
 */
export async function GET(request: Request, context: RouteContext<"/api/notes/[noteId]/pdf">) {
  const user = await requireUser();
  const { noteId } = await context.params;
  const mode = new URL(request.url).searchParams.get("mode") === "annot" ? "annot" : "flat";

  const note = await prisma.note.findFirst({
    where: { id: noteId, ownerId: user.id },
    select: {
      title: true,
      blocks: {
        where: { kind: { in: ["drawing", "image"] } },
        orderBy: { position: "asc" },
        select: { kind: true, content: true },
      },
    },
  });
  if (!note) return NextResponse.json({ error: "Note introuvable." }, { status: 404 });

  const octets = await notePdf(
    note.title,
    contenusImprimables(note.blocks),
    mode,
  );
  if (!octets) {
    return NextResponse.json(
      { error: "Cette note ne contient aucune page manuscrite." },
      { status: 400 },
    );
  }
  const nom = `${(note.title.trim() || UNTITLED).replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "note"}.pdf`;

  return new NextResponse(Buffer.from(octets), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nom}"`,
      // Un export est un instantané : le remettre en cache donnerait un
      // fichier périmé au téléchargement suivant.
      "Cache-Control": "no-store",
    },
  });
}
