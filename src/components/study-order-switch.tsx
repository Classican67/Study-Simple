"use client";

import { ArrowDownUp, Shuffle } from "lucide-react";

import { STUDY_ORDER_COOKIE, type StudyOrder } from "@/lib/study-order";
import { cn } from "@/lib/utils";

/**
 * Choix de l'ordre de passage.
 *
 * Composant contrôlé : la valeur vient du serveur, qui a lu le cookie. Le clic
 * réordonne la file en cours immédiatement — sans navigation, pour ne pas
 * interrompre la session — et écrit le cookie pour la fois suivante.
 */
export function StudyOrderSwitch({
  value,
  onChange,
  className,
}: {
  value: StudyOrder;
  onChange: (order: StudyOrder) => void;
  className?: string;
}) {
  function select(order: StudyOrder) {
    // Un an : c'est une préférence, pas une session.
    document.cookie = `${STUDY_ORDER_COOKIE}=${order}; path=/; max-age=31536000; samesite=lax`;
    onChange(order);
  }

  return (
    <div
      role="group"
      aria-label="Ordre des cartes"
      className={cn("flex rounded-xl border border-outline-variant bg-surface-container p-1 elevation-1", className)}
    >
      <Item
        active={value === "shuffle"}
        onSelect={() => select("shuffle")}
        icon={Shuffle}
        label="Aléatoire"
      />
      <Item
        active={value === "deck"}
        onSelect={() => select("deck")}
        icon={ArrowDownUp}
        label="Dans l'ordre"
      />
    </div>
  );
}

function Item({
  active,
  onSelect,
  icon: Icon,
  label,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
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
