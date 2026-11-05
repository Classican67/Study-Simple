import { deckColor } from "@/lib/deck-colors";

/**
 * Un dossier, et un cahier : ce qui rend une bibliothèque lisible d'un coup d'œil.
 *
 * Dessinés et non pris d'une bibliothèque d'icônes : à cette taille, un pictogramme
 * filaire a l'air d'un bouton, et c'est un objet qu'on veut voir.
 */

const TEINTES = ["blue", "rose", "emerald", "amber", "violet"];

/** Toujours la même teinte pour la même note : on reconnaît ses cahiers à leur couleur. */
function teinteDe(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TEINTES[h % TEINTES.length];
}

export function IconeDossier({
  couleur,
  id,
  className,
}: {
  couleur: string;
  /** Sert de teinte à un dossier resté à la couleur par défaut : gris, tous se valent. */
  id: string;
  className?: string;
}) {
  const teinte = deckColor(couleur === "slate" ? teinteDe(id) : couleur);
  return (
    <svg viewBox="0 0 120 92" aria-hidden className={className}>
      <path
        d="M10 4h32c3 0 5 1 7 3l6 6h55c5 0 10 4 10 10v59c0 5-5 10-10 10H10C5 92 0 87 0 82V14C0 8 5 4 10 4Z"
        fill={`color-mix(in oklab, ${teinte} 78%, black)`}
      />
      <rect x="0" y="20" width="120" height="72" rx="10" fill={teinte} />
      <rect x="0" y="20" width="120" height="30" rx="10" fill="white" opacity="0.1" />
    </svg>
  );
}

/** La couverture d'un cahier qui n'a pas encore de première page à montrer. */
export function CouvertureCahier({ id, className }: { id: string; className?: string }) {
  const teinte = deckColor(teinteDe(id));
  return (
    <span
      aria-hidden
      className={className}
      style={{ display: "block", position: "relative", backgroundColor: teinte }}
    >
      <span
        style={{
          position: "absolute",
          left: "22%",
          right: "12%",
          top: "16%",
          height: "22%",
          borderRadius: 3,
          background: "rgb(255 255 255 / 0.82)",
        }}
      />
    </span>
  );
}
