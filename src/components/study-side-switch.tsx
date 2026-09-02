"use client";

import { FileText, Type } from "lucide-react";

import { STUDY_SIDE_COOKIE, type StudySide } from "@/lib/study-side";
import { cn } from "@/lib/utils";

/**
 * Choix du sens de révision : quelle face est montrée en premier.
 *
 * Même fonctionnement que le choix de l'ordre — composant contrôlé, valeur
 * venue du serveur qui a lu le cookie, changement immédiat sans navigation
 * pour ne pas interrompre la session en cours.
 */
export function StudySideSwitch({
  value,
  onChange,
  className,
}: {
  value: StudySide;
  onChange: (side: StudySide) => void;
  className?: string;
}) {
  function select(side: StudySide) {
    // Un an : c'est une préférence, pas une session.
    document.cookie = `${STUDY_SIDE_COOKIE}=${side}; path=/; max-age=31536000; samesite=lax`;
    onChange(side);
  }

  return (
    <div
      role="group"
      aria-label="Face montrée en premier"
      className={cn(
        "flex rounded-xl border border-outline-variant bg-surface-container p-1 elevation-1",
        className,
      )}
    >
      <Item
        active={value === "term"}
        onSelect={() => select("term")}
        icon={Type}
        label="Terme"
        title="Voir le terme, chercher la définition"
      />
      <Item
        active={value === "definition"}
        onSelect={() => select("definition")}
        icon={FileText}
        label="Définition"
        title="Voir la définition, deviner le terme"
      />
    </div>
  );
}

function Item({
  active,
  onSelect,
  icon: Icon,
  label,
  title,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={title}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
        active ? "bg-primary text-on-primary elevation-1" : "text-on-surface-variant hover:text-on-surface",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}
