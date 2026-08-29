import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-surface-raised text-fg-muted">
          <FileQuestion className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">Page introuvable</h1>
        <p className="mt-2 max-w-xs text-sm text-fg-muted">
          Ce paquet n&apos;existe pas, ou il ne t&apos;appartient pas.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Retour aux paquets</Link>
        </Button>
      </div>
    </main>
  );
}
