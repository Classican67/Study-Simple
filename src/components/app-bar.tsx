"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { isImmersive } from "@/components/navigation-bar";
import { OUVRIR_RECHERCHE, SearchDialog } from "@/components/search-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/app/(auth)/login/actions";
import { oublierLeContenu } from "@/lib/hors-ligne/client";

/**
 * Barre supérieure Material 3.
 *
 * Elle s'efface pendant une révision : c'est une tâche immersive, et chaque
 * pixel rendu à la carte se lit de plus loin. Le retour reste assuré par le
 * lien en tête de l'écran de révision.
 */
export function AppBar({ userName }: { userName: string }) {
  const pathname = usePathname();
  if (isImmersive(pathname)) return null;
  void userName;

  return (
    // Sur téléphone seulement : au-delà, c'est la colonne latérale qui porte tout.
    <header className="pt-safe sticky top-0 z-40 bg-surface/85 backdrop-blur-xl md:hidden">
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

        <div className="ml-auto flex items-center gap-1">
          <SearchDialog />
          <CommandesCompte />
        </div>
      </div>
    </header>
  );
}

/** Le thème et la déconnexion : les mêmes dans la barre et dans la colonne. */
export function CommandesCompte() {
  return (
    <>
      <ThemeToggle />
      {/* Ce qui était gardé hors ligne part avec la session ; les réponses pas
          encore envoyées, elles, attendent la prochaine connexion. */}
      <form action={logout} onSubmit={() => void oublierLeContenu()}>
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
    </>
  );
}

/** Ouvre la recherche depuis la colonne : le dialogue, lui, reste unique. */
export function BoutonRecherche() {
  return (
    <button
      type="button"
      aria-label="Rechercher"
      title="Rechercher (Ctrl+K)"
      onClick={() => window.dispatchEvent(new Event(OUVRIR_RECHERCHE))}
      className="state-layer flex h-11 w-full items-center justify-center gap-3 rounded-2xl bg-surface-high px-3 m3-label-large text-on-surface-variant lg:justify-start"
    >
      <Search className="size-5 shrink-0" />
      <span className="hidden lg:inline">Rechercher</span>
    </button>
  );
}
