import Link from "next/link";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { BottomNavigation, InlineNavigation, NavigationSpacer } from "@/components/navigation-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { requireUser } from "@/lib/auth";
import { logout } from "../(auth)/login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Le proxy n'a vu qu'un cookie ; c'est cette ligne qui fait foi et qui
  // protège réellement toutes les pages du groupe.
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {/* Barre supérieure Material 3 : elle repose sur un palier de surface,
          pas sur une ombre, et se teinte au défilement grâce au flou. */}
      <header className="pt-safe sticky top-0 z-40 bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          {/* min-h-12 : la cible tactile de Material 3, que le logo seul
              n'atteint pas. */}
          <Link
            href="/"
            className="-mx-2 flex min-h-12 items-center gap-3 rounded-full px-2"
            aria-label="Accueil"
          >
            <Logo className="size-9" />
            <span className="m3-title-large">Fiches</span>
          </Link>

          <div className="ml-6 hidden md:block">
            <InlineNavigation isAdmin={isAdmin} />
          </div>

          <div className="ml-auto flex items-center gap-1">
            {/* Le nom encombre inutilement une barre de 390 px de large. */}
            <span className="mr-1 hidden m3-label-large text-on-surface-variant lg:inline">
              {user.name}
            </span>

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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-8 pt-4 sm:px-6 sm:pt-8">
        {children}
      </main>

      {/* Dégage la barre de navigation, qui est en position fixe et
          recouvrirait sinon la fin du contenu. */}
      <NavigationSpacer />

      <BottomNavigation isAdmin={isAdmin} />
      <ServiceWorkerRegistrar />
    </div>
  );
}
