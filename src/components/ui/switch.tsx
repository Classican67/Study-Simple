"use client";

import { cn } from "@/lib/utils";

/**
 * Interrupteur Material 3.
 *
 * Les proportions de la piste viennent de la spécification : 52 × 32, avec une
 * pastille de 16 au repos qui grossit à 24 une fois allumée. Ce changement de
 * taille est porteur de sens — il rend l'état lisible même sans distinguer les
 * couleurs.
 *
 * La piste ne fait que 32 de haut, ce qui est sous la cible tactile de 48. Le
 * bouton est donc plus grand qu'elle et la contient : on garde le dessin de la
 * spécification sans laisser une zone d'appui trop petite.
 *
 * `role="switch"` plutôt qu'une case à cocher : c'est un réglage qui s'applique
 * immédiatement, pas une valeur qu'on soumettra plus tard.
 */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Libellé accessible. Le texte visible est porté par la ligne qui l'entoure. */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("flex size-12 w-[3.75rem] shrink-0 items-center justify-center", className)}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-8 w-[3.25rem] items-center rounded-full border-2 transition-colors",
          checked ? "border-primary bg-primary" : "border-outline bg-surface-highest",
        )}
      >
        <span
          className={cn(
            "block rounded-full transition-all duration-200",
            checked ? "ml-[calc(100%-1.75rem)] size-6 bg-on-primary" : "ml-1.5 size-4 bg-outline",
          )}
        />
      </span>
    </button>
  );
}
