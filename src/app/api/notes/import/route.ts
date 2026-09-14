import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { importDocument } from "@/lib/documents";
import { addDocumentBlocks, createNote, renameNote } from "@/app/(app)/notes/actions";
import { MAX_DOCUMENT_BYTES } from "@/lib/upload-path";

/**
 * Fabrique une note à partir d'un document, dans le dossier voulu.
 *
 *   POST /api/notes/import?dossier=<id>   (multipart, champ « document »)
 *
 * Trois chemins y mènent, et c'est pour cela qu'elle existe à part de
 * `/api/notes/<id>/document`, qui ajoute un document à une note **déjà
 * ouverte** :
 *
 * - **Le glisser-déposer** d'un fichier sur la liste des notes. C'est le seul
 *   des trois qui fonctionne sur iPad aujourd'hui : on tire le PDF depuis
 *   Fichiers, en écran partagé, et il se range là où l'on regarde.
 * - **La feuille de partage** du système (`share_target` du manifeste), sur
 *   Android et ChromeOS.
 * - **« Ouvrir avec »** (`file_handlers`), sur les navigateurs de bureau à base
 *   de Chromium.
 *
 * Les deux derniers n'existent pas sur iOS ni iPadOS : Safari ne sait pas
 * faire d'une application web la destination d'un partage. Les déclarer ne
 * coûte rien et l'app y sera prête le jour où cela changera.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const url = new URL(request.url);
  const dossier = url.searchParams.get("dossier");
  /*
   * Une navigation ou un appel de l'app ?
   *
   * La feuille de partage **navigue** vers cette adresse : le navigateur y
   * envoie le fichier et attend une page en retour. Le glisser-déposer, lui,
   * appelle en XHR et attend du JSON. L'en-tête `Accept` les distingue sans
   * qu'on ait à inventer un paramètre.
   */
  const navigation = (request.headers.get("accept") ?? "").includes("text/html");

  const echec = (message: string, code: number) =>
    navigation
      ? NextResponse.redirect(new URL(`/notes?import=${encodeURIComponent(message)}`, request.url), 303)
      : NextResponse.json({ error: message }, { status: code });

  const annonce = Number(request.headers.get("content-length") ?? 0);
  if (annonce > MAX_DOCUMENT_BYTES + 1024 * 1024) {
    return echec(`Document trop lourd (${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo maximum).`, 413);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("document");
  } catch {
    return echec("Envoi interrompu.", 400);
  }
  if (!(file instanceof File) || file.size === 0) return echec("Aucun fichier reçu.", 400);

  const importe = await importDocument(file);
  if ("error" in importe) return echec(importe.error, 415);

  const noteId = await createNote(dossier);
  if (!noteId) return echec("La note n'a pas pu être créée.", 500);

  // Le nom du fichier fait un titre bien meilleur que « Note sans titre » :
  // c'est celui du cours, et c'est sous ce nom qu'on le cherchera.
  const titre = file.name.replace(/\.[^.]+$/, "").trim();
  if (titre) await renameNote(noteId, titre.slice(0, 200));

  const result = await addDocumentBlocks(noteId, importe.file, importe.ratios);
  if (!result.ok) return echec(result.error, 400);

  return navigation
    ? NextResponse.redirect(new URL(`/notes/${noteId}`, request.url), 303)
    : NextResponse.json({ noteId, titre });
}
