import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium " +
    "transition-[background-color,color,box-shadow,transform] active:scale-[0.98] " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    // Les icônes lucide arrivent en <svg> nu : on les dimensionne ici plutôt
    // qu'à chaque appel.
    "[&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:brightness-110 shadow-sm",
        secondary: "bg-surface-raised text-fg border border-border hover:bg-border/50",
        ghost: "text-fg-muted hover:bg-surface-raised hover:text-fg",
        danger: "bg-danger text-white hover:brightness-110 shadow-sm",
        success: "bg-success text-white hover:brightness-110 shadow-sm",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
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
