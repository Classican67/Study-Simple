import { AppBar } from "@/components/app-bar";
import { BottomNavigation, NavigationSpacer } from "@/components/navigation-bar";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Le proxy n'a vu qu'un cookie ; c'est cette ligne qui fait foi et qui
  // protège réellement toutes les pages du groupe.
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <AppBar userName={user.name} isAdmin={isAdmin} />

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
