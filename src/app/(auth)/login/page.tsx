import type { Metadata } from "next";
import { Logo } from "@/components/logo";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage(props: PageProps<"/login">) {
  // Next 16 : searchParams est une promesse.
  const { from } = await props.searchParams;
  const target = typeof from === "string" ? from : "/";

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-9 flex flex-col items-center text-center">
          <Logo className="mb-5 size-16 elevation-2" id="login" />
          <h1 className="m3-headline-large">Fiches</h1>
          <p className="mt-2 m3-body-large text-on-surface-variant">Connecte-toi pour retrouver tes paquets.</p>
        </div>

        <div className="rounded-2xl border border-outline-variant bg-surface-container p-6 elevation-3 sm:p-7">
          <LoginForm from={target} />
        </div>

        <p className="mt-7 text-center m3-body-small text-on-surface-variant">
          Les comptes sont créés par l&apos;administrateur.
        </p>
      </div>
    </main>
  );
}
