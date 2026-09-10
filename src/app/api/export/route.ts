import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toPlainText } from "@/components/rich-text";
import {
  EXPORT_MIME,
  exportFilename,
  isExportFormat,
  toCsv,
  toTsv,
  UTF8_BOM,
  type Backup,
  type ExportDeck,
} from "@/lib/export";

/**
 * Export de toutes les cartes du compte connecté.
 *
 *   GET /api/export?format=json|csv|txt
 *
 * Une route plutôt qu'une action serveur : le navigateur doit recevoir un
 * fichier avec son nom, ce que seul un en-tête `Content-Disposition` permet.
 *
 * Le cloisonnement tient à `ownerId` dans la requête : on n'exporte jamais que
 * ce qui appartient à la personne connectée.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const asked = new URL(request.url).searchParams.get("format") ?? "json";
  if (!isExportFormat(asked)) {
    return NextResponse.json({ error: "Format inconnu." }, { status: 400 });
  }

  const decks = await prisma.deck.findMany({
    where: { ownerId: user.id },
    orderBy: [{ folderId: "asc" }, { title: "asc" }],
    select: {
      title: true,
      description: true,
      color: true,
      folderId: true,
      cards: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { term: true, definition: true, imagePath: true },
      },
    },
  });

  // Chemin complet de chaque dossier, « Sciences / Biologie » : sans lui, un
  // export de deux dossiers homonymes serait ambigu à la relecture.
  const folders = await prisma.folder.findMany({
    where: { ownerId: user.id },
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string | null): string => {
    const parts: string[] = [];
    // Une boucle bornée : un cycle dans l'arbre ne doit pas figer la requête.
    for (let cur = id, depth = 0; cur && depth < 64; depth++) {
      const folder = byId.get(cur);
      if (!folder) break;
      parts.unshift(folder.name);
      cur = folder.parentId;
    }
    return parts.join(" / ");
  };

  const data: ExportDeck[] = decks.map((deck) => ({
    title: deck.title,
    description: deck.description,
    color: deck.color,
    folder: pathOf(deck.folderId),
    cards: deck.cards,
  }));

  const filename = exportFilename(asked);
  let body: string;

  if (asked === "json") {
    // Sauvegarde fidèle : le balisage de mise en forme est conservé tel quel.
    const backup: Backup = {
      exportedAt: new Date().toISOString(),
      app: "fiches",
      version: 1,
      decks: data,
    };
    body = JSON.stringify(backup, null, 2);
  } else if (asked === "csv") {
    // Dans une cellule de tableur, le balisage n'a aucun sens : on l'aplatit.
    const rows = [
      ["Dossier", "Paquet", "Terme", "Définition", "Image"],
      ...data.flatMap((deck) =>
        deck.cards.map((card) => [
          deck.folder,
          toPlainText(deck.title),
          toPlainText(card.term),
          toPlainText(card.definition),
          card.imagePath ?? "",
        ]),
      ),
    ];
    body = UTF8_BOM + toCsv(rows);
  } else {
    // Un bloc par paquet, séparés par une ligne vide : c'est le format que
    // l'import de l'app relit, et celui que Quizlet attend.
    body = data
      .map((deck) => `# ${toPlainText(deck.title)}\n${toTsv(
        deck.cards.map((c) => ({
          term: toPlainText(c.term),
          definition: toPlainText(c.definition),
        })),
      )}`)
      .join("\n\n");
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": EXPORT_MIME[asked],
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Un export est un instantané : le remettre en cache donnerait un
      // fichier périmé au téléchargement suivant.
      "Cache-Control": "no-store",
    },
  });
}
