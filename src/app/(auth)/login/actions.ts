"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";
import { loginSchema } from "@/lib/validation";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Identifiants invalides." };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Message identique que le compte existe ou non : distinguer les deux cas
  // permettrait d'énumérer les comptes valides.
  const ok = user && (await verifyPassword(parsed.data.password, user.passwordHash));
  if (!ok) {
    return { error: "Courriel ou mot de passe incorrect." };
  }

  await createSession({ userId: user.id, role: user.role });

  // La destination vient de l'URL, donc de l'utilisateur : on n'accepte qu'un
  // chemin interne, jamais une redirection vers un autre site.
  const rawTarget = formData.get("from");
  const target =
    typeof rawTarget === "string" && rawTarget.startsWith("/") && !rawTarget.startsWith("//")
      ? rawTarget
      : "/";

  redirect(target);
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
