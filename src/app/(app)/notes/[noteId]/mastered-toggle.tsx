"use client";

import * as React from "react";
import { Circle, CircleCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { setNoteMastered } from "../actions";

/**
 * « Je maîtrise cette note » : une pastille qu'on allume et qu'on éteint.
 *
 * C'est l'appréciation de la personne, pas un calcul. La marque change tout de
 * suite à l'écran, et revient en arrière si l'enregistrement échoue — une
 * pastille allumée qui ne l'est pas en base tromperait à la prochaine visite.
 */
export function MasteredToggle({ noteId, mastered }: { noteId: string; mastered: boolean }) {
  const [on, setOn] = React.useState(mastered);
  const [pending, setPending] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  async function basculer() {
    const suivant = !on;
    setOn(suivant);
    setPending(true);
    setErreur(null);
    try {
      const result = await setNoteMastered(noteId, suivant);
      if (!result.ok) {
        setOn(!suivant);
        setErreur(result.error ?? "Enregistrement impossible.");
      }
    } catch {
      setOn(!suivant);
      setErreur("Enregistrement impossible — vérifie ta connexion.");
    } finally {
      setPending(false);
    }
  }

  const Icon = on ? CircleCheck : Circle;

  return (
    <>
      <button
        type="button"
        aria-pressed={on}
        disabled={pending}
        onClick={basculer}
        title={on ? "Maîtrisée — toucher pour retirer la marque" : "Marquer la note comme maîtrisée"}
        className={cn(
          "state-layer inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 m3-label-large transition-colors disabled:opacity-60",
          on
            ? "border-transparent bg-success-container text-on-success-container"
            : "border-outline-variant text-on-surface-variant hover:text-on-surface",
        )}
      >
        <Icon className="size-4.5" />
        Maîtrisée
      </button>
      {erreur ? (
        <p role="alert" className="w-full text-right m3-body-small text-error">
          {erreur}
        </p>
      ) : null}
    </>
  );
}
