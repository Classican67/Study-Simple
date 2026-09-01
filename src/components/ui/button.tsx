import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Boutons Material 3.
 *
 * Forme pilule et couches d'état plutôt que changements de teinte codés en
 * dur : c'est le mécanisme de retour visuel du système Android, et il se
 * transpose tel quel dans l'app native.
 */
const buttonVariants = cva(
  "state-layer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full " +
    "m3-label-large transition-[background-color,box-shadow,transform] duration-150 " +
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-38 " +
    // Un appui prolongé ne doit pas déclencher la sélection de texte.
    "select-none touch-manipulation " +
    "[&_svg]:size-[1.28em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Action principale d'un écran. */
        filled: "bg-primary text-on-primary elevation-1 hover:elevation-2",
        /** Action secondaire d'importance comparable. */
        tonal: "bg-secondary-container text-on-secondary-container",
        /** Détachée du fond, sans peser autant qu'une action remplie. */
        elevated: "bg-surface-low text-primary elevation-1 hover:elevation-2",
        outlined: "border border-outline bg-transparent text-primary",
        text: "bg-transparent text-primary",
        /** Icône de barre supérieure : neutre, le primaire étant réservé aux
         *  actions principales. */
        "toolbar-icon": "bg-transparent text-on-surface-variant",
        /** Destructif : réservé aux suppressions confirmées. */
        error: "bg-error text-on-error elevation-1",
        success: "bg-success text-on-success elevation-1",
      },
      size: {
        // Contextes denses (barres d'action d'une ligne de liste).
        sm: "h-9 px-4 [&_svg]:size-4",
        // 48 px : la cible tactile confortable de Material 3.
        md: "h-12 px-6",
        // Actions marquantes ; M3 Expressive assume des boutons généreux.
        lg: "h-14 px-8 m3-title-medium",
        icon: "size-12 px-0",
      },
    },
    defaultVariants: { variant: "filled", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    // `asChild` fait porter le style au premier enfant, pour styler un <Link>
    // en bouton sans imbriquer un <button> dans un <a>.
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/**
 * Bouton d'action flottant — l'action principale d'un écran Android.
 * Forme en « rectangle arrondi » et non en cercle : c'est la variante que
 * Material 3 privilégie depuis M3 Expressive.
 */
export function Fab({
  className,
  asChild,
  extended = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean; extended?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "state-layer inline-flex items-center justify-center gap-3 rounded-lg",
        "bg-primary-container text-on-primary-container elevation-3",
        "m3-title-medium transition-transform duration-150 active:scale-[0.97]",
        "[&_svg]:size-6 [&_svg]:shrink-0",
        extended ? "h-16 px-6" : "size-16",
        className,
      )}
      {...props}
    />
  );
}

export { buttonVariants };
