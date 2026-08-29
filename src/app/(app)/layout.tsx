import Link from "next/link";
import { LogOut, ShieldUser } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { requireUser } from "@/lib/auth";
import { logout } from "../(auth)/login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Le proxy n'a vu qu'un cookie ; c'est cette ligne qui fait foi et qui
  // protège réellement toutes les pages du groupe.
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-40 border-b border-border/70 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link
            href="/"
            className="-my-1 flex items-center gap-2.5 rounded-xl py-1 outline-offset-4"
            aria-label="Accueil — mes paquets"
          >
            <Logo className="size-9" />
            <span className="font-display text-lg font-semibold tracking-tight">Fiches</span>
          </Link>

          <div className="ml-auto flex items-center gap-0.5">
            {/* Le nom encombre inutilement une barre de 390 px de large. */}
            <span className="mr-2 hidden text-sm font-medium text-fg-muted sm:inline">
              {user.name}
            </span>

            {user.role === "admin" ? (
              <Button asChild variant="ghost" size="icon" title="Comptes">
                <Link href="/admin" aria-label="Gérer les comptes">
                  <ShieldUser />
                </Link>
              </Button>
            ) : null}

            <ThemeToggle />

            <form action={logout}>
              <Button
                variant="ghost"
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        {children}
      </main>

      <ServiceWorkerRegistrar />
    </div>
  );
}
