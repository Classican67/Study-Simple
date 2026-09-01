import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Surfaces et indicateurs Material 3.
 *
 * En M3 la hiérarchie se lit par des **paliers de surface** teintés de la
 * couleur source, et non par des ombres empilées : une carte se distingue du
 * fond parce qu'elle est d'un ton différent, pas parce qu'elle flotte.
 */

/** Carte remplie — la variante par défaut de Material 3. */
export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-xl bg-surface-container p-5 sm:p-6", className)}
      {...props}
    />
  );
}

/**
 * Puce d'assistance (« assist chip »).
 * Remplace l'ancienne pastille : c'est le composant M3 pour une information
 * courte et catégorisée.
 */
export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "accent" | "success" | "danger" }) {
  const tones = {
    neutral: "bg-surface-high text-on-surface-variant",
    accent: "bg-primary-container text-on-primary-container",
    success: "bg-success-container text-on-success-container",
    danger: "bg-error-container text-on-error-container",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 m3-label-medium tabular-nums",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container px-6 py-16 text-center sm:py-20">
      <div className="mb-6 grid size-16 place-items-center rounded-lg bg-primary-container text-on-primary-container">
        {icon}
      </div>
      <h2 className="m3-headline-small">{title}</h2>
      <p className="mt-2 max-w-sm text-pretty m3-body-medium text-on-surface-variant">
        {description}
      </p>
      {action ? <div className="mt-8">{action}</div> : null}
    </div>
  );
}

/**
 * Indicateur de progression linéaire.
 * Purement décoratif : la valeur chiffrée est toujours affichée en texte à
 * côté, donc aucun rôle ARIA n'est nécessaire.
 */
export function ProgressBar({
  value,
  className,
  tint,
}: {
  value: number;
  className?: string;
  /** Permet à une carte de paquet de teinter sa barre à sa propre couleur. */
  tint?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={cn("flex h-1 w-full items-center gap-1", className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${clamped}%`, backgroundColor: tint ?? "var(--color-primary)" }}
      />
      {/* Material 3 sépare la portion parcourue du reste par un espace, et
          termine la piste par un point : la progression se lit sans couleur. */}
      {clamped < 100 ? (
        <>
          <div
            className="h-full flex-1 rounded-full opacity-30"
            style={{ backgroundColor: tint ?? "var(--color-primary)" }}
          />
          <span
            className="size-1 shrink-0 rounded-full"
            style={{ backgroundColor: tint ?? "var(--color-primary)" }}
          />
        </>
      ) : null}
    </div>
  );
}
