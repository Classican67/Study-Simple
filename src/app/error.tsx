"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Le message réel n'est pas affiché à l'utilisateur : en production Next
    // ne transmet qu'un `digest`, à recouper avec les logs du conteneur.
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-danger/15 text-danger">
          <TriangleAlert className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">Quelque chose a lâché</h1>
        <p className="mt-2 max-w-xs text-sm text-fg-muted">
          L&apos;erreur a été écrite dans les logs du serveur.
          {error.digest ? (
            <span className="mt-1 block font-mono text-xs">{error.digest}</span>
          ) : null}
        </p>
        <Button onClick={reset} className="mt-6">
          Réessayer
        </Button>
      </div>
    </main>
  );
}
