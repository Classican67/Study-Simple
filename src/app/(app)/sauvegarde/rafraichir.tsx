"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Tant qu'une passe tourne, la page se relit toutes les deux secondes. */
export function SuivrePasse({ enCours }: { enCours: boolean }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!enCours) return;
    const minuteur = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(minuteur);
  }, [enCours, router]);
  return null;
}

export function BoutonSauvegarder({ enCours }: { enCours: boolean }) {
  const { pending } = useFormStatus();
  const occupe = pending || enCours;
  return (
    <Button type="submit" disabled={occupe}>
      <RefreshCw className={occupe ? "animate-spin motion-reduce:animate-none" : undefined} />
      {occupe ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
    </Button>
  );
}
