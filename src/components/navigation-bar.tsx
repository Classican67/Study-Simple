"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarClock, HardDriveUpload, Layers, NotebookPen, ShieldUser } from "lucide-react";

import { Logo } from "@/components/logo";
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

type Destination = {
  href: string;
  label: string;
  icon: React.ElementType;
  /**
   * Seulement dans la colonne latérale : la barre du téléphone tient cinq
   * destinations, pas six. Le bilan y reste à un geste, depuis l'accueil et la
   * recherche.
   */
  large?: boolean;
};

const DESTINATIONS: Destination[] = [
  { href: "/", label: "Paquets", icon: Layers },
  { href: "/study", label: "Réviser", icon: CalendarClock },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/stats", label: "Bilan", icon: BarChart3, large: true },
  // Chaque compte a la sienne : ce n'est pas un réglage de l'installation.
  { href: "/sauvegarde", label: "Sauvegarde", icon: HardDriveUpload },
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
  const destinations = useDestinations(isAdmin).filter((d) => !d.large);

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

/**
 * La colonne latérale : la bibliothèque à gauche, le contenu à droite.
 *
 * Les libellés paraissent quand il y a la place ; sur un iPad en portrait elle se
 * réduit à ses icônes, pour rendre sa largeur aux cahiers.
 */
export function ColonneLaterale({
  isAdmin,
  haut,
  children,
}: {
  isAdmin: boolean;
  haut?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const destinations = useDestinations(isAdmin);
  if (isImmersive(pathname)) return null;

  return (
    <aside className="pt-safe sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-outline-variant bg-surface-container md:flex lg:w-60">
      <Link
        href="/"
        aria-label="Accueil"
        className="state-layer mx-2 mt-3 flex min-h-12 items-center justify-center gap-2.5 rounded-2xl px-2 text-on-surface lg:justify-start"
      >
        <Logo variant="mark" className="size-7" />
        <span className="hidden m3-headline-small lg:inline">Fiches</span>
      </Link>

      <div className="mt-3 px-2">{haut}</div>

      <nav aria-label="Navigation principale" className="scroll-slim mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="space-y-1">
          {destinations.map((destination) => {
            const active = isActive(pathname, destination.href);
            return (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={destination.label}
                  title={destination.label}
                  className={cn(
                    "state-layer flex h-12 items-center justify-center gap-3 rounded-2xl px-3 m3-label-large transition-colors lg:justify-start",
                    active
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant",
                  )}
                >
                  <destination.icon className="size-5 shrink-0" />
                  <span className="hidden lg:inline">{destination.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="pb-safe flex flex-col items-center gap-1 p-2 lg:flex-row lg:justify-between">
        {children}
      </div>
    </aside>
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
