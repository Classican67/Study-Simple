import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Fusionne des classes Tailwind en laissant la dernière gagner sur un même
// utilitaire (px-2 puis px-4 => px-4), ce que clsx seul ne sait pas faire.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
