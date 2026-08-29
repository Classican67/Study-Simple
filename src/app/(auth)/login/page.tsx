import type { Metadata } from "next";
import { Layers } from "lucide-react";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage(props: PageProps<"/login">) {
  // Next 16 : searchParams est une promesse.
  const { from } = await props.searchParams;
  const target = typeof from === "string" ? from : "/";

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent text-accent-fg shadow-lg">
            <Layers className="size-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Fiches</h1>
          <p className="mt-1 text-sm text-fg-muted">Connecte-toi pour retrouver tes paquets.</p>
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
          <LoginForm from={target} />
        </div>

        <p className="mt-6 text-center text-xs text-fg-muted">
          Les comptes sont créés par l&apos;administrateur.
        </p>
      </div>
    </main>
  );
}
