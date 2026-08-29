import { readFile, stat } from "node:fs/promises";

import { getCurrentUser } from "@/lib/auth";
import { contentTypeFor, resolveUploadPath } from "@/lib/uploads";

// Les images vivent sur le montage NAS, hors de `public/` : elles ne sont donc
// pas servies par Next automatiquement, et ce handler peut exiger une session.
export async function GET(_request: Request, context: RouteContext<"/api/uploads/[file]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { file } = await context.params;
  const filePath = resolveUploadPath(file);
  if (!filePath) return new Response("Not found", { status: 404 });

  try {
    const info = await stat(filePath);
    const body = await readFile(filePath);

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentTypeFor(file),
        "Content-Length": String(info.size),
        // Le nom de fichier est un UUID généré à l'enregistrement : il ne change
        // jamais pour un contenu donné, donc on peut cacher agressivement.
        // `private` empêche un proxy partagé de servir l'image à un autre compte.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
