"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { InlineNavigation, isImmersive } from "@/components/navigation-bar";
import { SearchDialog } from "@/components/search-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/app/(auth)/login/actions";

/**
 * Barre supérieure Material 3.
 *
 * Elle s'efface pendant une révision : c'est une tâche immersive, et chaque
 * pixel rendu à la carte se lit de plus loin. Le retour reste assuré par le
 * lien en tête de l'écran de révision.
 */
export function AppBar({ userName, isAdmin }: { userName: string; isAdmin: boolean }) {
  const pathname = usePathname();
  if (isImmersive(pathname)) return null;

  return (
    <header className="pt-safe sticky top-0 z-40 bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        {/* Marque plate et monochrome : dans une barre Material 3, où tout est
            plat, le badge en dégradé ferait pièce rapportée. `min-h-12` donne
            la cible tactile que le logo seul n'atteint pas. */}
        <Link
          href="/"
          className="state-layer -mx-2 flex min-h-12 items-center gap-2.5 rounded-full px-2 text-on-surface"
          aria-label="Accueil"
        >
          <Logo variant="mark" className="size-7" />
          <span className="m3-title-medium">Fiches</span>
        </Link>

        {/* Séparation nette entre la marque et la navigation : sans elle, le
            logo paraît appartenir au premier onglet. */}
        <div className="ml-3 hidden h-6 w-px bg-outline-variant md:block" />

        <div className="hidden md:block">
          <InlineNavigation isAdmin={isAdmin} />
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* Le nom encombre inutilement une barre de 390 px de large. */}
          <span className="mr-1 hidden m3-label-large text-on-surface-variant lg:inline">
            {userName}
          </span>

          <SearchDialog />
          <ThemeToggle />

          <form action={logout}>
            <Button
              variant="toolbar-icon"
              size="icon"
              type="submit"
              title="Se déconnecter"
              aria-label="Se déconnecter"
            >
              <LogOut />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
