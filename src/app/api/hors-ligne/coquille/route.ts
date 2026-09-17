import { withUser } from "@/lib/api-auth";
import { ressourcesDuBuild } from "@/lib/hors-ligne/serveur";

/** Ce qu'il faut mettre en cache pour que la page hors ligne marche en entier. */
export const GET = withUser(async () =>
  Response.json({ ressources: await ressourcesDuBuild() }, { headers: { "Cache-Control": "no-store" } }),
);
