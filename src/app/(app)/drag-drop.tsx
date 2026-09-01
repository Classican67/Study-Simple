"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { moveDeck } from "./folder-actions";

/**
 * Glisser-déposer d'un paquet vers un dossier, à la souris.
 *
 * Volontairement bâti sur le glisser-déposer natif du navigateur : léger, et
 * sans dépendance. Il ne fonctionne pas au doigt — c'est une limite de l'API,
 * pas un oubli. Sur tactile et au clavier, la boîte « Déplacer » des réglages
 * du paquet fait le même travail, et reste le chemin principal.
 */

// Type MIME propre à l'app : évite qu'un texte glissé depuis une autre fenêtre
// soit pris pour un paquet.
const MIME = "application/x-fiches-deck";

export function DraggableDeck({
  deckId,
  children,
}: {
  deckId: string;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = React.useState(false);

  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(MIME, deckId);
        event.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn("transition-opacity", dragging && "opacity-40")}
    >
      {children}
    </li>
  );
}

export function DropTarget({
  folderId,
  children,
  className,
  as: Tag = "li",
}: {
  /** `null` = l'accueil, pour sortir un paquet de tout dossier. */
  folderId: string | null;
  children: React.ReactNode;
  className?: string;
  as?: "li" | "div";
}) {
  const [over, setOver] = React.useState(false);

  return (
    <Tag
      onDragOver={(event: React.DragEvent) => {
        // Sans preventDefault, le navigateur refuse le dépôt.
        if (!event.dataTransfer.types.includes(MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event: React.DragEvent) => {
        event.preventDefault();
        setOver(false);
        const deckId = event.dataTransfer.getData(MIME);
        if (deckId) void moveDeck(deckId, folderId);
      }}
      className={cn(
        "rounded-xl transition-shadow",
        over && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
