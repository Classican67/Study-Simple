import { withUser } from "@/lib/api-auth";

/** Vérifie qu'un jeton est encore valide et renvoie le compte associé. */
export const GET = withUser(async (user) => Response.json({ user }));
