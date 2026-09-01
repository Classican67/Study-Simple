import { SignJWT } from "jose";

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { apiError } from "@/lib/api-auth";

/**
 * Connexion d'un client mobile.
 *
 * Renvoie un jeton porteur, à ranger dans le stockage sécurisé du système
 * (Keystore sur Android). Aucun cookie n'est posé : l'application n'en a pas
 * l'usage, et un cookie sur une requête d'API n'irait nulle part.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Corps de requête illisible.", 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return apiError("Identifiants invalides.", 400);

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Message identique que le compte existe ou non : distinguer les deux cas
  // permettrait d'énumérer les comptes valides.
  const ok = user && (await verifyPassword(parsed.data.password, user.passwordHash));
  if (!ok) return apiError("Courriel ou mot de passe incorrect.", 401);

  const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
  const expiresIn = 60 * 60 * 24 * 30; // 30 jours, comme la session web

  const token = await new SignJWT({ userId: user.id, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);

  return Response.json({
    token,
    expiresIn,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}
