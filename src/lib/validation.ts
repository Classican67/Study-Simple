import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse courriel invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const deckSchema = z.object({
  title: z.string().trim().min(1, "Le titre est requis").max(120, "120 caractères maximum"),
  description: z.string().trim().max(500, "500 caractères maximum").default(""),
  color: z.enum(["violet", "blue", "emerald", "amber", "rose", "slate"]).default("violet"),
});

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(80, "80 caractères maximum"),
  color: z.enum(["violet", "blue", "emerald", "amber", "rose", "slate"]).default("slate"),
});

export const cardSchema = z.object({
  term: z.string().trim().min(1, "La question est requise").max(2000),
  definition: z.string().trim().min(1, "La réponse est requise").max(10000),
  // Chaîne vide = « pas d'image » ; le formulaire renvoie toujours le champ.
  imagePath: z.string().trim().max(255).optional(),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse courriel invalide"),
  name: z.string().trim().min(1, "Le nom est requis").max(80),
  password: z.string().min(8, "8 caractères minimum"),
  role: z.enum(["user", "admin"]).default("user"),
});

export type DeckInput = z.infer<typeof deckSchema>;
export type CardInput = z.infer<typeof cardSchema>;
