import Link from "next/link";
import { Keyboard, Layers } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Bascule entre les deux façons de réviser.
 *
 * Des liens, et non un interrupteur : le mode fait partie de l'adresse, donc
 * il se partage, se met en favori et survit à un rechargement.
 */
export function ModeSwitch({
  base,
  all,
  write,
}: {
  base: string;
  all: boolean;
  write: boolean;
}) {
  const suffix = all ? "&all=1" : "";

  return (
    <div className="flex rounded-full bg-surface-container p-1">
      <Item
        href={`${base}${all ? "?all=1" : ""}`}
        active={!write}
        icon={Layers}
        label="Cartes"
      />
      <Item
        href={`${base}?mode=write${suffix}`}
        active={write}
        icon={Keyboard}
        label="Écrire"
      />
    </div>
  );
}

function Item({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // `flex-1` : les deux moitiés font la même largeur, comme le sélecteur
        // du recto juste au-dessus dans la feuille d'options.
        "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 m3-label-large transition-colors",
        active
          ? "bg-primary text-on-primary elevation-1"
          : "text-on-surface-variant hover:text-on-surface",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
