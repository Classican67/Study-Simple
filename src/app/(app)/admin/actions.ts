"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { createUserSchema } from "@/lib/validation";

export type AdminState = { error?: string; ok?: string };

export async function createUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();

  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    password: formData.get("password"),
    role: formData.get("role") ?? "user",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existing) return { error: "Un compte utilise déjà ce courriel." };

  const { password, ...rest } = parsed.data;
  await prisma.user.create({
    data: { ...rest, passwordHash: await hashPassword(password) },
  });

  revalidatePath("/admin");
  return { ok: `Compte créé pour ${parsed.data.email}.` };
}

export async function deleteUser(userId: string) {
  const admin = await requireAdmin();
  // Se supprimer soi-même laisserait potentiellement l'app sans administrateur.
  if (userId === admin.id) return;

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin");
}
