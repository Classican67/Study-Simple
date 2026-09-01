"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
          "data-[state=open]:animate-fade-in",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col bg-surface-high elevation-3",
          "data-[state=open]:animate-slide-up",
          // Téléphone : feuille ancrée en bas, à portée du pouce, avec la
          // marge de la barre d'accueil.
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-safe",
          // À partir de l'iPad : boîte centrée classique.
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh]",
          "sm:w-[calc(100vw-4rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:rounded-xl sm:pb-0",
          className,
        )}
        {...props}
      >
        {/* Poignée : signale qu'on a affaire à une feuille, pas à un écran. */}
        <div aria-hidden className="mx-auto mt-4 h-1 w-8 shrink-0 rounded-full bg-outline-variant sm:hidden" />

        <div className="shrink-0 px-5 pt-4 sm:px-7 sm:pt-7">
          <DialogPrimitive.Title className="pr-10 m3-headline-small text-on-surface">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-2 m3-body-medium text-on-surface-variant">
              {description}
            </DialogPrimitive.Description>
          ) : (
            // Sans Description, Radix émet un avertissement en console.
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>

        {/* Seul le contenu défile : le titre et la poignée restent en place. */}
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4 sm:px-7 sm:pb-7">
          {children}
        </div>

        <DialogPrimitive.Close
          aria-label="Fermer"
          className="absolute right-3 top-3 grid size-11 place-items-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface sm:right-4 sm:top-5"
        >
          <X className="size-4.5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
