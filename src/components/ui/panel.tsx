import * as React from "react";

import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface p-5 shadow-soft sm:p-6",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "accent" | "success" | "danger" }) {
  const tones = {
    neutral: "bg-surface-raised text-fg-muted",
    accent: "bg-accent-soft text-accent",
    success: "bg-success/12 text-success",
    danger: "bg-danger/12 text-danger",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tabular-nums",
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
    <div className="flex flex-col items-center justify-center rounded-panel border border-dashed border-border-strong bg-surface/50 px-6 py-16 text-center sm:py-20">
      <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        {icon}
      </div>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-fg-muted">
        {description}
      </p>
      {action ? <div className="mt-7">{action}</div> : null}
    </div>
  );
}

// Barre de progression purement décorative : la valeur chiffrée est toujours
// affichée en texte à côté, donc pas besoin de rôle ARIA ici.
export function ProgressBar({
  value,
  className,
  tint,
}: {
  value: number;
  className?: string;
  // Permet à une carte de paquet de teinter sa barre à sa propre couleur.
  tint?: string;
}) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-raised", className)}>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          backgroundColor: tint ?? "var(--color-accent)",
        }}
      />
    </div>
  );
}
