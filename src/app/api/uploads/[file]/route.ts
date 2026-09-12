import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getCurrentUser } from "@/lib/auth";
import { contentTypeFor, resolveUploadPath } from "@/lib/uploads";
import { parseRange } from "@/lib/upload-path";

/**
 * Sert un fichier téléversé — image de fiche, ou PDF importé dans une note.
 *
 * Les fichiers vivent sur le montage NAS, hors de `public/` : ils ne sont donc
 * pas servis par Next automatiquement, et ce handler peut exiger une session.
 *
 * **Requêtes par plage.** pdf.js ne télécharge un document en entier que s'il
 * n'a pas le choix ; si le serveur annonce `Accept-Ranges` et répond 206, il ne
 * demande que la table des objets puis les pages regardées. Sans cela, ouvrir
 * un polycopié scanné de trente mégaoctets sur iPad télécharge les trente
 * mégaoctets avant d'afficher la première page — et sur un réseau ordinaire,
 * cela ressemble à un blocage. Le corps est diffusé au fil du disque plutôt que
 * chargé en mémoire : un `readFile` de 30 Mo par requête, avec plusieurs pages
 * ouvertes, faisait grossir le serveur sans raison.
 */
export async function GET(request: Request, context: RouteContext<"/api/uploads/[file]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { file } = await context.params;
  const filePath = resolveUploadPath(file);
  if (!filePath) return new Response("Not found", { status: 404 });

  let taille: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    taille = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const commun = {
    "Content-Type": contentTypeFor(file),
    // Le nom de fichier est un UUID généré à l'enregistrement : il ne change
    // jamais pour un contenu donné, donc on peut cacher agressivement.
    // `private` empêche un proxy partagé de servir le fichier à un autre compte.
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  const plage = parseRange(request.headers.get("range"), taille);
  if (plage === "invalide") {
    return new Response(null, {
      status: 416,
      headers: { ...commun, "Content-Range": `bytes */${taille}` },
    });
  }

  const debut = plage ? plage.debut : 0;
  const fin = plage ? plage.fin : taille - 1;
  const flux = Readable.toWeb(
    createReadStream(filePath, { start: debut, end: fin }),
  ) as ReadableStream<Uint8Array>;

  return new Response(flux, {
    status: plage ? 206 : 200,
    headers: {
      ...commun,
      "Content-Length": String(fin - debut + 1),
      ...(plage ? { "Content-Range": `bytes ${debut}-${fin}/${taille}` } : {}),
    },
  });
}
