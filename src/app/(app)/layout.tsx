import Link from "next/link";
import { Layers, LogOut, ShieldUser } from "lucide-react";

import { Button } from "@/components/ui/button";
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
      <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg font-semibold tracking-tight"
          >
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
              <Layers className="size-4" />
            </span>
            Fiches
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 hidden text-sm text-fg-muted sm:inline">{user.name}</span>

            {user.role === "admin" ? (
              <Button asChild variant="ghost" size="icon" title="Comptes">
                <Link href="/admin" aria-label="Gérer les comptes">
                  <ShieldUser />
                </Link>
              </Button>
            ) : null}

            <ThemeToggle />

            <form action={logout}>
              <Button variant="ghost" size="icon" type="submit" title="Se déconnecter" aria-label="Se déconnecter">
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>

      <ServiceWorkerRegistrar />
    </div>
  );
}
