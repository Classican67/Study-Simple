"use client";

import * as React from "react";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Glisser-déposer vers un dossier, au doigt comme à la souris.
 *
 * Le glisser-déposer **natif** du navigateur ne fonctionne pas au toucher :
 * c'est une limite de l'API, et elle rendait le geste inutilisable sur iPad,
 * là où il sert le plus. On le refait donc sur Pointer Events.
 *
 * Deux choix en découlent :
 *
 * - **Une poignée**, et non la carte entière. Si toute la carte était
 *   saisissable, le doigt ne pourrait plus faire défiler la liste : on ne peut
 *   pas décider après coup qu'un geste commencé était un glissement.
 *   `touch-action: none` est donc posé sur la poignée seule.
 * - **La cible se trouve par `elementFromPoint`**, et non par un registre de
 *   rectangles tenu à jour. Rien à synchroniser, et le survol se marque
 *   directement sur le nœud du DOM — aucun rendu React pendant le geste, qui
 *   en produirait des dizaines par seconde.
 */

const DROP_ATTR = "data-drop-folder";
/** Valeur employée pour « hors de tout dossier ». */
const ROOT = "__root__";

export function DropZone({
  folderId,
  children,
  className,
  as: Tag = "li",
}: {
  /** `null` = la racine, pour sortir un élément de tout dossier. */
  folderId: string | null;
  children: React.ReactNode;
  className?: string;
  as?: "li" | "div";
}) {
  const attrs = { [DROP_ATTR]: folderId ?? ROOT };
  return (
    <Tag
      {...attrs}
      className={cn(
        "rounded-xl transition-shadow",
        // Marqué en CSS depuis le geste : voir le commentaire du module.
        "data-[over=true]:ring-2 data-[over=true]:ring-primary data-[over=true]:ring-offset-2 data-[over=true]:ring-offset-surface",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function DragHandle({
  label,
  onDrop,
  className,
}: {
  /** Ce qu'on déplace, affiché sous le doigt pendant le geste. */
  label: string;
  /** Appelé avec le dossier visé, ou `null` pour la racine. */
  onDrop: (folderId: string | null) => void;
  className?: string;
}) {
  const [ghost, setGhost] = React.useState<{ x: number; y: number } | null>(null);

  // Le survol courant est tenu hors de l'état : le marquer déclencherait un
  // rendu par mouvement de doigt.
  const over = React.useRef<HTMLElement | null>(null);
  // Sur tactile, un appui bref n'est pas un glissement : il faut le maintenir.
  const hold = React.useRef<number | null>(null);
  const dragging = React.useRef(false);

  const marquer = React.useCallback((cible: HTMLElement | null) => {
    if (over.current === cible) return;
    over.current?.removeAttribute("data-over");
    cible?.setAttribute("data-over", "true");
    over.current = cible;
  }, []);

  const terminer = React.useCallback(() => {
    if (hold.current) window.clearTimeout(hold.current);
    hold.current = null;
    dragging.current = false;
    setGhost(null);
    marquer(null);
  }, [marquer]);

  // Un démontage en plein geste laisserait une cible surlignée pour toujours.
  React.useEffect(() => terminer, [terminer]);

  function cibleSous(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y);
    return (el?.closest(`[${DROP_ATTR}]`) as HTMLElement | null) ?? null;
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Déplacer ${label} — maintenir puis glisser vers un dossier`}
        title="Glisser vers un dossier"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const demarrer = () => {
            dragging.current = true;
            setGhost({ x: event.clientX, y: event.clientY });
          };
          // La souris saisit tout de suite ; le doigt doit maintenir, sinon on
          // confondrait un début de défilement avec un glissement.
          if (event.pointerType === "touch") hold.current = window.setTimeout(demarrer, 300);
          else demarrer();
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          setGhost({ x: event.clientX, y: event.clientY });
          marquer(cibleSous(event.clientX, event.clientY));
        }}
        onPointerUp={(event) => {
          const cible = dragging.current ? cibleSous(event.clientX, event.clientY) : null;
          const valeur = cible?.getAttribute(DROP_ATTR);
          terminer();
          if (valeur) onDrop(valeur === ROOT ? null : valeur);
        }}
        onPointerCancel={terminer}
        className={cn(
          // `touch-none` sur la poignée seule : la liste doit rester défilable
          // partout ailleurs.
          "grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface active:cursor-grabbing",
          className,
        )}
      >
        <GripVertical className="size-4" />
      </button>

      {ghost ? (
        // Suit le doigt pour montrer ce qu'on transporte. `pointer-events-none`
        // est indispensable : sans lui, l'étiquette serait elle-même l'élément
        // trouvé sous le curseur, et aucune cible ne serait jamais détectée.
        <span
          aria-hidden
          style={{ left: ghost.x, top: ghost.y }}
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] rounded-full bg-primary px-3 py-1.5 m3-label-medium text-on-primary elevation-3"
        >
          {label}
        </span>
      ) : null}
    </>
  );
}
