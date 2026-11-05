import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { etatLecture, lireMots } from "@/lib/documents-index";
import { prisma } from "@/lib/prisma";
import { occurrencesDansMots } from "@/lib/recherche-document";
import { searchTerms } from "@/lib/search";

/**
 * La loupe : où tombent ces mots dans les documents de cette note.
 *
 * Elle rend aussi l'état de la lecture : un polycopié importé il y a dix secondes
 * n'a pas encore été lu, et « aucun résultat » serait alors faux.
 */
export async function GET(request: Request, context: RouteContext<"/api/notes/[noteId]/recherche">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });

  const { noteId } = await context.params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, ownerId: user.id },
    select: { documents: { select: { file: true } } },
  });
  if (!note) return NextResponse.json({ error: "Note introuvable." }, { status: 404 });

  const etat = await etatLecture(noteId);
  const termes = searchTerms(new URL(request.url).searchParams.get("q") ?? "");
  const fichiers = note.documents.map((d) => d.file);
  if (termes.length === 0 || fichiers.length === 0) return NextResponse.json({ etat, pages: [] });

  const pages = await prisma.documentPage.findMany({
    where: {
      file: { in: fichiers },
      AND: termes.map((mot) => ({ searchText: { contains: mot } })),
    },
    select: { file: true, page: true, mots: true },
    orderBy: { page: "asc" },
    take: 200,
  });

  return NextResponse.json({
    etat,
    pages: pages.map((page) => ({
      file: page.file,
      page: page.page,
      occurrences: occurrencesDansMots(lireMots(page.mots), termes),
    })),
  });
}
