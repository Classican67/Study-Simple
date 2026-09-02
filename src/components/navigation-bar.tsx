"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Layers, ShieldUser } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Barre de navigation Material 3.
 *
 * En bas sur téléphone — c'est là que le pouce se trouve, et c'est la
 * convention Android. En ligne dans la barre supérieure à partir de la
 * tablette, où le bas de l'écran est loin de la main.
 *
 * L'élément actif porte une pastille derrière son icône : le marqueur d'état
 * de Material 3, plus lisible qu'un simple changement de couleur.
 */

type Destination = { href: string; label: string; icon: React.ElementType };

const DESTINATIONS: Destination[] = [
  { href: "/", label: "Paquets", icon: Layers },
  { href: "/study", label: "Réviser", icon: CalendarClock },
];

const ADMIN: Destination = { href: "/admin", label: "Comptes", icon: ShieldUser };

function useDestinations(isAdmin: boolean): Destination[] {
  return isAdmin ? [...DESTINATIONS, ADMIN] : DESTINATIONS;
}

// L'accueil ne doit pas s'allumer sur toutes les pages : c'est le seul chemin
// à comparer strictement.
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" || pathname.startsWith("/folders") : pathname.startsWith(href);
}

/**
 * La révision est une tâche immersive : Android efface ses barres pendant ce
 * genre d'écran. Sans cela, la navigation recouvrirait les boutons de réponse,
 * qui sont eux aussi en bas.
 *
 * Exporté pour que la barre supérieure applique exactement la même règle : une
 * seule définition de « écran immersif », donc pas de divergence possible.
 */
export function isImmersive(pathname: string): boolean {
  return pathname === "/study" || pathname.endsWith("/study");
}

export function BottomNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const destinations = useDestinations(isAdmin);

  if (isImmersive(pathname)) return null;

  return (
    <nav
      aria-label="Navigation principale"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant bg-surface-container md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around">
        {destinations.map((destination) => {
          const active = isActive(pathname, destination.href);
          return (
            <li key={destination.href} className="flex-1">
              <Link
                href={destination.href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-1 pb-3 pt-3"
              >
                <span
                  className={cn(
                    "state-layer grid h-8 w-16 place-items-center rounded-full transition-colors",
                    active
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant",
                  )}
                >
                  <destination.icon className="size-6" />
                </span>
                <span
                  className={cn(
                    "m3-label-medium",
                    active ? "text-on-surface" : "text-on-surface-variant",
                  )}
                >
                  {destination.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mêmes destinations, en ligne, pour la barre supérieure des grands écrans. */
export function InlineNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const destinations = useDestinations(isAdmin);

  return (
    <nav aria-label="Navigation principale" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {destinations.map((destination) => {
          const active = isActive(pathname, destination.href);
          return (
            <li key={destination.href}>
              <Link
                href={destination.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // h-12 : la cible tactile de 48 dp de Material 3, et la
                  // hauteur des boutons d'icône voisins dans le bandeau.
                  "state-layer flex h-12 items-center gap-2 rounded-full px-4 m3-label-large transition-colors",
                  active
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant",
                )}
              >
                <destination.icon className="size-5" />
                {destination.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Cale de la hauteur de la barre, pour que le bas du contenu reste
 * atteignable. Elle disparaît avec elle : une marge fixe sur le conteneur
 * laisserait un vide sur les écrans où la barre est masquée.
 */
export function NavigationSpacer() {
  const pathname = usePathname();
  if (isImmersive(pathname)) return null;
  return <div aria-hidden className="pb-safe h-24 shrink-0 md:hidden" />;
}
