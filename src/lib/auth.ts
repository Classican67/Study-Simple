import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { readSession } from "@/lib/session";

const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

// Data Access Layer : tout ce qui a besoin de l'utilisateur passe par ici,
// jamais par le seul cookie. `cache` déduplique l'appel sur un même rendu,
// donc l'appeler dans dix composants ne fait qu'une requête.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;

  // On relit l'utilisateur en base : un compte supprimé doit perdre l'accès
  // immédiatement, sans attendre l'expiration du jeton.
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true },
  });

  return user;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
