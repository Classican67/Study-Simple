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
  // Radix exige un titre accessible ; quand le design n'en montre pas,
  // on le passe quand même et `hideTitle` le réserve aux lecteurs d'écran.
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
          "data-[state=open]:animate-fade-in",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2",
          "max-h-[85vh] overflow-y-auto overscroll-contain",
          "rounded-card border border-border bg-surface p-6 shadow-2xl",
          "data-[state=open]:animate-slide-up",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="pr-8 text-lg font-semibold text-fg">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-sm text-fg-muted">
            {description}
          </DialogPrimitive.Description>
        ) : (
          // Sans Description, Radix émet un avertissement en console.
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}

        <div className="mt-4">{children}</div>

        <DialogPrimitive.Close
          aria-label="Fermer"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
