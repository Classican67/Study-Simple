/**
 * Tailles d'affichage de la liste des notes.
 *
 * Dans un module neutre, et non dans le composant : une constante exportée
 * depuis un fichier `"use client"` n'arrive pas comme une vraie valeur dans un
 * composant serveur — on n'y reçoit qu'une référence, et l'appeler échoue à
 * l'exécution sur un « includes is not a function » peu parlant.
 */
export const NOTE_VIEWS = ["list", "small", "large"] as const;
export type NoteView = (typeof NOTE_VIEWS)[number];

export function isNoteView(value: unknown): value is NoteView {
  return typeof value === "string" && (NOTE_VIEWS as readonly string[]).includes(value);
}
