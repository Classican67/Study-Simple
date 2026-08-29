import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-medium " +
    "transition-[background-color,color,box-shadow,transform,border-color] duration-150 " +
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 " +
    // Un appui prolongé sur mobile ne doit pas déclencher la sélection de texte
    // ni le menu contextuel du navigateur.
    "select-none touch-manipulation " +
    // Les icônes lucide arrivent en <svg> nu : on les dimensionne ici plutôt
    // qu'à chaque appel.
    "[&_svg]:size-[1.15em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-soft hover:brightness-110",
        secondary:
          "border border-border bg-surface text-fg shadow-soft hover:border-border-strong hover:bg-surface-raised",
        ghost: "text-fg-muted hover:bg-surface-raised hover:text-fg",
        danger: "bg-danger-solid text-white shadow-soft hover:brightness-110",
        success: "bg-success-solid text-white shadow-soft hover:brightness-110",
      },
      size: {
        // Contextes denses uniquement (barres d'action d'une ligne de liste).
        sm: "h-9 px-3 text-xs",
        // 44 px : la cible tactile minimale recommandée, sur mobile comme sur iPad.
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-6 text-base font-semibold sm:h-13",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
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

export { buttonVariants };
